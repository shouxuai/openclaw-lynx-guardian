# Lynx Guardian Go Decision Engine Strengthening Spec

Date: 2026-04-29

## 1. Background

The Go control-plane remediation moved decision persistence, chain state, grants, `/lynx-check` tasks, Skill inventory, and token usage semantics into the Go backend. The plugin runtime slimming pass then reduced the TypeScript plugin to a thinner OpenClaw execution layer.

The remaining gap is decision quality ownership. The Go backend is now the control-plane entrypoint, but it is not yet stronger than the previous plugin-side guard in all detector families. In particular:

- `backend/internal/decision/semantic_arbiter.go` currently contains a small deterministic semantic arbiter for protected prompt extraction, approval bypass, hidden execution, malicious silent code, and security education.
- `backend/internal/decision/rules_input.go` contains a compact evidence rule list for prompt extraction, approval bypass, hidden execution, and warning hints.
- `src/guard/evasive-intent-cn.ts` still contains the richer Chinese evasive-intent lexicon, pinyin normalization, phrase patterns, family combinations, false-positive suppressions, and detector contract tests.
- `src/guard/safety-guard.ts` still calls `detectChineseEvasiveIntent()` inside `guardInput()`, so this detector remains in the active plugin path.

That means the architecture is not finished. Go owns the decision API, but some of the highest-value judgement logic still lives in the plugin. This spec defines the next remediation: make Go's two decision lines stronger than the old plugin guard, then reduce the plugin guard to hook-local enforcement and runtime execution only.

## 2. Goal

Build a stronger Go decision engine where both independent arbiters exceed the previous plugin-side capability:

- `semantic_intent` must understand intent families, dangerous outcomes, bypass phrasing, Chinese colloquialisms, pinyin variants, hidden execution chains, and multi-turn context.
- `evidence_score` must produce explainable rule hits, score breakdowns, family combinations, chain/taint signals, and stage-specific evidence across input, tool, output, and install decisions.
- `tool_call` decisions must move beyond keyword checks. Go must parse the tool name, command text, structured arguments, target paths, source/sink relationship, network targets, executable family, mutation operation, encoded execution markers, taint state, and grant scope before choosing risk/action.
- The plugin must stop being the owner of rich judgement corpora such as `CHINESE_EVASIVE_INTENT_LITERALS`.
- The Go response must remain a normal `DecisionResponse` so the existing frontend and runtime bridges continue to show arbiter, evidence, score, action, and color consistently.

Success means Go is not merely equal to the old plugin detector. It must preserve all old true-positive and false-positive behavior that matters, then add stronger coverage for the same risk families.

## 3. Non-Goals

- Do not add an LLM dependency to the Go decision path in this phase. The two lines remain deterministic and testable.
- Do not remove plugin local L4 hard-deny for cases that must block before Go can answer.
- Do not move OpenClaw hook registration into Go.
- Do not remove sync-only output protection from the plugin.
- Do not change grant product semantics such as `allow-current-chain`.
- Do not claim runtime success from local tests alone. Real OpenClaw sync and live probes remain required.
- Do not silently loosen existing deny behavior to reduce false positives. Every downgrade must be tied to a named benign class and a regression test.

## 4. Target Architecture

The target decision flow is:

```text
OpenClaw hook
  -> plugin context extraction
  -> plugin local L4 fast path only
  -> Go /lynx/internal/v1/decision/<stage>
       -> request normalization
       -> chain/grant/taint load
       -> semantic_intent arbiter
       -> evidence_score arbiter
       -> monotonic arbitration
       -> decision/evidence/audit persistence
  -> plugin executes DecisionResponse
```

The plugin may still do local hard-deny for immediate safety, but Go is the owner of semantic judgement, evidence scoring, rule corpora, family combinations, and long-term escalation.

## 5. Ownership Rules

### 5.1 Go Owns

- Chinese evasive intent corpus, normalization, pinyin handling, pattern matching, family combinations, and false-positive suppression.
- Concealed intent and execution-chain detection that depends on semantic/evidence interpretation.
- Input risk families: prompt extraction, approval bypass, detector evasion, hidden execution, data exfiltration intent, dangerous outcome planning, malicious code requests, and safe education distinctions.
- Tool risk families: protected file reads/writes, secret reads, command execution, deletion, config mutation, plugin tamper, encoded execution, command chaining, shell pipeline exfiltration, external send, network fetch-and-execute, source/sink transitions, taint propagation, and grant-scope validation.
- Output risk families: secrets, PII, protected prompt text, developer instruction text, raw security rule text, managed-report allowlisting, and redaction reasons.
- Install risk families: Skill manifest drift, suspicious install source, malicious install text, protected plugin mutation, and inventory/finding evidence.
- Chain escalation: recent denials, recent evasions, taint reads, pending approvals, active grants, and risk-family transitions.
- Arbitration and final action selection.

### 5.2 Plugin Keeps

- OpenClaw hook registration and runtime context extraction.
- Local L4 fast path for plugin disable, config mutation, protected prompt/secret read, explicit approval bypass, concealed execution chain, and high-confidence exfiltration when waiting for Go is unsafe.
- Sync-only persisted-output protection for hooks that cannot wait.
- Delivery bridges for Feishu, webchat, OpenClaw, and local console.
- Ephemeral approval promises where OpenClaw waits on a callback.

### 5.3 Transitional Rule

During migration, the plugin may keep old detector files only as test fixtures or temporary fallback. The final active runtime path must not call the old rich detector after Go parity and runtime proof pass.

## 6. Decision Engine Structure

The Go backend should stay inside `backend/internal/decision` and avoid a new framework. Add focused files that separate corpus, normalization, semantic scoring, evidence scoring, and test fixtures:

```text
backend/internal/decision/
  text_normalizer.go
  risk_signals.go
  evasive_cn.go
  concealed_intent.go
  input_semantics.go
  input_evidence.go
  tool_request.go
  tool_semantics.go
  tool_evidence.go
  output_semantics.go
  output_evidence.go
  install_semantics.go
  install_evidence.go
  chain_escalation.go
  legacy_plugin_fixture_test.go
  testdata/plugin_evasive_intent_cases.json
```

Existing files such as `semantic_arbiter.go`, `evidence_scorer.go`, `rules_input.go`, `rules_tool.go`, `rules_output.go`, and `rules_install.go` can delegate to these modules or be gradually reduced. Do not create a large generic rule engine if a small typed evaluator is clearer.

## 7. Semantic Intent Requirements

`semantic_intent` must produce a complete `api.ArbiterResult` on every decision. It must not read evidence-score output.

For input decisions, it must cover:

- protected prompt extraction: system prompt, developer instruction, raw safety rules, admin prompt wording;
- approval bypass: Chinese, English, pinyin, colloquial confirmation/authorization avoidance;
- Chinese evasive intent: bypass goal, masquerade method, wildcard obfuscation, encoding obfuscation, detector target, approval evasion, dangerous outcome, staged attack, stealth intent;
- concealed execution: Base64/hex/Unicode/charcode/PowerShell encoded command, split command, staged loader, execute sink;
- malicious code request: keylogger, silent upload, credential theft, destructive command, persistence, stealth;
- safe education: defensive explanation without generated attack code, with explicit false-positive protection.

For tool decisions, it must cover:

- command execution with obfuscation, encoded payloads, staged loaders, or external send targets;
- protected-file read/write attempts, including plugin files, OpenClaw config, hooks, skills, prompt files, credential stores, and host secrets;
- plugin disable or tamper attempts through shell, file edit, move, delete, rename, config patch, install, or indirect script generation;
- secret search and credential-store access, including path-based, glob-based, grep-based, and environment-variable access;
- read-to-exfil transitions when the current request or persisted chain contains taint;
- network fetch-and-execute patterns such as `curl|sh`, `wget|bash`, PowerShell download cradle, remote script execution, or package install from untrusted sources;
- destructive mutation intent such as recursive delete, permission weakening, ownership change, history/log cleanup, backup removal, or safety file overwrite;
- benign operational tool calls that should remain `L0/L1`, such as read-only listing, safe local build/test commands, and user-approved same-scope edits.

For output decisions, it must cover:

- protected prompt or developer instruction leakage;
- PEM/API key/token leakage;
- Chinese PII leakage;
- managed `/lynx-check` report text that should remain deliverable;
- metadata-only approval/status text that should not be replaced wholesale.

For install decisions, it must cover:

- Skill install from unknown or remote source;
- suspicious manifest content;
- hash/inventory drift;
- plugin self-modification through install paths.

## 8. Evidence Score Requirements

`evidence_score` must produce rule evidence independently of `semantic_intent`.

Each evidence item must include:

- stable rule id;
- module;
- kind;
- value or redacted value;
- severity;
- score delta;
- source;
- human-readable reason in `ScoreBreakdown`.

Evidence scoring must support:

- direct term hits;
- normalized term hits;
- pattern hits;
- family combination bonuses;
- stage-specific hard outcomes;
- structured tool request evidence from tool name, command arguments, path class, executable family, operation family, source kind, sink kind, network target, and command flags;
- chain context evidence;
- taint evidence;
- grant-related evidence.

The score-to-risk mapping remains monotonic:

- `L0 allow`: no meaningful signal;
- `L1 log_only`: low signal or safe education;
- `L2 warn`: suspicious but not execution-ready;
- `L3 require_approval` or `redact`: high risk requiring human boundary;
- `L4 block/deny`: protected prompt, secret, self-protection tamper, explicit malicious execution, or high-confidence exfiltration.

## 8.1 Tool Decision Deepening Requirements

The current Go tool rules are intentionally small high-confidence hard-deny checks. They are necessary but not sufficient. The strengthened design must add a deterministic tool interpretation layer before `semantic_intent` and `evidence_score` decide.

Go must build a typed tool request view for every `tool_call` decision. At minimum it must derive:

- `toolName`: original tool name and normalized family such as `shell`, `file_read`, `file_write`, `edit`, `network`, `install`, or `unknown`;
- `operationFamilies`: `read`, `write`, `delete`, `move`, `chmod`, `execute`, `network_send`, `network_fetch`, `install`, `archive`, `decode`, `encode`, `search`, `list`;
- `pathKinds`: `plugin_self`, `openclaw_config`, `hook`, `skill`, `secret`, `ssh_key`, `env_file`, `prompt_file`, `system_path`, `project_source`, `user_home`, `temp`;
- `sourceKinds`: `secret`, `protected_prompt`, `plugin_file`, `tainted_artifact`, `user_file`, `generated_payload`;
- `sinkKinds`: `external_network`, `clipboard`, `chat_output`, `file_write`, `process_exec`, `package_install`, `unknown`;
- `commandFlags`: `encoded_execution`, `shell_pipeline`, `download_execute`, `recursive_delete`, `permission_weakening`, `history_cleanup`, `wildcard_mutation`, `background_execution`, `silent_mode`;
- `networkTargets`: hostnames or URLs, redacted if needed;
- `executables`: normalized executable family such as `powershell`, `bash`, `curl`, `wget`, `python`, `node`, `git`, `rm`, `chmod`, `openclaw`;
- `grantScope`: the current decision's resource family and sink family used to compare against active grants.

`semantic_intent` must use that view to answer: "What is this tool call trying to accomplish?" It should return a complete `ArbiterResult`, not only a label. Representative semantic outcomes:

- `tool.semantic.secret_read`: reading credential or secret material is at least `L4/deny` unless the request is a narrowly scoped metadata check that does not reveal the value;
- `tool.semantic.self_protection_tamper`: modifying Lynx Guardian, OpenClaw hooks, safety config, or plugin disable state is `L4/deny`;
- `tool.semantic.encoded_execution`: encoded command execution or staged loader execution is `L3/require_approval` or `L4/deny` depending on sink and chain context;
- `tool.semantic.fetch_execute`: remote fetch followed by shell execution is `L4/deny`;
- `tool.semantic.tainted_external_send`: sending previously tainted data to an external sink is `L4/deny`;
- `tool.semantic.safe_operational_read`: listing files, reading non-sensitive project files, and running local tests/builds should remain `L0/L1` when no sensitive source, dangerous mutation, or external sink is present.

`evidence_score` must independently expose why the tool call was risky. Representative evidence rules:

- `tool.path.secret`: secret path or credential-store path;
- `tool.path.plugin_self`: plugin or hook self-protection path;
- `tool.op.recursive_delete`: destructive recursive delete;
- `tool.op.permission_weakening`: chmod/chown or ACL weakening on protected paths;
- `tool.command.encoded_execution`: PowerShell `-enc`, base64 decode-to-exec, `frombase64string`, charcode execution, or staged loader;
- `tool.command.download_execute`: `curl|sh`, `wget|bash`, PowerShell download cradle, remote script interpreter;
- `tool.flow.secret_to_external`: sensitive source and external sink in the same command;
- `tool.flow.taint_to_external`: persisted taint plus external sink in a later tool call;
- `tool.grant.scope_mismatch`: active grant exists but tool family, resource, sink, requester, channel, or chain does not match.

Keyword matches are allowed only as one evidence source. They must not be the whole tool decision model. The accepted implementation must prove structured tool behavior with tests that do not rely on one exact word order.

## 9. Chinese Evasive Intent Migration

The TypeScript detector is the migration baseline, not the final design boundary.

Go must port these elements from `src/guard/evasive-intent-cn.ts`:

- family names;
- literal terms;
- regex patterns translated into Go regex;
- normalization rules;
- score delta mapping;
- false-positive gates;
- detector-target support rules;
- standalone wildcard low-signal behavior;
- pinyin normalization such as `feng kong`, `shen pi`, `que ren`, `shou quan`, `rao guo`, `tong pei fu`, `luo di zhi xing`;
- family-combination severity rules.

Go must also add stronger coverage:

- Chinese mixed with English command names and executable names;
- renamed binary intent such as `ls/cat/python3` masquerade;
- split keyword and staged loader phrasing;
- encoded payload plus execution target;
- direct and indirect approval bypass in group/chat wording;
- multi-turn accumulation of bypass, detector target, masquerade, and dangerous outcome families.

Old plugin tests should be converted into a JSON fixture that both documents the expected behavior and prevents drift.

## 10. Chain And Multi-Turn Requirements

Go must use chain state as an active signal source:

- repeated evasive intent in the same session or conversation raises risk;
- previous denial plus new related request raises risk;
- read-sensitive then send-external raises risk;
- active grant can only reduce within same chain, requester, channel, risk family, and resource scope;
- pending approval should produce `require_approval` until resolved;
- lifecycle and timeout revocation must remain respected.

The plugin should pass available chain context, but Go must also load persisted chain and taint state from its repository before arbitrating.

## 11. Plugin Runtime Reduction

After Go parity is proven:

- `src/guard/evasive-intent-cn.ts` must be deleted from active runtime code or converted to test-only fixture material outside `src/`.
- `src/guard/safety-guard.ts` must stop calling `detectChineseEvasiveIntent()`.
- `src/runtime/visible-input-warning.ts` must derive display wording from Go `DecisionResponse` modules rather than old plugin-only module ids where possible.
- `test/evasive-intent-cn.test.ts` must be replaced by backend Go tests and runtime integration probes.
- plugin local L4 tests must still pass without Go.

## 12. Verification Requirements

Verification must include all of:

- Go unit tests for semantic and evidence arbiters.
- Go fixture tests generated from old plugin detector cases.
- TypeScript tests proving plugin active path no longer imports old rich detector files.
- API boundary tests proving Go decision routes still live only under `src/api/go-control-plane.ts` on the plugin side.
- Go tool decision tests proving command parsing, path classification, source/sink evidence, taint-to-external escalation, encoded execution, download-execute, destructive mutation, plugin tamper, and safe operational read boundaries.
- Root TypeScript compile.
- Backend `go test ./... -count=1`.
- Frontend tests only if response DTOs or display fields change.
- Runtime sync using `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`.
- Authenticated live probes through `http://127.0.0.1:18789/v1/chat/completions`.
- Go query API inspection showing decisions contain both arbiters and expected evidence.

## 13. Acceptance Criteria

This remediation is accepted only when all are true:

- Go `semantic_intent` catches every old plugin Chinese evasive true-positive fixture.
- Go `evidence_score` catches every old plugin Chinese evasive true-positive fixture with rule evidence and score breakdown.
- Go preserves old plugin false-positive protections for benign wildcard, plugin-help, and security-education text.
- Go adds stronger cases beyond old plugin coverage for mixed Chinese/English, pinyin, encoded execution, staged loader, and multi-turn evasion.
- Go tool decisions are stronger than the current four-rule baseline: semantic and evidence arbiters both understand structured tool operations, source/sink flow, path class, command flags, taint context, and grant scope.
- Plugin API boundaries from the runtime slimming plan remain enforced: `src/api.ts` is a compatibility re-export only, Go control-plane requests live only in `src/api/go-control-plane.ts`, and legacy remote safety service requests live only in `src/api/remote-safety-service.ts`.
- Plugin active runtime path no longer imports `src/guard/evasive-intent-cn.ts`.
- Plugin local L4 hard-deny still works when Go is unavailable.
- `DecisionResponse` records show two independent arbiter rows for representative probes.
- Frontend/local console can still display `block:false` warn/approval decisions correctly.
- Real OpenClaw runtime probes pass after sync.
