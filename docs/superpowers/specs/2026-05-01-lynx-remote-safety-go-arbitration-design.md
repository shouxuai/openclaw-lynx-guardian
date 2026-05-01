# Lynx Remote Safety Go Arbitration Design

Date: 2026-05-01

## 1. Background

`risk-boundary-hardening` has been merged into `feat/stack`, so the current branch has stronger separation between user input preservation, prompt-build input handling, output mutation, and approval-description limits.

The remaining safety gap is not the risk boundary itself. It is where remote safety intelligence is executed and how it participates in final judgement.

Current code facts:

- The TypeScript plugin still calls the remote safety service directly through `src/api/remote-safety-service.ts`.
- That file contains the legacy base URL `http://model.shouxu.tech:9051` and declares `/api/v1/register`, `/content_check`, `/tool_check`, `/push_record`, `/check_public_access`, `/skill_blacklist`, and `/skill_check`.
- `src/runtime/remote-weighting-service.ts` wraps those calls as fail-soft weighting and best-effort reporting.
- The active hooks import remote weighting helpers from their dependency bundles.
- The local Go control plane already has decision endpoints under `/lynx/internal/v1/decision/<stage>`.
- The Go decision service already evaluates two arbiters, `semantic_intent` and `evidence_score`, then chooses the stricter result.

That means the project is in a mixed state:

```text
Plugin
  -> local fast path
  -> Go decision API for part of the judgement
  -> direct remote safety API for extra weighting/reporting
```

This mixed state weakens the desired control-plane boundary. The plugin is still a network client for the external safety service, and remote results are not persisted as first-class Go decision evidence.

## 2. Goal

Move all plugin remote safety traffic behind the local Go backend and make remote safety output a first-class participant in Go decision arbitration.

The target is:

- The plugin only calls local Go endpoints.
- Go owns the remote safety client, remote request timeout, remote failure policy, and remote result mapping.
- Remote safety responses appear in `DecisionResponse.arbiters` as a named `remote_safety` arbiter.
- Final action selection remains strict-only: remote safety may raise severity, but it may never lower `semantic_intent`, `evidence_score`, or local L4 hard-deny.
- Remote unavailability is visible and diagnostic, but it does not remove local protection.
- The previous dual-track idea becomes concrete in Go: semantic line plus evidence line remain independent, and remote safety becomes an external intelligence line that feeds the same strict arbitration layer.

## 3. Non-Goals

- Do not move OpenClaw hook registration into Go.
- Do not remove plugin local L4 fast path for cases that must stop before any backend round trip.
- Do not make remote safety a required dependency for local protection.
- Do not allow a remote "safe" response to downgrade a local, semantic, evidence, resource, script, taint, or hard-deny result.
- Do not add an LLM dependency to the Go decision path.
- Do not claim runtime behavior changed from docs, tests, or local build output alone. Runtime proof still requires sync plus a real OpenClaw path.
- Do not keep a hidden TypeScript fallback that still calls `model.shouxu.tech` from the plugin.

## 4. Target Flow

```text
OpenClaw hook
  -> plugin extracts runtime context
  -> plugin local L4 fast path checks immediate hard boundaries
  -> plugin calls local Go only
       POST /lynx/internal/v1/decision/input
       POST /lynx/internal/v1/decision/tool
       POST /lynx/internal/v1/decision/output
       POST /lynx/internal/v1/decision/install
  -> Go loads persisted chain, taint, grant, and policy context
  -> Go runs semantic_intent
  -> Go runs evidence_score
  -> Go calls remote safety service through bounded client
  -> Go maps remote response to remote_safety ArbiterResult
  -> Go selects the strictest result
  -> Go persists decision, arbiters, evidence, audit, and degraded metadata
  -> plugin executes the returned DecisionResponse
```

The plugin may still execute a local L4 fast path before Go when waiting is unsafe. That local result must remain monotonic: if it produces L4 deny, Go and remote safety cannot reduce it.

## 5. Arbiter Model

### 5.1 Existing Lines

`semantic_intent` answers:

- What is the user or tool trying to accomplish?
- Is the request asking for bypass, concealed execution, self-protection tamper, protected prompt extraction, secret access, exfiltration, or safe education?
- Does chain history change the intent classification?

`evidence_score` answers:

- What concrete evidence exists?
- Which rules fired?
- Which source, sink, path, script, taint, resource, provider, or chain signals support the result?
- What score and score breakdown explain the decision?

These two lines must stay independent. Evidence scoring must not be only a formatting layer for semantic intent, and semantic intent must not be a wrapper around score totals.

### 5.2 New Remote Line

`remote_safety` answers:

- What does the external safety center think about this content, tool operation, output, install, public exposure, or skill?
- Which remote category labels and remote risk level were returned?
- Did remote safety produce a stronger result than the local Go lines?
- Was the remote service unavailable, timed out, disabled, or malformed?

`remote_safety` is an arbiter, not a hidden multiplier.

It should return a normal `api.ArbiterResult`:

- `Arbiter`: `remote_safety`
- `RiskLevel`: mapped from remote `risk_level`
- `Action`: mapped from remote risk and stage
- `Score`: remote-derived score on the same local scale
- `MatchedModules`: stable module names such as `remote:content_check`, `remote:tool_check`, `remote:skill_check`
- `Evidence`: redacted remote labels and result facts
- `ScoreBreakdown`: one or more entries explaining the remote mapping
- `Reason`: concise diagnostic explanation

When the remote service is unavailable, the arbiter should return `L0/allow` with a diagnostic reason and should set response metadata, not matched risk modules. This keeps the remote failure visible without weakening local decisions or creating false risk hits.

## 6. Strict Arbitration Rule

Final selection remains monotonic:

```text
winner = stricter(semantic_intent, evidence_score, remote_safety)
```

Strictness order follows the existing Go priority:

```text
risk:   L4 > L3 > L2 > L1 > L0
action: deny > block > require_approval > redact > warn > log_only > allow
```

Rules:

- If `remote_safety` is stricter than both Go lines, remote wins and the final action is upgraded.
- If `semantic_intent` or `evidence_score` is stricter than remote, the local Go line wins.
- If remote returns safe but a Go line returns L3 or L4, the Go line wins.
- If remote fails, the strictest local Go result wins.
- If plugin local L4 fast path fires before Go, the plugin executes that hard deny and records the local L4 result through the existing local decision path.

## 7. Remote Endpoint Mapping

The legacy remote endpoints map into Go as follows:

| Legacy endpoint | Current TS caller role | Go owner | Decision participation |
| --- | --- | --- | --- |
| `/api/v1/register` | startup/user best effort | Go remote client | best-effort identity registration, not an arbiter |
| `/api/v1/content_check` | input and output weighting | Go `remote_safety` arbiter | input/output decision arbiter |
| `/api/v1/tool_check` | tool weighting | Go `remote_safety` arbiter | tool decision arbiter |
| `/api/v1/push_record` | risk reporting | Go remote reporting side effect after decision persistence | not an arbiter |
| `/api/v1/check_public_access` | public exposure check | Go remote client plus evidence adapter | input or environment evidence when used |
| `/api/v1/skill_blacklist` | skill inventory and install checks | Go skills service or install decision support | install decision evidence |
| `/api/v1/skill_check` | specific skill safety check | Go `remote_safety` install arbiter | install decision arbiter |

The implementation may land this in phases, but completion requires no active plugin code path to call those legacy remote endpoints directly.

## 8. Configuration

Go should own remote configuration:

- `LYNX_REMOTE_SAFETY_ENABLED`
- `LYNX_REMOTE_SAFETY_BASE_URL`
- `LYNX_REMOTE_SAFETY_TIMEOUT_MS`
- `LYNX_REMOTE_SAFETY_REGISTER_ENABLED`
- `LYNX_REMOTE_SAFETY_REPORT_ENABLED`

Recommended defaults:

- Enabled when a base URL is configured.
- Base URL may default to the legacy service only if the project wants behavior parity with the existing plugin. A test environment should explicitly disable or replace it with an `httptest` server.
- Timeout must be short enough that remote safety cannot freeze hook execution. The initial target is 1500 to 2500 ms.
- Register and push-record are best-effort side effects. They must never control allow, block, deny, or approval.

The plugin should not read or store the external remote safety URL. It should only know the local Go base URL and local auth token.

## 9. Data Contracts

Shared TypeScript contract changes:

- Add `remote_safety` to `DecisionArbiterName`.
- Add `remote_safety` to `WinningArbiter`.
- Add `remote` to `EvidenceSource`.

Go DTO contract changes:

- Keep string-backed DTO types.
- Use stable string values matching shared TypeScript.
- Ensure JSON output stores `remote_safety` in `decision_arbiters`.

No new database table is required if `decision_arbiters` and `decision_evidence` already store arbiter/evidence strings. The repository should continue to persist every arbiter row and every evidence item.

## 10. Plugin Boundary

The plugin should keep:

- hook registration
- context extraction
- local L4 fast path
- Go local client
- runtime effect execution
- delivery bridges
- sync-only output fallback for hooks that cannot wait

The plugin should stop owning:

- external remote safety base URL
- external remote safety timeout
- external remote safety response parsing
- external remote safety risk mapping
- external remote reporting side effects
- direct remote skill blacklist fetches

`src/api/remote-safety-service.ts` and `src/runtime/remote-weighting-service.ts` should be deleted or reduced to non-runtime test fixtures only. The preferred final state is deletion.

## 11. Failure Semantics

Remote safety failure must be fail-soft for availability and fail-closed only when local evidence already demands it.

Examples:

- Remote timeout, local `semantic_intent=L0`, local `evidence_score=L0`: final `L0/allow`, metadata says remote unavailable.
- Remote timeout, local `evidence_score=L4/deny`: final `L4/deny`, metadata says remote unavailable.
- Remote says safe, local `semantic_intent=L4/deny`: final `L4/deny`.
- Remote says L4, both local Go lines say L0: final `L4/deny` via `remote_safety`.
- Remote malformed response: final follows local Go lines, metadata says remote malformed.

This preserves the existing fail-soft direction while making the result auditable through Go.

## 12. Testing Requirements

Minimum tests:

- TypeScript ownership test proving no active plugin file contains `model.shouxu.tech` or `/api/v1/content_check`.
- TypeScript ownership test proving no active plugin file imports `src/api/remote-safety-service.ts` or `src/runtime/remote-weighting-service.ts`.
- Shared DTO test or TypeScript compile proving `remote_safety` is a valid arbiter.
- Go remote client tests using `httptest` for content, tool, skill, timeout, HTTP error, and malformed response.
- Go decision service test proving remote L4 upgrades local L0.
- Go decision service test proving remote safe cannot downgrade semantic L4.
- Go decision service test proving remote safe cannot downgrade evidence L4.
- Go decision service test proving remote unavailable preserves local decision and records diagnostic metadata.
- Repository test proving `decision_arbiters` stores the `remote_safety` row and `decision_evidence` stores remote evidence.
- Runtime sync proof after implementation: `node scripts/verify-dev-sync.mjs`, `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`, health probe, and a real OpenClaw decision path.

## 13. Acceptance Criteria

The migration is accepted only when all of these are true:

- The plugin's active runtime code calls only local Go for safety decisions and remote-safety-related operations.
- The Go backend owns all external remote safety requests.
- `DecisionResponse.arbiters` contains `semantic_intent`, `evidence_score`, and `remote_safety` for decision paths where remote safety is enabled or diagnostically attempted.
- Remote L4 can raise a local L0 decision.
- Remote safe cannot reduce a local L3/L4 decision.
- Remote failure cannot disable local protection.
- Decision persistence records the remote arbiter and remote evidence.
- Focused Go tests, TypeScript compile, focused Vitest ownership tests, and runtime sync proof pass.

## 14. Open Decision

The only product decision left before implementation is the default remote base URL:

- Option A: default to disabled unless `LYNX_REMOTE_SAFETY_BASE_URL` is set. This is cleaner for local development and tests.
- Option B: default to the legacy URL to preserve current runtime behavior automatically. This has fewer behavior surprises but keeps a network dependency active by default.

Recommended implementation: Option A in tests and development, with the packaged runtime explicitly setting the legacy URL if the product still wants remote safety enabled by default.
