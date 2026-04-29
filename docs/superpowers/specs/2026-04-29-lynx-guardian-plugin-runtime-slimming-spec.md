# Lynx Guardian Plugin Runtime Slimming Spec

Date: 2026-04-29

## 1. Background

The Go control-plane remediation moved decision, grant, chain, task, Skill inventory, and token semantics into the Go backend. The plugin still contains too much transitional code under `src/`, especially in `src/runtime` and `src/guard`.

Current repo facts from 2026-04-29:

- `src/**/*.ts`: 98 files.
- `src/runtime/**/*.ts`: 60 files.
- `src/guard/**/*.ts`: 21 files.
- `index.ts`: about 3517 lines.
- `src/guard/safety-guard.ts`: about 1827 lines.
- `src/runtime/plugin-setup-helpers.ts`: about 1270 lines.
- Old remote security-service requests live in `src/api.ts`.
- Go control-plane request declarations and URL builders are mixed into runtime modules such as `src/runtime/decision-client.ts` and `src/runtime/local-console-client.ts`.

The current structure creates two problems:

1. Code volume did not drop enough after the Go migration.
2. Feature ownership is still scattered, so future work may accidentally extend old plugin-side strategy paths instead of the Go control plane.

## 2. Goal

Reduce the plugin runtime to a thin execution layer by completing a second-stage slimming pass:

- centralize plugin-side API clients under `src/api/`;
- separate local Go control-plane requests from old remote security-service requests;
- consolidate fragmented runtime stores into feature-owned bridge modules;
- delete or merge Go-owned policy and state code from the active plugin path;
- keep only the plugin responsibilities that must happen at the OpenClaw hook site.

This is not a cosmetic file move. The outcome must reduce both file count and responsibility scatter.

## 3. Non-Goals

- Do not remove local L4 hard-deny behavior.
- Do not remove sync-only output protection for `before_message_write` and `tool_result_persist`.
- Do not remove Feishu/webchat/OpenClaw delivery recovery until runtime parity is proven.
- Do not move hook registration into Go.
- Do not change Go database schema unless a plugin bridge needs an already planned route exposed.
- Do not treat broad test green as runtime proof; OpenClaw sync and runtime probes remain required after plugin behavior changes.

## 4. Target Architecture

The plugin-side `src/` tree should converge on these ownership areas:

```text
src/
  api/
    go-control-plane.ts
    remote-safety-service.ts
    index.ts
  hooks/
    setup.ts
    input-hooks.ts
    tool-hooks.ts
    output-hooks.ts
    lifecycle-hooks.ts
  local-guard/
    local-l4-fast-path.ts
    output-protection.ts
    sensitive-patterns.ts
  approval/
    approval-bridge.ts
    approval-context.ts
    approval-fingerprint.ts
  delivery/
    message-delivery.ts
    feishu-delivery.ts
    recent-delivery.ts
  lynx-check/
    lynx-check-bridge.ts
    scheduled-lynx-check.ts
    report-producers.ts
  console/
    ingest-client.ts
    event-builder.ts
    runtime.ts
    token-usage.ts
  openclaw/
    discovery.ts
    skill-supply-chain.ts
```

The exact final tree may differ when tests expose a better boundary, but the ownership rules below are fixed.

## 5. Ownership Rules

### 5.1 Plugin Keeps

- OpenClaw hook registration and hook-specific orchestration.
- Local L4 fast path for plugin disable, config mutation, protected secret reads, prompt/developer instruction extraction, explicit approval bypass, concealed execution chains, and high-confidence exfiltration.
- Sync-only output protection and redaction for sensitive persisted content.
- Go control-plane request execution and degraded fallback handling.
- Channel delivery bridge for Feishu/webchat/OpenClaw runtime integration.
- Local ephemeral approval promises where OpenClaw waits for a runtime callback.

### 5.2 Go Owns

- semantic intent judgement;
- evidence scoring;
- arbitration;
- long-term chain summary;
- long-term grant state;
- `/lynx-check` task state;
- Skill inventory and findings;
- token usage source semantics;
- decision persistence and query APIs.

Any plugin file that still implements these as a complete parallel owner must be removed, reduced to an adapter, or moved out of the active runtime path.

## 6. API Boundary

Create `src/api/` as the only plugin-side location for request declarations.

### 6.1 `src/api/go-control-plane.ts`

Owns local Go control-plane calls:

- `POST /lynx/internal/v1/decision/input`
- `POST /lynx/internal/v1/decision/tool`
- `POST /lynx/internal/v1/decision/output`
- `POST /lynx/internal/v1/decision/install`
- `POST /lynx/internal/v1/chains/update`
- `POST /lynx/internal/v1/approvals/request`
- `POST /lynx/internal/v1/approvals/:approvalId/resolve`
- `POST /lynx/internal/v1/grants/check`
- `POST /lynx/internal/v1/grants/revoke`
- `POST /lynx/internal/v1/tasks/lynx-check/start`
- `POST /lynx/internal/v1/tasks/lynx-check/:requestId/event`
- `POST /lynx/internal/v1/skills/inventory/sync`

Runtime modules may call functions from this file, but must not build these URLs themselves.

### 6.2 `src/api/remote-safety-service.ts`

Owns legacy remote service calls currently in `src/api.ts`:

- `/api/v1/register`
- `/api/v1/content_check`
- `/api/v1/tool_check`
- `/api/v1/push_record`
- `/api/v1/check_public_access`
- `/api/v1/skill_blacklist`
- `/api/v1/skill_check`

This file is kept only for compatibility while remote weighting is still referenced. It must not be confused with the Go control plane.

### 6.3 `src/api.ts`

`src/api.ts` becomes a short deprecated compatibility re-export. It must contain no fetch implementation and no endpoint literals after this remediation.

## 7. File Reduction Targets

The second-stage target is strict:

- `src/**/*.ts` at or below 60 files.
- `src/runtime/**/*.ts` at or below 20 files, with `runtime` no longer used as a catch-all directory.
- `src/guard/**/*.ts` at or below 10 files.
- `src/guard/policy/**/*.ts` removed from the active plugin runtime path unless a single type-only compatibility module is needed.
- `index.ts` reduced below 2200 lines, with hook registration and top-level orchestration only.
- No direct `/lynx/internal/v1` request declaration outside `src/api/go-control-plane.ts`.
- No direct `/api/v1` remote security-service request declaration outside `src/api/remote-safety-service.ts`.

If a runtime-proven bridge requires keeping more files temporarily, the plan must record the exact bridge, why it is still plugin-owned, and which runtime evidence is needed before removal.

## 8. Deletion And Consolidation Candidates

### 8.1 API and remote weighting

- Move `src/api.ts` implementation into `src/api/remote-safety-service.ts`.
- Move Go decision URL building out of `src/runtime/local-console-client.ts`.
- Replace `src/runtime/decision-client.ts` with `src/api/go-control-plane.ts` or reduce it to a compatibility export before deletion.
- Reassess `src/runtime/api-risk-adapter.ts` and `src/runtime/remote-weighting-service.ts`; if remote weighting remains, keep it in `src/api/remote-safety-service.ts` and a thin adapter only.

### 8.2 Approval bridge

Merge fragmented approval files into `src/approval/`:

- `approval-grant-store.ts`
- `local-tool-approval-store.ts`
- `pending-tool-approval-store.ts`
- `run-approval-context-store.ts`
- `workflow-authorization-store.ts`
- `feishu-local-approval-grant-store.ts`
- `feishu-local-approval-replay-store.ts`
- `feishu-run-continuation-store.ts`
- `tool-approval-runtime.ts`
- `approval-request-fingerprint.ts`
- `plugin-approval-compat.ts`

The final approval bridge may keep ephemeral local promise state, but durable grants must use Go.

### 8.3 Lynx check bridge

Merge task bridge and authorization files into `src/lynx-check/`:

- `lynx-check-run-store.ts`
- `managed-lynx-check-authorization-store.ts`
- `scheduled-lynx-check.ts`
- `discovery/manual-lynx-check.ts`
- report producer wrappers that call existing discovery and audit functions.

Go remains the task owner.

### 8.4 Delivery bridge

Merge delivery recovery files into `src/delivery/`:

- `lynx-message-delivery.ts`
- `lynx-feishu-direct-delivery.ts`
- `recent-active-delivery.ts`
- `message-decoration.ts`

The plugin keeps delivery recovery only where OpenClaw or Feishu integration needs runtime-local context.

### 8.5 Local console bridge

Merge local console files into `src/console/`:

- ingest client;
- event builder;
- runtime config/auth/port/launch/supervisor;
- token hook and token estimator;
- local console hook handlers.

The console bridge may still own event delivery, but not decision semantics.

### 8.6 Guard slimming

Reduce `src/guard` to local-only guard responsibilities:

- local L4 fast path;
- high-confidence sensitive output protection;
- protected plugin/runtime file normalization;
- optional visible warning text.

Go-owned policy modules must be deleted or reduced to type-only compatibility:

- `src/guard/policy/policy-engine.ts`
- `src/guard/policy/evidence-scorer.ts`
- `src/guard/policy/evidence-bundle-builder.ts`
- `src/guard/policy/environment-profile.ts`
- `src/guard/policy/attack-graph.ts`
- `src/guard/policy/artifact-taint-store.ts`
- `src/guard/policy/evidence-bundle.ts`
- `src/guard/policy/policy-types.ts`

`src/guard/safety-guard.ts` must become a facade or be replaced by smaller local-guard modules. It must not continue to be the plugin-side policy engine.

## 9. Verification Requirements

Each consolidation task must run focused verification before marking plan checkboxes complete:

- API boundary tests for endpoint ownership.
- TypeScript compile with `npx tsc --noEmit`.
- Focused Vitest tests for approval, output guard, decision broker, lynx-check bridge, and API boundary.
- Root Vitest once the file-count audit is introduced.
- Backend Go tests when plugin API changes interact with Go routes.
- Frontend tests only when shared contracts or local console display contracts change.
- Final OpenClaw runtime sync and live probes through the real gateway.

## 10. Acceptance Criteria

The remediation is accepted only when all are true:

- `src` file count is at or below the second-stage target.
- Go control-plane API requests are centralized under `src/api/go-control-plane.ts`.
- Remote security-service requests are isolated under `src/api/remote-safety-service.ts`.
- Old Go-owned policy/state files are deleted or no longer imported by active runtime code.
- `index.ts` is visibly hook orchestration rather than a policy or store owner.
- Local L4 hard deny still works without Go.
- Sync-only output protection still works without waiting for Go.
- Go decision, grant, chain, task, Skill, and token routes remain the semantic owners.
- Real OpenClaw runtime verification passes after sync.
