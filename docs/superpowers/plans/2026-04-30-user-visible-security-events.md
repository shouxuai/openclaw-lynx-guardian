# User-Visible Security Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default user-facing event count with user-visible security events while preserving raw audit events as a secondary evidence layer.

**Architecture:** Add a backend-owned security-events read model built from existing QA, tool-call, Lynx check, approval, and raw audit tables. Dashboard, audit-log, and QA detail pages consume this read model; raw hook-level audit remains available through the existing audit-event API and a secondary page.

**Tech Stack:** Go backend, SQLite, shared TypeScript DTOs, React + Vite frontend, Ant Design controls already used by the app, focused Go tests, Vitest/Testing Library, existing OpenClaw sync scripts.

---

## Source Spec

Implement against:

- `docs/superpowers/specs/2026-04-30-user-visible-security-events-spec.md`

Keep these baseline documents open while coding:

- `docs/superpowers/specs/2026-04-29-lynx-local-console-product-ux-data-correctness-spec.md`
- `docs/superpowers/plans/2026-04-29-lynx-local-console-product-ux-data-correctness.md`
- `docs/superpowers/specs/2026-04-22-local-console-ingest-contract-design.md`
- `docs/superpowers/specs/2026-04-22-local-console-query-api-dto-design.md`

## Current Worktree Warning

The current worktree already contains many backend/frontend/package changes. Before implementation, inspect those changes and avoid reverting user or earlier-session edits. This plan assumes the current files may already contain partial QA-chain and filter work.

## File Map

Shared contracts:

- Modify: `shared/src/query-dto.ts`
- Modify: `shared/src/index.ts`

Backend:

- Create: `backend/internal/repo/security_events.go`
- Modify: `backend/internal/repo/dashboard.go`
- Modify: `backend/internal/repo/qa_records.go`
- Modify: `backend/internal/routes/query.go`
- Modify if needed: `backend/internal/openapi/openapi.yaml`
- Regenerate if the repo requires it: `backend/internal/openapi/openapi.gen.go`
- Test: `backend/test/app_security_events_contract_test.go`
- Test: `backend/test/app_dashboard_security_events_test.go`
- Test: `backend/test/app_qa_records_contract_test.go`

Frontend:

- Create: `frontend/src/api/security-events.ts`
- Create or split from existing page: `frontend/src/pages/RawEventsPage.tsx`
- Modify: `frontend/src/pages/EventsPage.tsx`
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/QaRecordsPage.tsx`
- Modify: `frontend/src/components/feedback/SideDrawer.tsx`
- Modify: `frontend/src/app/nav-config.ts`
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/app/route-paths.ts`
- Modify: `frontend/src/styles/theme.css`
- Test: `frontend/test/pages/EventsPage.test.tsx`
- Test: `frontend/test/pages/DashboardPage.test.tsx`
- Test: `frontend/test/pages/QaRecordsPage.test.tsx`
- Test: `frontend/test/components/SideDrawer.test.tsx`
- Test: `frontend/test/app/nav-config.test.ts`

Plugin ingest:

- Modify only if backend tests prove missing data cannot be derived: `src/console/event-builder.ts`
- Modify only if install events lack source evidence: `src/runtime/hook-decision-handlers.ts`

Validation:

- Run: `npx tsc --noEmit`
- Run backend focused Go tests
- Run frontend focused Vitest tests
- Run: `node scripts/verify-dev-sync.mjs`
- Run: `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`
- Run a real OpenClaw path before claiming runtime behavior changed

---

## Phase 0: Baseline Audit

### Task 0.1: Confirm Current Data And Dirty Baseline

**Files:** none

- [ ] **Step 1: Inspect dirty files**

Run:

```powershell
git status --short
```

Expected:

- Existing unrelated changes are visible.
- No destructive cleanup is performed.

- [ ] **Step 2: Capture current runtime counts**

Run:

```powershell
$overview = Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:18789/lynx/dashboard/overview' -TimeoutSec 5
$overview.totals | ConvertTo-Json -Compress
$overview.riskDistribution | ConvertTo-Json -Compress
```

Expected:

- Existing overview still reflects raw audit counts.
- Record this as the before state in the implementation notes.

- [ ] **Step 3: Confirm raw category counts from SQLite**

Run:

```powershell
@'
import sqlite3, os
path=os.path.expandvars(r'%USERPROFILE%\.openclaw\lynx\data\lynx.db')
con=sqlite3.connect(f'file:{path}?mode=ro', uri=True)
cur=con.cursor()
for row in cur.execute("select category, count(*) from audit_events group by category order by count(*) desc"):
    print(f"{row[0]}: {row[1]}")
con.close()
'@ | python -
```

Expected:

- Raw categories still include hook-level groups such as `output`, `decision`, `agent`, `system`, `tool`, and `input`.
- This confirms why a new read model is needed.

---

## Phase 1: Shared DTO Contract

### Task 1.1: Add Security Event DTOs

**Files:**

- Modify: `shared/src/query-dto.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Write DTO shape**

Add these exported types to `shared/src/query-dto.ts` near the existing audit and QA DTOs:

```ts
export type SecurityEventKind = "input" | "tool" | "output" | "install" | "process";

export type SecurityProcessKind =
  | "conversation"
  | "skill_install"
  | "plugin_install"
  | "lynx_check"
  | "approval"
  | "batch_operation"
  | "other";

export interface SecurityEventListItemDto {
  eventId: string;
  eventKind: SecurityEventKind;
  processKind: SecurityProcessKind;
  processId?: string;
  qaRecordId?: string;
  runId?: string;
  sessionKey?: string;
  toolCallId?: string;
  title: string;
  summary?: string;
  objectLabel?: string;
  contentExcerpt?: string;
  occurredAtMs: number;
  completedAtMs?: number;
  riskLevel: RiskLevel;
  riskScore?: number;
  policyDecision?: string;
  enforcementAction: string;
  rawAuditEventIds: string[];
  rawAuditCount: number;
  detailJson?: Record<string, unknown>;
}

export interface SecurityEventDetailDto extends SecurityEventListItemDto {
  rawAuditEvents: AuditEventListItemDto[];
}

export type SecurityEventListResponse = PageResponse<SecurityEventListItemDto>;
```

- [ ] **Step 2: Extend QA detail DTO**

Update `QaRecordDetailDto`:

```ts
export interface QaRecordDetailDto extends QaRecordListItemDto {
  displayChainNodes: SecurityEventListItemDto[];
  chainNodes: QaChainNodeDto[];
  chainEdges: QaChainEdgeDto[];
  relatedToolCalls: ToolCallListItemDto[];
  relatedApprovals: ApprovalListItemDto[];
  relatedEvents: AuditEventListItemDto[];
  relatedDetections: LynxCheckListItemDto[];
}
```

- [ ] **Step 3: Verify shared type export**

Run:

```powershell
npm --prefix shared run build
```

Expected:

- Build succeeds.
- If no shared build script exists, run `npx tsc --noEmit` from repo root and record that path.

---

## Phase 2: Backend Security Events Read Model

### Task 2.1: Add Backend Contract Tests First

**Files:**

- Create: `backend/test/app_security_events_contract_test.go`

- [ ] **Step 1: Create focused fixture tests**

Create tests covering:

```go
func TestSecurityEventsListIncludesInputToolOutput(t *testing.T) {}
func TestSecurityEventsEveryEventHasRiskLevel(t *testing.T) {}
func TestSecurityEventsInstallEventUsesInstallDecision(t *testing.T) {}
func TestSecurityEventsLynxCheckProcessEvent(t *testing.T) {}
func TestSecurityEventsTimeIsTopLevelField(t *testing.T) {}
```

Each test should insert data through existing repository helpers or SQLite setup used by existing backend contract tests.

Expected event examples:

```json
{
  "eventKind": "input",
  "processKind": "conversation",
  "riskLevel": "L0",
  "enforcementAction": "allow"
}
```

```json
{
  "eventKind": "tool",
  "processKind": "conversation",
  "riskLevel": "L4",
  "enforcementAction": "block"
}
```

```json
{
  "eventKind": "install",
  "processKind": "skill_install",
  "riskLevel": "L3",
  "enforcementAction": "requireApproval"
}
```

- [ ] **Step 2: Run the new tests and confirm failure**

Run:

```powershell
go test ./backend/test -run SecurityEvents -count=1
```

Expected:

- Fails because `/lynx/security-events` and the repository do not exist yet.

### Task 2.2: Implement `SecurityEventsRepository`

**Files:**

- Create: `backend/internal/repo/security_events.go`

- [ ] **Step 1: Define repository types**

Implement these Go types and helpers:

```go
type SecurityEventsRepository struct {
    db *sql.DB
}

type SecurityEventListQuery struct {
    PageNum   int
    PageSize  int
    RiskLevel []string
    EventKind string
    Q         string
    FromMs    *int64
    ToMs      *int64
}
```

Helper behavior:

- `normalizeRiskLevel("")` returns `L0`.
- `maxRiskLevel(values...)` returns highest risk.
- `strongestEnforcement(values...)` returns the strongest action using the spec order.
- `rawAuditIds(events)` returns chronological raw IDs.

- [ ] **Step 2: Build dynamic event rows**

Use existing tables to build event rows:

- input events from `qa_records`
- tool events from `tool_calls`
- output events from `qa_records`
- install events from raw audit rows with install evidence
- process events from `lynx_checks` and standalone approvals

Implementation can assemble in Go first, then sort and paginate in memory. If row volume becomes large in testing, replace with SQL union queries without changing the route contract.

- [ ] **Step 3: Ensure all events have risk**

Before returning any row:

```go
if event.RiskLevel == "" {
    event.RiskLevel = "L0"
}
if event.EnforcementAction == "" {
    event.EnforcementAction = "allow"
}
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
go test ./backend/test -run SecurityEvents -count=1
```

Expected:

- Security events contract tests pass.

### Task 2.3: Add Routes

**Files:**

- Modify: `backend/internal/routes/query.go`
- Modify: `backend/internal/app/app.go` if repository wiring lives there

- [ ] **Step 1: Register list route**

Add:

```text
GET /lynx/security-events
```

Query parameters:

- `pageNum`
- `pageSize`
- `riskLevel`
- `eventKind`
- `q`
- `fromMs`
- `toMs`

- [ ] **Step 2: Register detail route**

Add:

```text
GET /lynx/security-events/:eventId
```

The detail route returns the selected security event plus `rawAuditEvents`.

- [ ] **Step 3: Verify API manually**

Run:

```powershell
Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:18789/lynx/security-events?pageNum=1&pageSize=5' -TimeoutSec 5 | ConvertTo-Json -Depth 6
```

Expected after sync:

- Response has `items`, `total`, `pageNum`, `pageSize`, and `totalPages`.
- Each item has `occurredAtMs` and `riskLevel`.

---

## Phase 3: Dashboard Uses New Event Counts

### Task 3.1: Write Dashboard Tests

**Files:**

- Create or modify: `backend/test/app_dashboard_security_events_test.go`

- [ ] **Step 1: Add risk bucket test**

Test name:

```go
func TestDashboardRiskDistributionUsesSecurityEvents(t *testing.T) {}
```

Fixture:

- 1 QA input event `L0`
- 1 tool event `L4`
- 1 output event `L0`
- several raw audit rows supporting those events

Expected:

- dashboard total event count is `3`
- dashboard risk distribution sums to `3`
- raw audit count remains separate and is greater than or equal to `3`

- [ ] **Step 2: Run failing test**

Run:

```powershell
go test ./backend/test -run DashboardRiskDistributionUsesSecurityEvents -count=1
```

Expected:

- Fails while dashboard still counts raw `audit_events`.

### Task 3.2: Switch Dashboard Repository

**Files:**

- Modify: `backend/internal/repo/dashboard.go`

- [ ] **Step 1: Add new totals**

Dashboard totals should expose:

```json
{
  "eventCount": 3,
  "highRiskEventCount": 1,
  "rawAuditEventCount": 12,
  "toolCallCount": 1,
  "approvalCount": 0,
  "lynxCheckCount": 0
}
```

Rules:

- `eventCount` uses security events.
- `rawAuditEventCount` uses `audit_events`.
- `riskDistribution` uses security events.
- `eventTrend` uses security events.
- `recentHighRiskEvents` uses security events or maps security events to the existing frontend shape.

- [ ] **Step 2: Run dashboard tests**

Run:

```powershell
go test ./backend/test -run Dashboard -count=1
```

Expected:

- Dashboard tests pass.

---

## Phase 4: QA Detail Display Chain

### Task 4.1: Add Display Chain To QA Detail

**Files:**

- Modify: `backend/internal/repo/qa_records.go`
- Test: `backend/test/app_qa_records_contract_test.go`

- [ ] **Step 1: Extend backend test**

Add assertions to the QA detail test:

```go
require.NotEmpty(t, detail["displayChainNodes"])
```

Expected display order for a one-tool QA:

```text
input -> tool -> output
```

Also assert:

- every node has `riskLevel`
- every node has `occurredAtMs`
- terminal/tool node exposes command detail when command data exists

- [ ] **Step 2: Populate `displayChainNodes`**

In `GetDetail`, call the security-events repository filtered by `qaRecordId` and assign:

```go
out["displayChainNodes"] = displayEvents
```

Keep existing fields:

- `chainNodes`
- `chainEdges`
- `relatedEvents`

- [ ] **Step 3: Run QA tests**

Run:

```powershell
go test ./backend/test -run QARecords -count=1
```

Expected:

- QA detail returns both raw chain and display chain.

---

## Phase 5: Frontend API And Audit Pages

### Task 5.1: Add Security Events Client

**Files:**

- Create: `frontend/src/api/security-events.ts`

- [ ] **Step 1: Implement list/detail client**

Add:

```ts
import type {
  CommonListQuery,
  SecurityEventDetailDto,
  SecurityEventKind,
  SecurityEventListResponse,
} from "@lynx/local-console-shared";
import { buildQueryString, fetchJson } from "./client";

export interface SecurityEventListQuery extends CommonListQuery {
  eventKind?: SecurityEventKind;
}

export function listSecurityEvents(query: SecurityEventListQuery = {}): Promise<SecurityEventListResponse> {
  return fetchJson<SecurityEventListResponse>(`/security-events${buildQueryString(query)}`);
}

export function getSecurityEventDetail(eventId: string): Promise<SecurityEventDetailDto> {
  return fetchJson<SecurityEventDetailDto>(`/security-events/${encodeURIComponent(eventId)}`);
}
```

- [ ] **Step 2: Run frontend typecheck**

Run:

```powershell
npm --prefix frontend run typecheck
```

Expected:

- Typecheck passes or reports only pre-existing unrelated failures that are documented before continuing.

### Task 5.2: Make `审计日志` Default To New Events

**Files:**

- Modify: `frontend/src/pages/EventsPage.tsx`
- Create or modify: `frontend/src/pages/RawEventsPage.tsx`
- Modify: `frontend/src/app/route-paths.ts`
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/app/nav-config.ts`

- [ ] **Step 1: Update Events page columns**

Default `审计日志` table columns:

```text
时间 | 事件类型 | 过程 | 对象/内容 | 风险等级 | 处置动作 | 关联问答 | 原始证据
```

The time column must render `formatTimestamp(event.occurredAtMs)` as its own column.

- [ ] **Step 2: Add raw audit secondary page**

Use the existing audit-events API and current raw table behavior on a page named `原始审计流水`.

Route recommendation:

```ts
rawEvents: "/raw-events"
```

- [ ] **Step 3: Add frontend tests**

Test cases:

```ts
it("renders user-visible security events by default", async () => {});
it("renders time as a standalone column", async () => {});
it("links to raw audit evidence count", async () => {});
it("keeps raw audit events on the secondary page", async () => {});
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
npm --prefix frontend run test -- EventsPage RawEventsPage
```

Expected:

- Focused tests pass.

---

## Phase 6: Dashboard Frontend Uses New Counts

### Task 6.1: Update Overview Labels And Charts

**Files:**

- Modify: `frontend/src/pages/DashboardPage.tsx`
- Test: `frontend/test/pages/DashboardPage.test.tsx`

- [ ] **Step 1: Rename metric labels**

Use:

- `安全事件`
- `高危事件`
- `工具调用`
- `原始审计流水`

Avoid labeling raw `audit_events` as the main `总事件`.

- [ ] **Step 2: Confirm charts use existing `riskDistribution` from new backend source**

No chart component should sum raw audit records.

- [ ] **Step 3: Add test**

Test:

```ts
it("renders risk distribution from user-visible security event counts", async () => {});
```

Expected:

- Chart total equals the mocked security-event total.
- Raw audit count appears as a separate metric.

---

## Phase 7: QA Drawer Display Chain

### Task 7.1: Make Drawer Wider

**Files:**

- Modify: `frontend/src/components/feedback/SideDrawer.tsx`
- Modify: `frontend/src/styles/theme.css`
- Test: `frontend/test/components/SideDrawer.test.tsx`

- [ ] **Step 1: Add width variant**

Add a prop:

```ts
size?: "normal" | "wide";
```

Use class:

```tsx
className={`side-drawer side-drawer--${size}`}
```

Default:

```ts
size = "normal"
```

- [ ] **Step 2: Add CSS**

```css
.side-drawer--wide {
  width: min(960px, calc(100vw - 32px));
}
```

Keep mobile:

```css
@media (max-width: 760px) {
  .side-drawer,
  .side-drawer--wide {
    width: 100vw;
  }
}
```

### Task 7.2: Show Display Chain By Default

**Files:**

- Modify: `frontend/src/pages/QaRecordsPage.tsx`
- Test: `frontend/test/pages/QaRecordsPage.test.tsx`

- [ ] **Step 1: Remove chain toggle from primary flow**

The display chain should render when detail exists:

```tsx
const displayNodes = detail?.displayChainNodes ?? [];
```

Do not require a `chainExpanded` button for normal users.

- [ ] **Step 2: Expand node card in place**

Track expanded node ID:

```ts
const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
```

In each node card:

```tsx
const expanded = expandedNodeId === node.eventId;
```

Click behavior:

```tsx
onClick={() => setExpandedNodeId((current) => current === node.eventId ? null : node.eventId)}
```

Expanded details render inside the same card.

- [ ] **Step 3: Remove bottom detail panel**

The old `qa-node-detail` section should not render after node selection.

- [ ] **Step 4: Add tests**

Tests:

```ts
it("shows the display chain by default when QA detail loads", async () => {});
it("expands a clicked node inside that node card", async () => {});
it("does not render the old bottom node detail panel", async () => {});
it("renders terminal command details inside the tool node", async () => {});
```

---

## Phase 8: Time Columns Across Touched Lists

### Task 8.1: Audit List Pages

**Files:**

- Modify as needed: `frontend/src/pages/EventsPage.tsx`
- Modify as needed: `frontend/src/pages/RawEventsPage.tsx`
- Modify as needed: `frontend/src/pages/QaRecordsPage.tsx`
- Modify as needed: `frontend/src/pages/ToolCallsPage.tsx`
- Modify as needed: `frontend/src/pages/LynxChecksPage.tsx`
- Modify as needed: `frontend/src/pages/ApprovalsPage.tsx`

- [ ] **Step 1: Ensure standalone time column**

Every list touched by this feature must have a column labeled `时间`, `开始时间`, or `发生时间`.

The timestamp must not live only under ID/title cells.

- [ ] **Step 2: Add focused tests**

Add or update tests for touched pages:

```ts
expect(screen.getByRole("columnheader", { name: "时间" })).toBeInTheDocument();
```

Use `开始时间` or `发生时间` if that is the actual visible column label.

---

## Phase 9: Verification And Runtime Sync

### Task 9.1: Run Local Quality Gates

**Files:** none

- [ ] **Step 1: Run backend focused tests**

Run:

```powershell
go test ./backend/test -run "SecurityEvents|Dashboard|QARecords" -count=1
```

Expected:

- Focused backend tests pass.

- [ ] **Step 2: Run frontend focused tests**

Run:

```powershell
npm --prefix frontend run test -- EventsPage DashboardPage QaRecordsPage SideDrawer
```

Expected:

- Focused frontend tests pass.

- [ ] **Step 3: Run TypeScript check**

Run:

```powershell
npx tsc --noEmit
```

Expected:

- TypeScript check passes, or failures are documented with exact file and line if they are pre-existing broad-suite failures.

### Task 9.2: Sync And Prove Runtime

**Files:** none

- [ ] **Step 1: Verify sync preflight**

Run:

```powershell
node scripts/verify-dev-sync.mjs
```

Expected:

- Verification succeeds.

- [ ] **Step 2: Sync packaged runtime**

Run:

```powershell
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
```

Expected:

- Gateway restarts.
- Health check is good.
- Packaged backend/frontend outputs refresh under `server/`.

- [ ] **Step 3: Validate live API**

Run:

```powershell
Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:18789/lynx/security-events?pageNum=1&pageSize=5' -TimeoutSec 5 | ConvertTo-Json -Depth 6
Invoke-RestMethod -UseBasicParsing -Uri 'http://127.0.0.1:18789/lynx/dashboard/overview' -TimeoutSec 5 | ConvertTo-Json -Depth 6
```

Expected:

- Security events endpoint returns events with risk levels.
- Dashboard totals use security-event counts.
- Raw audit count remains separately visible.

- [ ] **Step 4: Validate real OpenClaw path**

Run:

```powershell
docker exec openclaw-openclaw-gateway-1 sh -lc "openclaw agent --agent main --message 'reply with pong only' --json --timeout 90 2>&1"
```

Expected:

- Agent path completes.
- New input/output security events are visible in the local console API after the run.

## Completion Checklist

- [ ] `GET /lynx/security-events` works.
- [ ] Every user-visible event has `riskLevel`.
- [ ] Dashboard charts and risk buckets use user-visible events.
- [ ] Dashboard shows raw audit volume separately.
- [ ] Default `审计日志` page uses user-visible events.
- [ ] Raw audit page remains available.
- [ ] QA drawer is wide and shows display chain by default.
- [ ] Node click expands the clicked card, not a bottom detail panel.
- [ ] Skill/plugin install can appear as one event.
- [ ] `/lynx-check` can appear as one process event.
- [ ] Touched lists have a standalone time column.
- [ ] Focused backend and frontend tests pass.
- [ ] Runtime sync and real OpenClaw validation are complete.
