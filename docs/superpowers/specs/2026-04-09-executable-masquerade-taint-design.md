# Executable Masquerade Taint Design

## Context

Lynx Guardian already blocks many dangerous commands by matching the visible command string in `exec` tool calls. The recent command-wrapper work closed the gap where dangerous payloads were tunneled through wrappers such as `docker exec`, `ssh`, and `powershell -Command`.

There is still a context-sensitive gap: a user can first rename, copy, alias, or shadow a binary such as `ls`, `cat`, or `python3`, then invoke the forged name to perform a dangerous action that no longer matches the blacklist's expected executable names.

Examples:

- `cp /bin/cat ./ls2`
- `ls2 /etc/passwd`
- `alias ls='cat /etc/shadow'`
- `export PATH=/tmp/fakebin:$PATH`
- `safe -c "import os; os.remove('/etc/passwd')"`

The first command is the setup step. The later command is the dangerous action. The current plugin sees only the later command text and may incorrectly trust it because the visible executable name no longer matches known dangerous or special-case patterns.

## Goals

- Detect high-confidence executable-masquerading setup actions.
- Carry that context forward within the current session so later commands are not judged as if the command name were inherently trustworthy.
- Keep the implementation local to Lynx Guardian's existing blacklist and safety-guard flow.
- Preserve current behavior for ordinary read-only commands when there is no masquerade context.
- Prefer narrow, explainable rules with low false-positive cost.

## Non-Goals

- Resolving every command to its real executable on disk.
- Building a full shell parser, alias expander, or PATH resolver.
- Maintaining permanent distrust beyond the current session or TTL window.
- Expanding the first version to every possible launcher, task runner, or shell feature.
- Proving that a forged command name definitely maps to a specific underlying executable.

## Existing Gap

Today, the control flow in `before_tool_call` effectively does this for `exec`:

1. `guardToolCall()` evaluates the visible command text.
2. `checkExecBlacklist()` evaluates the visible command text.
3. `SAFE_EXEC` and other name-based patterns can allow or downgrade the command.

This works when the dangerous behavior is visible in the command itself. It fails when the dangerous intent is split across two steps:

1. create or configure a disguised executable path;
2. invoke the disguised name later.

The first step is context. The second step may look safe if the plugin only trusts the visible binary name.

## Design Overview

The design adds two linked capabilities:

1. a dedicated executable-masquerade setup detector;
2. a short-lived session taint that changes how later `exec` commands are evaluated.

The system does not try to fully resolve binaries. Instead, it treats masquerade setup as a trust-breaking event. Once the session is tainted, name-based safe assumptions become weaker for a limited time.

## Detection Model

### New Setup Rule Layers

Add new rule layers in `src/blacklist.ts`:

- `EXECUTABLE_MASQUERADE_SETUP`
- `EXECUTABLE_MASQUERADE_HINT`

Intent:

- `EXECUTABLE_MASQUERADE_SETUP` matches high-confidence setup actions and should produce a `critical` result.
- `EXECUTABLE_MASQUERADE_HINT` matches weaker command-shadowing signals and should produce a `warning` result.

These rule layers are separate from `CRITICAL_EXEC`, `WARNING_EXEC`, and `WRAPPED_CRITICAL_EXEC` so they remain understandable and maintainable.

### High-Confidence Setup Signals

The first version should match explicit setup actions such as:

- renaming or copying a known executable to a different name:
  - `mv /bin/cat /tmp/ls`
  - `cp /usr/bin/python3 ./safe-tool`
- creating a symlink that gives a dangerous host or shell a different name:
  - `ln -s /bin/sh ./git`
  - `ln -s /usr/bin/python3 ./notes`
- creating shell aliases or functions that remap a benign-looking command name to a dangerous target:
  - `alias ls='cat /etc/shadow'`
  - `function cat(){ /bin/sh "$@"; }`
  - PowerShell `function ls { Get-Content C:\Windows\System32\config\SAM }`

The source executable list should focus on high-value families already meaningful to the plugin:

- shell hosts and wrappers:
  - `sh`, `bash`, `zsh`, `dash`, `cmd`, `powershell`, `pwsh`
- inline interpreters:
  - `python`, `python3`, `node`, `perl`, `ruby`
- sensitive file readers and shells:
  - `cat`, `less`, `more`, `head`, `tail`, `type`
- direct execution relays or payload launchers:
  - `curl`, `wget`, `nc`, `ncat`, `socat`

### Hint Signals

The first version should mark weaker environment-shadowing actions as hints instead of immediate hard setup:

- prepending a writable or non-system directory ahead of the existing `PATH`:
  - `export PATH=/tmp/fakebin:$PATH`
  - `set PATH=C:\temp\fake;%PATH%`
  - `$env:PATH = "C:\temp\fake;$env:PATH"`
- mutating `PATHEXT`, `PSModulePath`, or equivalent command-resolution inputs:
  - `set PATHEXT=.JS;.EXE;.BAT`
  - `$env:PSModulePath = "C:\temp\modules;$env:PSModulePath"`

These patterns should stay conservative. Normal read-only inspection of environment variables is not in scope.

## Session Taint Model

Add masquerade state to the session state in `src/guard/safety-guard.ts`.

Suggested shape:

```ts
interface ExecMasqueradeState {
  level: "soft" | "hard";
  expiresAt: number;
  reasons: string[];
}
```

`SessionState` gains:

```ts
execMasquerade?: ExecMasqueradeState;
```

### Taint Levels

- `soft`
  - triggered by hint-level environment shadowing such as suspicious `PATH` or `PATHEXT` precedence changes;
  - default TTL: 10 minutes.
- `hard`
  - triggered by high-confidence setup such as `mv`, `cp`, `ln -s`, alias, or function-based masquerading;
  - default TTL: 30 minutes.

### Taint Transitions

- clean -> soft
  - when a hint signal is observed.
- clean -> hard
  - when a setup signal is observed.
- soft -> hard
  - when a later setup signal is observed before the soft TTL expires.
- hard -> hard
  - refresh TTL when another hard setup signal appears.
- any taint -> clean
  - automatically after TTL expiry.

TTL should be sliding. New hits refresh the matching taint timer.

## Integration Points

### `guardToolCall()` Responsibilities

`guardToolCall()` should remain the stateful place that understands session context.

For `exec` tool calls:

1. inspect the raw command for setup or hint signals;
2. update session taint if matched;
3. emit new modules for scoring and audit visibility:
   - `M3:exec_masquerade_setup`
   - `M3:exec_masquerade_taint`
4. pass the current taint level into `checkExecBlacklist()`.

This keeps the state mutation in one place instead of making `src/blacklist.ts` stateful.

### `checkExecBlacklist()` Responsibilities

Extend the signature so blacklist evaluation can react to session context:

```ts
checkExecBlacklist(command: string, context?: {
  masqueradeTaintLevel?: "soft" | "hard";
})
```

The blacklist remains a pure evaluator. It receives the taint level and changes how aggressively it trusts the visible command name.

## Tainted Evaluation Rules

### Clean Session

Behavior stays the same as today:

- existing full-command rules run first;
- segmented evaluation runs next;
- `SAFE_EXEC` can short-circuit clearly safe commands.

### Soft-Tainted Session

In soft taint:

- `SAFE_EXEC` must no longer automatically short-circuit evaluation;
- clearly read-only commands with no sensitive path, no pipe execution, no redirection, no inline code host, and no wrapper handoff may still pass;
- commands that would previously be trusted only because the visible binary name looks safe must now be inspected normally.

Practical effect:

- `ls -la` can still pass;
- `cat README.md` can still pass;
- `cat /etc/passwd` still blocks as before;
- a forged command name no longer gets a free pass just because it happens to look like a safe executable.

### Hard-Tainted Session

In hard taint, keep the soft rules and add stronger escalation:

- if the top-level executable name is unknown to Lynx Guardian but the command includes a dangerous execution host flag, redirection, wrapper handoff, sensitive path access, or inline interpreter behavior, treat it as high risk;
- if the command appears to use shell-host flags on an unrecognized binary, prefer `critical`;
- if the command accesses protected targets through an unrecognized binary, prefer at least `warning`, and `critical` if the payload family is already dangerous by existing concepts.

This does not require PATH resolution. The logic remains heuristic and text-based, but it stops assuming that the visible command name is trustworthy after masquerade setup has occurred.

## Unknown-Executable Heuristic

In tainted mode, an executable can be treated as "unknown" when:

- its top-level token does not match the safe inspection families already recognized by `SAFE_EXEC`;
- it does not match the major dangerous families already recognized by the blacklist;
- the remaining command still contains suspicious structure such as:
  - `-c`, `--command`, `--eval`, `-e`, `/c`, `/r`, `-Command`;
  - sensitive-path reads or writes;
  - shell handoff patterns;
  - pipe-to-exec behavior;
  - reverse-shell indicators;
  - wrapper-style nested execution.

This heuristic should only be active during taint. In a clean session, ordinary unknown programs must not suddenly become suspicious by default.

## False Positive Controls

The first version should avoid these mistakes:

- blocking every `PATH` change;
- blocking every alias definition;
- blocking every custom wrapper script;
- treating every unknown executable as malicious;
- keeping a session tainted for its full lifetime after one weak hint.

Guidelines:

- use `hard` taint only for explicit executable identity remapping;
- use `soft` taint for weaker precedence manipulation;
- require dangerous secondary structure before escalating unknown commands during taint;
- allow taint to expire automatically.

## Accepted First-Pass Gaps

The first version may still miss:

- multi-step masquerading split across multiple files and shell startup scripts;
- very indirect shell functions or aliases built through variable interpolation;
- masquerading created outside the current session before Lynx Guardian observed anything;
- binary wrappers whose later invocation contains no suspicious structure at all;
- exact executable identity resolution on Windows shim layers, shell builtins, or nested launchers.

These gaps are acceptable for the first pass because the goal is to close the obvious bypass chain without introducing platform-specific execution tracing.

## Testing Strategy

Add coverage in `test/blacklist.test.ts` and `test/safety-guard.test.ts`.

### Required Setup Detection Cases

These should set taint or directly match the new masquerade rules:

- `cp /bin/cat ./ls2`
- `mv /usr/bin/python3 ./safe-tool`
- `ln -s /bin/sh ./git`
- `alias ls='cat /etc/shadow'`
- `function cat(){ /bin/sh "$@"; }`
- `export PATH=/tmp/fakebin:$PATH`
- `$env:PATH = "C:\\temp\\fake;$env:PATH"`

### Required Context-Carried Cases

These should prove that a same-session setup changes later evaluation:

- `cp /bin/cat ./ls2` then `ls2 /etc/passwd`
- `alias ls='cat /etc/shadow'` then `ls`
- `mv /usr/bin/python3 ./safe` then `safe -c "import os; os.remove('/etc/passwd')"`
- `export PATH=/tmp/fakebin:$PATH` then `python3 -c "import os; os.remove('/etc/passwd')"`

### Required Safe Cases

These should remain allowed:

- clean session `ls -la`
- clean session `cat README.md`
- clean session `git status`
- soft-tainted session `ls -la`
- soft-tainted session `cat README.md`
- post-expiry `git status`

### TTL Cases

Add explicit tests for:

- soft taint expires after its TTL;
- hard taint expires after its TTL;
- soft taint upgrades to hard;
- repeated hits refresh expiry.

## Error Handling and Auditability

- reasons for setup matches should be human-readable:
  - `executable masquerade setup via copy/rename`
  - `command resolution shadowing via PATH precedence change`
  - `tainted session: safe-command whitelist disabled`
- audit logs should reflect both the setup event and the later tainted execution decision;
- taint state must remain best-effort and local to session memory, with no persistent on-disk storage in the first version.

## Design Summary

This design closes the executable-renaming bypass by treating masquerade setup as a trust-breaking event instead of trying to fully resolve every command.

The first version adds:

- explicit detection for executable masquerade setup;
- soft and hard session taint with 10-minute and 30-minute sliding TTLs;
- taint-aware blacklist evaluation that stops blindly trusting safe-looking command names after setup is observed;
- focused tests proving both the bypass closure and the non-regression contract.
