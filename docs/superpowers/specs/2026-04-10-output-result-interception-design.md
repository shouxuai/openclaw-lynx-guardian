# Output Result Interception Design

**Date:** 2026-04-10

**Status:** Approved for planning

## Summary

The current output guard is attached too late in the lifecycle. `guardOutput()` runs during `agent_end`, where it can redact the in-memory transcript snapshot, but it does not guarantee that unsafe tool results or the final assistant reply are stopped before persistence or outbound delivery. This is the gap that allows result-oriented attacks to succeed even when prompt-side detection is weak.

The new design moves enforcement forward into the official OpenClaw hot-path hooks:

- `tool_result_persist`: primary interception point for tool results before they enter the session transcript
- `before_message_write`: synchronous persistence guard for the final assistant message
- `message_sending`: last outbound kill switch for channel delivery

This design treats `agent_end` and `after_tool_call` as audit-only hooks. They remain useful for probes, telemetry, and retrospective reporting, but they no longer carry blocking semantics.

## Problem Statement

The plugin currently emphasizes prompt-side and tool-call-side detection. That covers many obvious attacks, but it misses an important class of failures:

- The model may hide malicious intent in wording that is hard to classify from the prompt or intermediate text.
- A tool call may appear benign after obfuscation, but the final result still contains protected material.
- Even if the assistant does not literally say "open `/etc/passwd`", a tool result that contains `/etc/passwd` contents is already enough to compromise the session if it is persisted.

The system therefore needs a result-oriented guard that looks at what actually happened, not only at how the model described the action.

## Why `message_sending` Alone Was Not Enough

The previous attempt to add `message_sending` did not provide reliable protection because of three separate issues:

1. `message_sending` only runs during outbound payload delivery. It is not a universal substitute for transcript persistence hooks.
2. `tool_result_persist` and `before_message_write` are synchronous hot-path hooks. If a handler returns a Promise, OpenClaw ignores the result.
3. The repository currently maintains its own hook typing in `src/types.ts`, which can drift from the official `openclaw/plugin-sdk` contract and create a false sense of support.

The design therefore does not rely on `message_sending` as the only safety boundary.

## Considered Approaches

### Approach A: Keep `agent_end` and improve redaction

This is the smallest change, but it still runs after unsafe content has already moved through the transcript path. It does not solve the core defect.

### Approach B: Use only `message_sending`

This improves final outbound safety, but it still allows sensitive tool results to enter the session transcript. It also depends on channel delivery paths that are not identical to transcript persistence.

### Approach C: Three-layer interception with official hooks

This is the recommended approach.

- `tool_result_persist` blocks or rewrites dangerous tool results before persistence.
- `before_message_write` blocks or rewrites the final assistant message before persistence.
- `message_sending` cancels or rewrites the final outbound payload if something still slips through.

This approach provides both transcript safety and outbound safety, and it matches the official hook semantics documented by OpenClaw.

## Recommended Architecture

### 1. Hook Contract Alignment

`index.ts` must stop importing `OpenClawPluginApi` from the hand-maintained local `src/types.ts` file and instead import the official type from `openclaw/plugin-sdk`. Local project types may still exist for plugin-specific helpers, but hook names and hook payloads must be sourced from the SDK contract.

In addition, the plugin should declare and enforce a tested minimum OpenClaw version. The local environment is running `openclaw 2026.2.26`, which is the baseline this design targets. If runtime version detection reports an older version, the plugin should log a high-visibility warning and disable the hooks that cannot be trusted.

### 2. Result-Oriented Guard Core

Introduce a dedicated synchronous guard layer for persisted results and persisted assistant messages. This guard should:

- inspect tool result messages, not only raw strings
- use `toolName`, `toolCallId`, `isSynthetic`, and the textual payload together
- detect protected file content, credential material, private keys, environment-file secrets, and policy-protected OpenClaw files
- return a rewritten safe message or a block decision without waiting on any network API

The existing `guardOutput()` logic remains useful for secret leakage and prompt leakage patterns, but it should become a building block inside the new persistence guards rather than the only enforcement function.

### 3. Three Enforcement Layers

#### `tool_result_persist`

This is the primary defense for result-oriented attacks. When a tool result resolves to protected content, the handler rewrites the persisted message immediately. The unsafe content never enters the transcript.

Example protected scenarios:

- reading `/etc/passwd`
- reading `.env`, `.npmrc`, `.pypirc`, `.git-credentials`
- reading SSH private keys or cloud credential files
- reading OpenClaw protected files such as `TOOLS.md`, `SOUL.md`, `SHIELD.md`

#### `before_message_write`

This is the second gate for the final assistant message. If the assembled assistant reply still contains protected content or reconstructed sensitive output, the handler either blocks persistence or replaces the message with a standard security notice.

This hook remains synchronous and must not call remote APIs.

#### `message_sending`

This is the final outbound kill switch. It should:

- cancel delivery for high-severity output that must never leave the gateway
- replace outbound text for redactable cases
- log probe data so the team can confirm the hook is actually being exercised in real delivery paths

Because it sits after transcript persistence, it is a backup layer, not the primary place to solve the problem.

### 4. Audit Side Channel

Remote APIs such as `checkContent()`, `checkTool()`, and `pushRecord()` remain useful, but they move to an audit side channel:

- synchronous hooks decide block or rewrite locally
- asynchronous audit calls run after the local decision and never determine whether the hook returns a mutation

This keeps hot-path behavior deterministic and avoids the "returned a Promise, result ignored" failure mode.

## Data Flow

### Tool Result Flow

1. The model triggers a tool call.
2. `before_tool_call` still screens the requested operation.
3. The tool executes.
4. `tool_result_persist` inspects the result message.
5. If unsafe, the handler rewrites the message to a fixed interception notice before transcript persistence.
6. `after_tool_call` records telemetry and diagnostics only.

### Assistant Reply Flow

1. The model composes the assistant response.
2. `before_message_write` inspects the final message synchronously.
3. If unsafe, the handler blocks persistence or rewrites the content.
4. If the message is still deliverable, `message_sending` performs the final outbound check.
5. If high-risk content survives unexpectedly, `message_sending` returns `{ cancel: true }`.

## Policy

The default enforcement policy for this feature is:

- high severity: hard block outbound delivery and replace transcript content with a fixed notice
- medium severity: redact or replace with a fixed notice, then continue delivery if the content is safe after replacement
- low severity: allow, but log a warning and attach audit telemetry

This matches the user's approved direction: do not rely on best-effort recording only; enforce result interception at the persistence boundary.

## Observability and Hook Effectiveness Guarantees

To prevent another "hook exists but did not actually fire" incident, the implementation must ship with explicit effectiveness checks:

- startup log that records the official hook set the plugin expects
- startup log that records the detected OpenClaw version and whether it meets the tested minimum
- probe logging on first invocation of `tool_result_persist`, `before_message_write`, and `message_sending`
- integration tests that prove each hook mutates or blocks content in a realistic path

The plugin should not claim the feature is active unless all three enforcement layers are registered and their tests pass against the supported OpenClaw version.

## Files and Responsibilities

- `index.ts`: lifecycle wiring, hook registration, capability logs, audit fallback behavior
- `src/guard/result-guard.ts`: new synchronous result-oriented guard primitives for tool results and assistant messages
- `src/guard/safety-guard.ts`: retain existing scoring primitives and expose shared leakage detection helpers for the new guard
- `src/runtime/hook-capabilities.ts`: version parsing, tested-minimum gate, startup diagnostics
- `src/runtime/plugin-runtime-helpers.ts`: transcript-safe message replacement helpers and text extraction helpers
- `openclaw.plugin.json`: schema updates for result interception and enforcement mode
- `package.json`: raise the tested `openclaw` peer dependency floor
- `test/plugin.test.ts`: end-to-end hook registration and lifecycle behavior
- `test/safety-guard.test.ts`: unit coverage for result-oriented detection

## Error Handling

- If the runtime version is below the supported floor, log a warning and disable unsafe assumptions about hook availability.
- If a synchronous guard throws, fail closed for high-risk protected-output cases by replacing content with a fixed notice.
- If asynchronous audit APIs fail, keep the local interception result and log the audit failure separately.

## Testing Strategy

The feature must ship with three kinds of tests:

1. unit tests for result-oriented detection and replacement
2. lifecycle tests that verify the plugin registers the correct official hooks
3. integration-style tests that simulate tool-result persistence, message persistence, and outbound delivery

The high-value regression cases are:

- `/etc/passwd`
- `.env`
- OpenClaw protected file contents
- SSH private key content
- safe file output that should not be rewritten

## Non-Goals

- redesigning `before_tool_call` risk scoring
- replacing the existing external audit service
- adding new OpenClaw core permissions beyond documented plugin hooks

## Acceptance Criteria

The design is complete when all of the following are true:

- unsafe tool results are rewritten before session persistence
- unsafe assistant messages are blocked or rewritten before session persistence
- high-severity unsafe outbound messages can be cancelled before delivery
- the plugin no longer depends on hand-maintained hook types for lifecycle correctness
- tests prove that the hooks fire and mutate content on the supported OpenClaw version
