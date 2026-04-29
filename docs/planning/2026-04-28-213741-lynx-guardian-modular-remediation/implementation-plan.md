# Lynx Guardian Modular Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Lynx Guardian 迁移为插件执行层 + Go 决策控制面，并按模块修复输入、工具、输出、审批、多轮、/lynx-check、Skill、Token 和前端可观测性。

**Architecture:** 先冻结 shared decision contract，再扩展 Go 后端的 decision/state/task 数据面，最后通过插件 DecisionBroker 接入可等待 hook。插件保留本地 L4 快速拒绝和 sync-only 本地保护，复杂判别、grant、chain、任务状态迁入 Go。

**Tech Stack:** TypeScript ESM plugin, Go + Gin backend, SQLite migrations, React + Vite frontend, shared TypeScript DTOs, focused tests plus OpenClaw runtime sync verification.

---

## Module Order

1. Contract and audit semantics.
2. Go database and decision API skeleton.
3. Deterministic evidence scorer and semantic arbiter adapter.
4. Plugin DecisionBroker and hook wiring.
5. Approval grant and multi-turn chain.
6. Output guard redesign.
7. `/lynx-check` task plane.
8. Skill supply-chain and Token usage.
9. Frontend observability.
10. Store cleanup and runtime verification.

## Module 1: Contract And Audit Semantics

**Files:**

- Create: `shared/src/decision.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/src/ingest.ts`
- Modify: `backend/internal/api/dto.go`
- Modify: `frontend/src/utils/status.tsx`

**Steps:**

- [ ] Add shared TypeScript decision DTOs matching `specs/01-decision-contracts.md`.
- [ ] Export decision DTOs from `shared/src/index.ts`.
- [ ] Add Go DTO structs for decision request/response in `backend/internal/api/dto.go`.
- [ ] Add status/color helpers so frontend no longer colors events from `block` alone.
- [ ] Run `npm --prefix shared run build` or the repo's shared build command.
- [ ] Run `go test ./...` from `backend`.
- [ ] Run `npx tsc --noEmit` from repo root.

**Acceptance:**

- `block:false + riskLevel=L2 + action=warn` can be represented.
- `DecisionResponse.audit.color` exists.
- No existing ingest DTO breaks.

## Module 2: Go Database And Decision API Skeleton

**Files:**

- Create: `backend/internal/db/migrations/002_control_plane.sql`
- Create: `backend/internal/decision/types.go`
- Create: `backend/internal/decision/service.go`
- Create: `backend/internal/decision/arbiters.go`
- Create: `backend/internal/repo/decisions.go`
- Create: `backend/internal/routes/decision.go`
- Modify: `backend/internal/app/app.go`
- Modify: `backend/internal/openapi/spec.go`

**Steps:**

- [ ] Add migration for `decisions`, `decision_arbiters`, `decision_evidence`, `chains`, `chain_events`, `taint_labels`, `approval_grants`, `lynx_check_tasks`, `lynx_check_evidence`, `skills`, `skill_inventory`, `skill_findings`, `skill_install_events`, `backend_health_events`.
- [ ] Add repository insert/list/get methods for decisions.
- [ ] Add route handlers for `/lynx/internal/v1/decision/input`, `/tool`, `/output`, `/install`.
- [ ] Return deterministic stub decisions first: ordinary text -> L0 allow; system prompt extraction -> L4 deny; credential path -> L4 deny.
- [ ] Persist every decision and arbiter result.
- [ ] Add backend tests for migration and decision route persistence.
- [ ] Run `go test ./...` from `backend`.

**Acceptance:**

- Internal decision routes work with loopback + ingest auth.
- Decisions can be queried from DB.
- L4 system prompt extraction returns `block:true`.
- Warn-but-not-block case returns `block:false` with `eventSeverity=warn`.

## Module 3: Evidence Scorer And Semantic Arbiter

**Files:**

- Create: `backend/internal/decision/evidence_scorer.go`
- Create: `backend/internal/decision/semantic_arbiter.go`
- Create: `backend/internal/decision/rules_input.go`
- Create: `backend/internal/decision/rules_tool.go`
- Create: `backend/internal/decision/rules_output.go`
- Create: `backend/internal/decision/arbitration.go`

**Steps:**

- [ ] Implement independent evidence scoring with matched rules and score breakdown.
- [ ] Implement semantic arbiter interface with local deterministic rules first.
- [ ] Cover mixed Chinese/English system prompt extraction terms.
- [ ] Cover Chinese/pinyin approval bypass terms.
- [ ] Cover data exfiltration triangle: sensitive source + external URL + send action.
- [ ] Cover hidden execution chain terms: base64, Unicode escape, split command, evade detector.
- [ ] Add arbitration to pick highest risk and strictest action.
- [ ] Add tests for each rule family.
- [ ] Run `go test ./...` from `backend`.

**Acceptance:**

- Two arbiter results are stored separately.
- System prompt extraction logs matched terms and score delta.
- Approval bypass can warn/block even when `block:false` is not selected.

## Module 4: Plugin DecisionBroker And Hook Wiring

**Files:**

- Create: `src/runtime/decision-client.ts`
- Create: `src/runtime/decision-broker.ts`
- Create: `src/runtime/decision-context.ts`
- Create: `src/runtime/local-l4-fast-path.ts`
- Create: `src/runtime/hook-decision-handlers.ts`
- Modify: `index.ts`
- Modify: `src/runtime/local-console-client.ts`
- Test: `test/decision-broker.test.ts`
- Test: `test/local-l4-fast-path.test.ts`

**Steps:**

- [ ] Implement local L4 fast path for plugin-disable, config mutation, plugin file tamper, credential read, system prompt raw extraction, data exfiltration, hidden execution chain.
- [ ] Implement decision client for Go internal endpoints.
- [ ] Implement DecisionBroker pending promise cache and completed decision cache.
- [ ] Wire `message_received` to prefetch input decision.
- [ ] Wire `before_dispatch` and `before_agent_start` to wait input decision.
- [ ] Add `before_prompt_build` for short Go-provided prompt context.
- [ ] Wire `before_tool_call` to wait tool decision.
- [ ] Wire `message_sending` to wait outbound decision.
- [ ] Keep `tool_result_persist` and `before_message_write` sync-only using cached decision and local redaction.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run focused tests.

**Acceptance:**

- Hard L4 does not wait for Go.
- Backend timeout produces degraded decision logs.
- sync-only hooks do not return Promise.
- `index.ts` loses inline decision logic instead of gaining more branches.

## Module 5: Approval Grant And Multi-Turn Chain

**Files:**

- Create: `backend/internal/chain/service.go`
- Create: `backend/internal/grants/service.go`
- Create: `backend/internal/repo/chains.go`
- Create: `backend/internal/repo/grants.go`
- Create: `backend/internal/routes/chains.go`
- Create: `backend/internal/routes/grants.go`
- Modify: `src/runtime/tool-approval-runtime.ts`
- Modify: `src/runtime/run-approval-context-store.ts`
- Modify: `index.ts`

**Steps:**

- [ ] Add chain update endpoint and chain summary response.
- [ ] Add grant check/revoke endpoints.
- [ ] Convert approval allow into `allow-current-chain`.
- [ ] Make Go decide whether grant applies.
- [ ] Revoke grant on risk escalation, target change, channel mismatch, actor mismatch, timeout, `agent_end`, `session_end`, `subagent_ended`.
- [ ] Keep plugin old stores as read fallback only during migration.
- [ ] Add tests for same-chain allow and risk escalation revoke.
- [ ] Run `go test ./...` and `npx tsc --noEmit`.

**Acceptance:**

- Same requester + same chain + same target can continue.
- New L4 ignores grant.
- Grant revoked reason appears in audit events.

## Module 6: Output Guard Redesign

**Files:**

- Modify: `src/guard/result-guard.ts`
- Modify: `src/guard/safety-guard.ts`
- Modify: `src/guard/system-prompt-guard.ts`
- Modify: `src/guard/sensitive.ts`
- Modify: `src/runtime/hook-decision-handlers.ts`
- Modify: `index.ts`
- Test: `test/output-guard-redesign.test.ts`

**Steps:**

- [ ] Introduce output sink classification.
- [ ] Change default behavior from whole-message replacement to minimal redaction when safe.
- [ ] Keep L4 whole-message replacement for secrets, private keys, PII bulk leak, system prompt raw text.
- [ ] Ensure metadata-only summaries remain warn/allow.
- [ ] Make `message_sending` final outbound kill switch.
- [ ] Add tests for normal Chinese output, metadata-only output, PEM key, resident ID, outbound sensitive text.
- [ ] Run focused tests and `npx tsc --noEmit`.

**Acceptance:**

- Normal assistant output is not replaced by diagnostic text.
- Sensitive values are still blocked/redacted.
- `message_sending` can still cancel final outbound content.

## Module 7: `/lynx-check` Task Plane

**Files:**

- Create: `backend/internal/tasks/lynxcheck.go`
- Create: `backend/internal/repo/lynxcheck_tasks.go`
- Create: `backend/internal/routes/lynxcheck_tasks.go`
- Modify: `src/runtime/lynx-check-run-store.ts`
- Modify: `src/runtime/scheduled-lynx-check.ts`
- Modify: `src/discovery/manual-lynx-check.ts`
- Modify: `src/runtime/lynx-message-delivery.ts`
- Modify: `index.ts`

**Steps:**

- [ ] Add Go task state machine for manual and scheduled `/lynx-check`.
- [ ] Add task start/update/complete endpoints.
- [ ] Move facts/evidence/report skeleton persistence to Go.
- [ ] Keep LLM/skill report generation as a worker step, not task owner.
- [ ] Keep plugin delivery helper but report delivery attempts back to Go.
- [ ] Reduce plugin run store to compatibility bridge.
- [ ] Add tests for manual task and scheduled task lifecycle.
- [ ] Run backend tests and TypeScript checks.

**Acceptance:**

- Manual and scheduled checks share the same task table.
- Go owns task status.
- Report generation can still use OpenClaw/skills.

## Module 8: Skill Supply Chain And Token Usage

**Files:**

- Modify: `src/skills/skill-guard.ts`
- Modify: `src/skills/skill-hash.ts`
- Create: `backend/internal/skills/service.go`
- Create: `backend/internal/repo/skills.go`
- Create: `backend/internal/routes/skills.go`
- Modify: `src/runtime/local-console-token-hook.ts`
- Modify: `backend/internal/repo/tokens.go`
- Modify: `frontend/src/api/tokens.ts`

**Steps:**

- [ ] Register `before_install` in plugin.
- [ ] Send install scan requests to Go.
- [ ] Sync installed Skill inventory to Go.
- [ ] Store hash baseline, current hash, findings, last seen.
- [ ] Keep `/lynx-check` consuming Skill inventory.
- [ ] Change Token model to distinguish actual, estimated, unavailable.
- [ ] Ensure estimated usage does not enter official cost totals.
- [ ] Add tests for install scan, inventory sync, token actual/estimated separation.

**Acceptance:**

- Skill install can be blocked before installation.
- Frontend can list installed Skills.
- Token totals do not mix estimates into actual cost.

## Module 9: Frontend Observability

**Files:**

- Create: `frontend/src/api/decisions.ts`
- Create: `frontend/src/api/chains.ts`
- Create: `frontend/src/api/grants.ts`
- Create: `frontend/src/api/skills.ts`
- Create: `frontend/src/pages/DecisionsPage.tsx`
- Create: `frontend/src/pages/ChainsPage.tsx`
- Create: `frontend/src/pages/GrantsPage.tsx`
- Create: `frontend/src/pages/SkillsPage.tsx`
- Modify: `frontend/src/pages/EventsPage.tsx`
- Modify: `frontend/src/pages/ToolCallsPage.tsx`
- Modify: `frontend/src/pages/ApprovalsPage.tsx`
- Modify: `frontend/src/pages/LynxChecksPage.tsx`
- Modify: `frontend/src/pages/TokensPage.tsx`
- Modify: `frontend/src/app/nav-config.ts`
- Modify: `frontend/src/app/router.tsx`

**Steps:**

- [ ] Repair readable Chinese nav labels.
- [ ] Add Decisions, Chains, Grants, Skills API clients.
- [ ] Add pages using existing console layout and tables.
- [ ] Update Events detail to show matched rules, score breakdown, winning arbiter, `block:false` explanation.
- [ ] Update Tool Calls detail to show taint, exfiltration, approval/grant.
- [ ] Update Approvals detail to show grant scope and revoked reason.
- [ ] Update Lynx Checks detail to show task state and evidence.
- [ ] Update Tokens page to separate actual/estimated/unavailable.
- [ ] Run frontend build and local webview visual check.

**Acceptance:**

- Operators can see why a request was warn but not blocked.
- Skills are visible.
- Chinese text is readable.
- Existing pages remain functional.

## Module 10: Store Cleanup And Runtime Verification

**Files:**

- Modify: `index.ts`
- Modify: obsolete or compatibility files under `src/runtime/*store.ts`
- Modify: `skills/lynx-guardian-lesson/*` only if report prompts must mention new control plane.
- Modify: `scripts/sync-openclaw-dev-ready.ps1` only if packaging needs new Go outputs.

**Steps:**

- [ ] Identify store files still actively written.
- [ ] Switch writes to Go where possible.
- [ ] Leave compatibility readers for one migration cycle.
- [ ] Remove dead branches from `index.ts`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `go test ./...` in `backend`.
- [ ] Run frontend build.
- [ ] Run `node scripts/verify-dev-sync.mjs`.
- [ ] Run `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`.
- [ ] Verify `http://127.0.0.1:18789/healthz`.
- [ ] Run real OpenClaw probes for input, tool, output, approval, `/lynx-check`, Skill install scan if available.

**Acceptance:**

- Runtime path proves new behavior.
- Local console shows decisions and evidence.
- Old high-risk examples still block.
- Normal business examples still pass.

## Execution Recommendation

Use separate worktrees or branches per module:

- `codex/lynx-contracts-control-plane`
- `codex/lynx-go-decision-api`
- `codex/lynx-plugin-decision-broker`
- `codex/lynx-approval-chain-grants`
- `codex/lynx-output-guard-redesign`
- `codex/lynx-check-task-plane`
- `codex/lynx-skill-token-observability`
- `codex/lynx-frontend-observability`

Each module should finish with focused tests before integration.

