# Lynx Guardian File Ownership Runtime Slimming Spec

Date: 2026-04-29

## 1. Background

The previous Plugin Runtime Slimming plan reached broad numeric targets, but those targets are no longer enough. A plugin can satisfy `src/**/*.ts <= 60` and still keep the wrong responsibilities in the TypeScript runtime.

This spec supersedes the coarse file-count interpretation of the earlier runtime slimming plan. The new goal is file-level ownership: every file under `src/` must have a clear reason to stay in the plugin, move within the plugin, split with Go, or leave the active runtime path.

The Go decision engine strengthening work also changes the migration rule. The point is not to move every file to Go. The point is to move the expandable judgement brain to Go while keeping the plugin as:

- OpenClaw hook adapter;
- local runtime IO bridge;
- Feishu/webchat/OpenClaw delivery bridge;
- local deterministic L4 hard-deny fuse;
- sync-only output protection layer.

## 2. Revised Goal

Complete a third-stage runtime slimming pass driven by file ownership, not loose file count.

The pass must:

- review every current `src/**/*.ts` file;
- preserve `Discuss` files in TypeScript until there is a concrete migration benefit;
- migrate expandable corpora, detector vocabularies, semantic rules, evidence scoring, and strategy state into Go;
- keep local L4 hard-deny rules in the plugin even when Go has mirror evidence rules;
- avoid new runtime round trips for small detectors;
- remove or isolate root compatibility shims such as `src/api.ts`;
- keep the final plugin runtime readable as OpenClaw execution glue, not a second policy engine.

## 3. Non-Goals

- Do not migrate local deterministic L4 enforcement into Go as the only enforcement path.
- Do not move OpenClaw hook registration into Go.
- Do not move Feishu/webchat/OpenClaw delivery adapters into Go unless OpenClaw runtime APIs change.
- Do not move local console process launch, port selection, token file IO, or local webview route registration into Go decision code.
- Do not delete `Discuss` files just to reduce file count.
- Do not add an extra Go HTTP call for a detector if the same data can be included in an existing decision request.
- Do not claim success from local tests alone after runtime behavior changes; real OpenClaw sync and live probes remain required.

## 4. Migration Principles

### 4.1 Communication Cost Gate

Before moving a detector or helper into Go, answer these questions:

1. Is the data already present in the existing `DecisionRequest` for `input`, `tool`, `output`, or `install`?
2. If not, can it be added to that existing request without adding a new round trip?
3. Is the hook sync-only or latency-sensitive enough that it must decide locally?
4. Does the logic depend on local process, filesystem, path, or OpenClaw runtime APIs?

Move the logic to Go only when the answer is favorable. If migration requires a new per-hook HTTP request only for a small rule, keep it in TypeScript or batch it into the existing decision call.

### 4.2 What Moves To Go

Go owns expandable, frequently tuned, and strategy-like judgement:

- Chinese evasive intent corpora;
- prompt-injection phrase libraries that are not local L4;
- concealed-intent semantic families;
- Skill blacklist and suspicious manifest/content corpora;
- evidence-score rule tables;
- semantic-intent arbitration;
- session, chain, taint, grant, and approval policy state;
- non-L4 warning/approval scoring;
- cross-stage source/sink interpretation.

Go also keeps mirror corpora for L4 families so backend decisions, evidence, audit records, query APIs, and frontend/local-console displays can explain the same hard-deny families that the plugin blocks locally.

### 4.3 What Stays In The Plugin

The plugin keeps deterministic local enforcement that must work without Go. These L4 corpora are duplicated with Go instead of being migrated away from the plugin:

- credential/private key path reads;
- plugin tamper, rename, delete, disable, or integrity mutation;
- OpenClaw/Lynx config disable or safety bypass;
- OpenClaw stop/restart/down lifecycle control when framed as disabling protection;
- high-confidence sensitive source external send in a tool command;
- sync-only secret/PII/output persistence protection;
- execution-grade encoded loader chains where waiting for Go is unsafe.

For these families, plugin-local L4 is the first enforcement path. Go mirror L4 is the second line for consistent decision records, query evidence, chain context, and protection when a request reaches Go through another path.

### 4.4 Backend Test Layout Rule

Backend tests must follow the frontend layout convention: new backend tests live under `backend/test/`, not under `backend/internal/**`.

Existing `backend/internal/**/_test.go` files are migration debt. They should be converted to black-box or contract tests under `backend/test/` before adding more backend decision tests. If a current internal test depends on an unexported function, convert the assertion to one of these public surfaces instead of keeping the test colocated:

- HTTP route through the backend app/router;
- decision service public API;
- repository public API;
- migration public API such as `db.Migrate`;
- shared DTO contract.

Do not introduce new `backend/internal/**/_test.go` files in this slimming pass.

### 4.5 Discuss Means Keep

Files classified as `Discuss` stay in TypeScript for now. They are not migration candidates until there is a clear communication-cost win or a concrete product boundary change.

## 5. Ownership Labels

- `Keep TS`: the file remains in TypeScript with its current ownership class.
- `Split`: keep the TypeScript adapter, move corpora/scoring/state/semantic logic to Go.
- `Move TS`: keep TypeScript logic, but move it to the correct plugin ownership directory.
- `Delete`: remove from active runtime path after import and test migration.
- `Discuss Keep`: keep for now; revisit only with a concrete migration reason.

## 6. File Ownership Matrix

### 6.1 Root `src` Files

| File | Label | Required outcome |
| --- | --- | --- |
| `src/api.ts` | Delete | Remove the root shim. Update tests to assert it does not exist. Runtime code must import `src/api/go-control-plane.ts` or `src/api/remote-safety-service.ts` directly. |
| `src/blacklist.ts` | Split | Move local L4 command/path hard-deny into `src/local-guard/tool-command-hard-deny.ts`. Move warning-only and score-oriented command corpora into Go evidence rules if they are part of decision requests. |
| `src/config.ts` | Move TS | Inline legacy remote API config into `src/api/remote-safety-service.ts` or move to `src/api/remote-config.ts`. Do not keep a root catch-all config file for one legacy API. |
| `src/path-glob-protection.ts` | Split | Keep deterministic local path expansion for credential/private-key/plugin/config L4. Move semantic protected-reference label corpora to Go evidence rules. |
| `src/types.ts` | Keep TS | Keep OpenClaw plugin API types. A future approved split may separate hook types from delivery types if that improves owner clarity. |
| `src/utils.ts` | Split | Move resource sync, runtime path, network discovery, and OpenClaw utility functions to owner directories. Delete dead helpers. Do not leave root utility accumulation. |

### 6.2 `src/api`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/api/go-control-plane.ts` | Keep TS | The only plugin file allowed to declare `/lynx/internal/v1` requests. No other file builds Go control-plane URLs. |
| `src/api/remote-safety-service.ts` | Keep TS | The only plugin file allowed to declare legacy `/api/v1` remote safety requests. Mark as legacy and keep separated from Go. |

### 6.3 `src/approval`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/approval/approval-bridge.ts` | Split | Keep Feishu/native/local-chat transport, fingerprinting, and ephemeral callback coordination. Move durable grant semantics, workflow-auth policy, and approval final policy to Go or keep them as Go write-through adapters only. |

### 6.4 `src/console`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/console/event-builder.ts` | Split | Keep hook-event shaping and redaction before ingest. Move semantic interpretation, aggregation, and long-term status meaning to Go/shared DTOs. |
| `src/console/ingest-client.ts` | Keep TS | Keep as HTTP transport for local console ingest. No decision semantics. |
| `src/console/runtime.ts` | Keep TS | Keep process launch, port selection, auth token file, webview route registration, and backend runtime checks. Consider internal split only for readability. |
| `src/console/token-usage.ts` | Split | Keep hook capture and fallback estimation. Token source semantics, aggregation, and query ownership stay in Go/backend. |

### 6.5 `src/delivery`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/delivery/message-delivery.ts` | Split | Keep provider shaping, Feishu direct delivery, webchat gateway injection, and OpenClaw send adapters. Move delivery status persistence and long-term reporting to Go where routes exist. Split by channel if file remains too large. |
| `src/delivery/recent-delivery.ts` | Split | Keep short-lived route recovery needed by runtime delivery. Move long-term route history or delivery analytics to Go if product needs it. |

### 6.6 `src/discovery`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/discovery/discovery-hook-utils.ts` | Keep TS | Keep hook-level manual discovery orchestration. No semantic risk ownership. |
| `src/discovery/discovery-runtime-config.ts` | Keep TS | Keep local config read adapter. |
| `src/discovery/lynx-check-report-template.ts` | Move TS | Move to `src/lynx-check/report-template.ts` because it is report formatting, not discovery. |
| `src/discovery/lynx-check-trigger.ts` | Keep TS | Keep command trigger classification near hook handling. It is cheap local routing, not Go judgement. |
| `src/discovery/manual-lynx-check.ts` | Split | Keep manual trigger orchestration and report assembly. Move risk conclusions and persisted task state to Go; keep local script invocations as bridges. |
| `src/discovery/openclaw-discovery.ts` | Discuss Keep | Keep local network probing for now. It may move only if local console backend becomes the product owner for discovery. |
| `src/discovery/pending-discovery-store.ts` | Split | Keep short-lived pending attachment state. Move durable discovery state only if it becomes a product feature. |

### 6.7 `src/guard`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/guard/concealed-intent.ts` | Split | Move expandable concealed/evasive semantic corpora to Go. Keep execution-grade local L4 patterns in the plugin and mirror those L4 families in Go evidence/semantic corpora. |
| `src/guard/global-allowlist.ts` | Split | Move semantic allowlist to Go. Keep only local L4 false-positive suppressions under `src/local-guard` if needed. |
| `src/guard/prompt-injection.ts` | Split | Move prompt-injection corpora and warning/approval scoring to Go. Keep high-confidence protected prompt extraction L4 locally and mirror it in Go for evidence/audit. |
| `src/guard/risk-policy.ts` | Delete or Move TS | Remove from `src/guard`. Final approval/action policy is Go-owned. Any remaining adapter belongs under runtime decision handling, not guard. |
| `src/guard/safety-guard.ts` | Split | Reduce to type compatibility and thin wrappers, or replace with `src/local-guard` exports. It must not contain scoring, session anomaly, or semantic corpora. |
| `src/guard/system-prompt-guard.ts` | Split | Move low-confidence output semantic leak scoring to Go. Move high-confidence protected-output L4 to `src/local-guard/output-protection.ts` and keep a Go mirror for evidence/audit. |

### 6.8 `src/hooks`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/hooks/input-hooks.ts` | Split | Keep OpenClaw hook registration and orchestration. Decision logic must call local L4 and Go decision adapters, not local semantic scoring. |
| `src/hooks/tool-hooks.ts` | Split | Keep tool interception, OpenClaw approval callback handling, and local L4 first pass. Tool semantic/evidence judgement goes through Go. |
| `src/hooks/output-hooks.ts` | Split | Keep output hook wiring and sync-only protection. Use Go only where the hook can wait and the existing decision request is already present. |
| `src/hooks/lifecycle-hooks.ts` | Keep TS | Keep startup/shutdown/install/scheduled wiring. |
| `src/hooks/setup.ts` | Keep TS | Keep runtime assembly and hook registration composition. |

### 6.9 `src/local-guard`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/local-guard/local-l4-fast-path.ts` | Keep TS | Keep deterministic local L4 before Go. Expand only for true hard-deny cases. Every local L4 family added here must have a Go mirror evidence/semantic test unless it is impossible to represent in `DecisionRequest`. |
| `src/local-guard/output-protection.ts` | Keep TS | Keep sync-only output redaction/blocking. Remove dependency on `src/guard/safety-guard.ts`. Go mirrors protected-output L4 for audit when output decisions reach Go. |
| `src/local-guard/sensitive-patterns.ts` | Keep TS | Keep local secret/PII pattern fallback. Go mirrors but does not replace this local fuse. |

### 6.10 `src/lynx-check`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/lynx-check/lynx-check-bridge.ts` | Split | Keep artifact compatibility and runtime delivery bridge. Go remains task/status/record owner. |
| `src/lynx-check/report-producers.ts` | Discuss Keep | Keep local script runner for now. Move only if audit execution becomes backend-owned. |
| `src/lynx-check/scheduled-lynx-check.ts` | Split | Keep OpenClaw cron-store reconciliation. Go owns task state and delivery records. |

### 6.11 `src/runtime`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/runtime/decision-broker.ts` | Keep TS | Keep local L4 then Go decision orchestration. No semantic corpora. |
| `src/runtime/decision-context.ts` | Keep TS | Keep hook event to shared decision DTO mapping. |
| `src/runtime/hook-capabilities.ts` | Keep TS | Keep OpenClaw runtime capability probing. |
| `src/runtime/hook-decision-handlers.ts` | Split | Keep adapter code from `DecisionResponse` to hook result. No policy owner logic. |
| `src/runtime/lynx-audit-runtime.ts` | Keep TS | Keep managed audit action boundary. It is local execution safety. |
| `src/runtime/lynx-check-prompt.ts` | Move TS | Move to `src/lynx-check/prompt.ts`. |
| `src/runtime/override-runtime.ts` | Split | Keep local command parsing and callback plumbing. Move override policy and durable scope semantics to Go/approval. |
| `src/runtime/pending-override-store.ts` | Split | Move short-lived cache to `src/approval` if still needed. Durable approval/override state is Go-owned. |
| `src/runtime/plugin-entry-helpers.ts` | Split | Keep event parsing and route construction. Move policy helpers to decision/approval owners. |
| `src/runtime/plugin-runtime-config.ts` | Keep TS | Keep local plugin config resolution. |
| `src/runtime/plugin-runtime-helpers.ts` | Split | Keep path/env/message helpers. Move guard-context construction to decision context or local guard. |
| `src/runtime/plugin-setup-helpers.ts` | Split | Break apart by owner: approval, delivery, lynx-check, hooks, console. It must stop being a catch-all file. |
| `src/runtime/policy-runtime.ts` | Delete or Split | Go owns final policy. Keep only a small adapter from Go `DecisionResponse` to hook action if needed. |
| `src/runtime/remote-weighting-service.ts` | Delete or Legacy Isolate | This is old remote weighting. It must not compete with Go decision. If needed, isolate behind `remote-safety-service` compatibility only. |
| `src/runtime/requester-provenance-store.ts` | Move TS/Split | Move to `src/approval`. Keep short-lived requester/approver transport context; durable identity policy aligns with Go. |
| `src/runtime/token-optimizer-runner.ts` | Discuss Keep | Keep Python script runner for now. It is not decision ownership. Move to `src/optimizer` only under a future approved optimizer ownership pass. |
| `src/runtime/visible-input-warning.ts` | Split | Keep UI text shaping. Warning posture and risk modules should come from Go decision response. |

### 6.12 `src/skills`

| File | Label | Required outcome |
| --- | --- | --- |
| `src/skills/skill-guard.ts` | Split | Keep local Skill file IO, hash, quarantine, removal, and install hook bridge. Move blacklist corpora, suspicious content corpora, risk scoring, inventory findings, and durable Skill ownership to Go. |
| `src/skills/skill-hash.ts` | Keep TS | Keep deterministic local file hashing for install-time checks. |

## 7. Corpus Migration And L4 Duplication Requirements

Corpus migration is the highest-priority Go migration work. The first corpus families are:

- evasive/concealed Chinese intent corpora from guard files;
- prompt-injection and prompt-extraction semantic corpora, except local L4 extraction rules;
- Skill blacklist and suspicious content pattern corpora;
- non-L4 command warning and evidence corpora from `blacklist.ts`;
- semantic protected-reference labels from path protection.

Each migrated corpus must have:

- Go unit tests;
- old TypeScript behavior fixtures where available;
- false-positive cases;
- evidence rule IDs;
- no new plugin-to-Go round trip beyond existing decision calls.

L4 corpora are handled differently from non-L4 corpora:

- plugin keeps the local L4 corpus and enforcement code;
- Go keeps a mirrored L4 corpus for semantic/evidence decisions;
- tests must prove both lines catch the same representative L4 families;
- a local L4 deny must not require Go availability;
- a Go L4 decision must still produce normal arbiter, evidence, and audit records.

## 8. Audit Requirements

Add a file ownership audit that fails when:

- a new `src/**/*.ts` file is added without a declared ownership label;
- a new `backend/internal/**/_test.go` file exists;
- `src/api.ts` exists;
- `/lynx/internal/v1` appears outside `src/api/go-control-plane.ts`;
- `/api/v1` appears outside `src/api/remote-safety-service.ts`;
- rich semantic corpora remain in `src/guard` active runtime files;
- local output protection imports `src/guard/safety-guard.ts`;
- Go-owned policy/state files remain in active plugin runtime paths.

Add a backend test-layout audit that fails until existing internal backend tests have been moved or converted to `backend/test/`.

This audit replaces the old broad file-count-only success definition.

## 9. Verification Requirements

Each implementation task must run focused verification before checkbox completion:

- ownership audit tests;
- focused TS tests for local L4, output protection, API boundary, skill guard, approval, delivery, and hooks;
- Go tests for migrated corpora and evidence rules;
- `npx tsc --noEmit`;
- backend `go test ./... -count=1` when Go logic changes;
- frontend tests only when shared DTOs or local console display behavior changes;
- final `node scripts/verify-dev-sync.mjs`;
- final `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`;
- gateway health and authenticated runtime probes.

## 10. Acceptance Criteria

This remediation is accepted only when all are true:

- every current `src/**/*.ts` file has a documented owner and status;
- `Discuss Keep` files remain untouched unless a future approved plan changes them;
- expandable corpora and non-L4 semantic/evidence rules live in Go;
- local L4 hard-deny works when Go is unavailable;
- L4 corpora are intentionally duplicated in plugin and Go, with tests for both lines;
- backend tests live under `backend/test/`, matching the frontend `frontend/test/` convention;
- no new detector adds a separate Go round trip when an existing decision call can carry the data;
- `src/api.ts` is removed;
- `src/guard` no longer owns rich semantic judgement corpora in active runtime path;
- root catch-all files are reduced or moved to owner directories;
- Go remains decision/grant/chain/task/Skill/token semantic owner;
- Feishu/webchat/OpenClaw delivery bridge, sync-only output protection, and local console runtime bridge still work after sync;
- real OpenClaw runtime proof passes.
