# Lynx Local Console Product UX And Data Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the backend/shared contracts first, then build the user-facing `问答记录` workflow so one complete prompt-answer cycle can be expanded into a readable tool chain.

**Architecture:** Keep the existing local-console V1 foundation. The backend owns pagination totals, token semantics, QA record grouping, and QA tool-chain assembly. The frontend consumes those contracts through list/detail pages, with existing advanced pages retained for diagnosis.

**Tech Stack:** Go backend, SQLite, TypeScript shared DTOs, React + Vite frontend, Ant Design components where already used, focused Go tests, Vitest/Testing Library, existing OpenClaw sync scripts for runtime validation.

---

## Source Spec

Implement against:

- `docs/superpowers/specs/2026-04-29-lynx-local-console-product-ux-data-correctness-spec.md`

Also re-check these baseline documents before coding:

- `docs/superpowers/specs/2026-04-22-local-console-logging-design.md`
- `docs/superpowers/specs/2026-04-22-local-console-ingest-contract-design.md`
- `docs/superpowers/specs/2026-04-22-local-console-query-api-dto-design.md`
- `docs/superpowers/plans/2026-04-23-local-console-v1-implementation.md`

## Current Round Scope

This round is backend-first because the frontend has already moved ahead of the backend after the backend rollback.

In scope:

- Restore backend/shared contracts that the current frontend expects.
- Add standard page responses with `total`, `pageNum`, `pageSize`, and `totalPages`.
- Add `qa_records` and a QA detail endpoint that returns clickable chain nodes and edges.
- Preserve terminal command details so a terminal node can show the exact command.
- Link tool calls, approvals, detections, audit events, and token usage to `qa_record_id`.
- Store full detection Markdown reports without truncation.
- Fix token summary semantics so estimated measurable usage is not hidden as `0`.
- Update frontend pages only after backend contracts exist.

Out of scope for this round:

- Visual-system polish, except for small usability fixes needed by changed pages.
- Export/download/report buttons without real backend export endpoints.
- Deleting advanced pages.
- Treating "第几轮" as a stored database fact.

## Execution Rules

- Do not start from frontend styling in this pass.
- Do not revert unrelated user changes.
- Do not recreate backend code that was rolled back without first writing the matching backend/shared tests.
- Do not claim runtime behavior changed without sync and real OpenClaw validation.
- Backend test files belong under `backend/test/` or existing backend package tests.
- Frontend tests belong under `frontend/test/`.
- For Chinese/mixed-language edits, use UTF-8-safe editing and verify readable Chinese with Node readback.

## File Map

Likely shared files:

- Modify: `shared/src/query-dto.ts`
- Modify: `shared/src/ingest.ts`
- Modify: `shared/src/index.ts`

Likely backend files:

- Modify/create: `backend/internal/db/migrations/*.sql`
- Modify/create: `backend/internal/service/pagination.go`
- Modify: `backend/internal/repo/events.go`
- Modify: `backend/internal/repo/toolcalls.go`
- Modify: `backend/internal/repo/approvals.go`
- Modify: `backend/internal/repo/sessions.go`
- Modify: `backend/internal/repo/lynxchecks.go`
- Modify: `backend/internal/repo/tokens.go`
- Create: `backend/internal/repo/qa_records.go`
- Modify: `backend/internal/repo/ingest.go`
- Modify: `backend/internal/ingest/service.go`
- Modify: `backend/internal/routes/query.go`
- Test: `backend/internal/routes/*_test.go`
- Test: `backend/test/app_parity_test.go`

Likely plugin ingest files:

- Modify: `src/console/event-builder.ts`
- Modify: `src/console/token-usage.ts`
- Test: focused root tests under `test/`

Likely frontend files:

- Modify: `frontend/src/api/*.ts`
- Create: `frontend/src/api/qa-records.ts`
- Modify: `frontend/src/app/nav-config.ts`
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/app/route-paths.ts`
- Modify: `frontend/src/components/tables/DataTable.tsx`
- Modify: `frontend/src/components/tables/TablePagination.tsx`
- Create: `frontend/src/pages/QaRecordsPage.tsx`
- Modify: `frontend/src/pages/LynxChecksPage.tsx`
- Modify: `frontend/src/pages/SessionsPage.tsx`
- Modify: `frontend/src/pages/TokensPage.tsx`
- Modify: `frontend/src/pages/ToolCallsPage.tsx`
- Modify: `frontend/src/pages/ApprovalsPage.tsx`
- Modify: `frontend/src/pages/EventsPage.tsx`
- Test: `frontend/test/**/*.test.tsx`

---

## Phase 0: Pre-Flight And Contract Audit

### Task 0.1: Inspect Current Worktree

**Files:** none

- [ ] **Step 1: Check current status**

Run:

```powershell
git status --short
```

Expected:

- Only intended planning docs or known user edits are dirty.
- No backend implementation files are modified from the previous accidental pass.

- [ ] **Step 2: Read the current spec and this plan through Node**

Run:

```powershell
node -e "const fs=require('fs'); for (const p of ['docs/superpowers/specs/2026-04-29-lynx-local-console-product-ux-data-correctness-spec.md','docs/superpowers/plans/2026-04-29-lynx-local-console-product-ux-data-correctness.md']) { console.log('--- '+p); console.log(fs.readFileSync(p,'utf8').slice(0,1200)); }"
```

Expected:

- Chinese text reads correctly.
- The plan clearly starts with backend/shared work, not visual polish.

### Task 0.2: Audit Frontend Calls That Currently Depend On Missing Backend Fields

**Files:**

- Read: `frontend/src/api/*.ts`
- Read: `frontend/src/pages/*.tsx`
- Read: `shared/src/query-dto.ts`
- Read: `backend/internal/routes/query.go`

- [ ] **Step 1: List frontend list/detail API expectations**

Run:

```powershell
Select-String -Path frontend/src/api/*.ts,frontend/src/pages/*.tsx -Pattern 'totalPages','pageNum','pageSize','qaRecord','qa_record','detail','/lynx/' | Select-Object Path,LineNumber,Line
```

Expected:

- Identify every frontend place that expects page totals, QA links, or detail payloads.

- [ ] **Step 2: Compare backend route response shapes**

Run:

```powershell
Select-String -Path backend/internal/routes/query.go,backend/internal/repo/*.go -Pattern 'pageNum','pageSize','totalPages','cursor','qa_record','qaRecord','tool-calls','approvals','tokens','lynx-checks' | Select-Object Path,LineNumber,Line
```

Expected:

- Produce a short implementation note listing backend/frontend mismatches before coding.

---

## Phase 1: Restore Backend And Shared List Contracts

### Task 1.1: Add Standard Page DTOs In Shared

**Files:**

- Modify: `shared/src/query-dto.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Add the shared page contract**

Define:

```ts
export interface PageResponse<T> {
  items: T[];
  total: number;
  pageNum: number;
  pageSize: number;
  totalPages: number;
}
```

Rules:

- Keep cursor DTOs only for endpoints intentionally designed as log tail or infinite scroll.
- Normal list endpoints should use `PageResponse<T>`.

- [ ] **Step 2: Update normal list aliases**

Use `PageResponse<T>` for:

- audit events
- tool calls
- approvals
- sessions
- detections
- token records
- skills if the page is list-like
- QA records after Phase 2

- [ ] **Step 3: Verify shared build**

Run:

```powershell
npm --prefix shared run build
```

Expected:

- Shared DTOs compile.

### Task 1.2: Implement Backend Page Queries

**Files:**

- Modify/create: `backend/internal/service/pagination.go`
- Modify: backend repositories listed in the File Map
- Modify: `backend/internal/routes/query.go`
- Test: focused backend route/repository tests

- [ ] **Step 1: Write failing route tests**

For each normal list endpoint, assert:

```go
expectNumber(t, body, "total", 42)
expectNumber(t, body, "pageNum", 1)
expectNumber(t, body, "pageSize", 20)
expectNumber(t, body, "totalPages", 3)
```

Rules:

- Test default `pageNum=1`.
- Test explicit `pageNum` and `pageSize`.
- Test invalid page values clamp to safe defaults.

- [ ] **Step 2: Implement pagination helper**

Rules:

- `pageNum` starts at 1.
- `pageSize` has a safe default and maximum.
- Use `COUNT(*)` with the same filters as the data query.
- Use `LIMIT ? OFFSET ?`.
- Compute `totalPages = ceil(total / pageSize)`, with `0` allowed when there are no rows.

- [ ] **Step 3: Verify backend route tests**

Run:

```powershell
cd backend
go test ./internal/routes ./test
```

Expected:

- Current frontend can know the final page for normal lists.

### Task 1.3: Restore Detail Contracts For Tool Calls And Approvals

**Files:**

- Modify: `shared/src/query-dto.ts`
- Modify: `backend/internal/repo/toolcalls.go`
- Modify: `backend/internal/repo/approvals.go`
- Modify: `backend/internal/routes/query.go`
- Test: backend route tests

- [ ] **Step 1: Add detail route tests**

Required routes:

```text
GET /lynx/tool-calls/:id
GET /lynx/approvals/:id
```

Expected:

- Detail payload contains the fields already visible in list rows.
- Detail payload also contains raw/detail JSON needed by the frontend modal.
- Missing id returns 404.

- [ ] **Step 2: Implement detail repository reads**

Rules:

- Do not require frontend navigation to a new route for detail display.
- Preserve raw payload fields that explain the tool call or approval.
- Include `qaRecordId` when present.

- [ ] **Step 3: Verify**

Run:

```powershell
cd backend
go test ./internal/routes ./test
```

Expected:

- Frontend modals can fetch details without navigating to missing routes.

### Task 1.4: Fix Backend Token Summary Semantics

**Files:**

- Modify: `shared/src/query-dto.ts`
- Modify: `backend/internal/repo/tokens.go`
- Modify: `backend/internal/repo/dashboard.go` if overview token totals depend on summary values
- Modify: `backend/internal/routes/query.go`
- Test: backend token route tests

- [ ] **Step 1: Write failing token summary tests**

Case:

- actual row: `120`
- estimated row: `1000`
- unavailable row: no measurable tokens

Expected:

```go
expectNumber(t, summary, "totalTokens", 120)
expectNumber(t, summary, "actualTokens", 120)
expectNumber(t, summary, "estimatedTokens", 1000)
expectNumber(t, summary, "measurableTokens", 1120)
expectNumber(t, summary, "estimatedCount", 1)
expectNumber(t, summary, "unavailableCount", 1)
```

- [ ] **Step 2: Implement semantics**

Rules:

- `totalTokens` remains actual-only for compatibility.
- `measurableTokens = actualTokens + estimatedTokens`.
- `unavailable` contributes to count only.
- Trend/list endpoints should expose matching source quality fields.

- [ ] **Step 3: Verify**

Run:

```powershell
cd backend
go test ./internal/routes ./test
```

Expected:

- Estimated measurable token usage no longer disappears behind a primary `0`.

---

## Phase 2: Add QA Records And Tool-Chain Detail

### Task 2.1: Add `qa_records` Storage

**Files:**

- Modify/create: `backend/internal/db/migrations/*.sql`
- Create: `backend/internal/repo/qa_records.go`
- Modify: `backend/internal/routes/query.go`
- Modify: `shared/src/query-dto.ts`
- Test: backend migration/repository/route tests

- [ ] **Step 1: Write migration tests**

Expected fields:

```text
qa_record_id
session_key
run_id
agent_id
user_prompt_excerpt
user_prompt_hash
final_answer_excerpt
final_answer_hash
status
risk_level
risk_score
tool_call_count
approval_count
detection_count
total_tokens
started_at
completed_at
ingested_at
payload_json
link_origin
```

- [ ] **Step 2: Implement table and repository**

Rules:

- `qa_record_id` is stable and unique.
- `link_origin` can be `runtime`, `inferred`, or `legacy`.
- No destructive migration.
- Legacy rows may remain unlinked.

- [ ] **Step 3: Add list endpoint**

Route:

```text
GET /lynx/qa-records?pageNum=1&pageSize=20
```

Response:

- `PageResponse<QaRecordListItemDto>`
- newest first by `startedAtMs`

- [ ] **Step 4: Verify**

Run:

```powershell
cd backend
go test ./internal/db ./internal/routes ./test
```

Expected:

- QA list can load with total pagination metadata.

### Task 2.2: Link Existing Event Tables To `qa_record_id`

**Files:**

- Modify migration/repositories for `audit_events`, `tool_calls`, `approvals`, `lynx_checks`, `token_usage`
- Modify: `shared/src/ingest.ts`
- Modify: `src/console/event-builder.ts`
- Test: backend ingest tests and root event-builder tests

- [ ] **Step 1: Write failing ingest tests**

Test payloads with `qaRecordId` for:

- audit event
- tool call
- approval
- lynx check
- token usage

Expected:

- `qaRecordId` persists into each table.
- Legacy payloads without `qaRecordId` still ingest successfully.

- [ ] **Step 2: Implement ingest contract**

Rules:

- Runtime/plugin-created `qaRecordId` is preferred.
- Backend inference is only a compatibility fallback.
- UI can show "未关联问答记录" for legacy rows.

- [ ] **Step 3: Verify**

Run:

```powershell
npx.cmd vitest run --no-color --reporter verbose test/local-console-event-builder.test.ts
npx.cmd tsc --noEmit
cd backend
go test ./internal/routes ./test
```

Expected:

- Linked and legacy payloads both pass.

### Task 2.3: Preserve Terminal Command Detail

**Files:**

- Modify: `shared/src/ingest.ts`
- Modify: `src/console/event-builder.ts`
- Modify: `backend/internal/repo/toolcalls.go`
- Modify: `backend/internal/ingest/service.go`
- Test: root event-builder tests and backend ingest/query tests

- [ ] **Step 1: Write failing terminal detail tests**

For a terminal-style tool call, assert stored/queryable detail includes:

```text
command
cwd
args
envSummary
exitCode
durationMs
stdout
stderr
```

- [ ] **Step 2: Implement detail preservation**

Rules:

- Preserve concrete command content when the source payload contains it.
- Redact sensitive environment values before storage.
- Do not fabricate command content for legacy rows.
- If command detail is missing, return a clear state that the frontend can render as "历史记录未保存命令明细".

- [ ] **Step 3: Verify**

Run:

```powershell
npx.cmd vitest run --no-color --reporter verbose test/local-console-event-builder.test.ts
cd backend
go test ./internal/routes ./test
```

Expected:

- A QA terminal node can show the exact executed command for newly ingested records.

### Task 2.4: Build QA Detail Tool-Chain Endpoint

**Files:**

- Modify: `shared/src/query-dto.ts`
- Modify/create: `backend/internal/repo/qa_records.go`
- Modify: `backend/internal/routes/query.go`
- Test: backend route tests

- [ ] **Step 1: Add DTOs**

Add:

- `QaRecordDetailDto`
- `QaChainNodeDto`
- `QaChainEdgeDto`

Node types:

```text
userPrompt
agentStep
toolCall
terminal
approval
detection
auditEvent
tokenUsage
finalAnswer
```

- [ ] **Step 2: Write detail route tests**

Route:

```text
GET /lynx/qa-records/:qaRecordId
```

Expected:

- User prompt node is first.
- Final answer node is last when available.
- Tool calls and approvals appear in timestamp order.
- Terminal-style tool calls produce `terminal` nodes with command detail.
- `chainEdges` connect the nodes in a readable order.

- [ ] **Step 3: Implement chain assembly**

Rules:

- Prefer explicit parent/child ids if available.
- Otherwise sort by timestamp and stable id.
- Return related raw list items alongside graph nodes for detail panes.
- Keep dynamic assembly first; add a persisted `qa_chain_nodes` table only if dynamic assembly loses required detail.

- [ ] **Step 4: Verify**

Run:

```powershell
cd backend
go test ./internal/routes ./test
```

Expected:

- The frontend can render an expandable complete tool chain from a single endpoint.

---

## Phase 3: Detection Reports And Excerpt Storage

### Task 3.1: Store Full Detection Markdown

**Files:**

- Modify: `shared/src/ingest.ts`
- Modify/create: `backend/internal/db/migrations/*.sql`
- Modify: `backend/internal/repo/lynxchecks.go`
- Modify: `backend/internal/ingest/service.go`
- Modify: plugin code that emits `lynxCheckUpsert`
- Test: backend ingest/query tests

- [ ] **Step 1: Write failing full-report tests**

Persist a long Markdown report and retrieve it without truncation.

Expected:

- Detail response contains complete `reportMarkdown`.
- List response may contain short summary fields.

- [ ] **Step 2: Implement storage**

Rules:

- Store `report_markdown` as SQLite `TEXT`.
- Do not apply the 1024-character excerpt limit to full reports.
- Keep `report_path` as supporting artifact path if already used.

- [ ] **Step 3: Verify**

Run:

```powershell
cd backend
go test ./internal/routes ./test
```

Expected:

- Detection detail can show the full Markdown report.

### Task 3.2: Stop Storing Display Ellipses In Short Excerpts

**Files:**

- Modify: `src/console/event-builder.ts`
- Modify: `src/console/token-usage.ts` if it truncates content
- Modify: shared ingest DTOs if metadata is added
- Test: root plugin tests

- [ ] **Step 1: Write failing truncation tests**

Input longer than 1024 chars should produce:

```ts
expect(data.contentExcerpt).toHaveLength(1024);
expect(data.contentExcerpt.endsWith("...")).toBe(false);
expect(data.contentExcerptTruncated).toBe(true);
expect(data.contentExcerptOriginalChars).toBeGreaterThan(1024);
```

- [ ] **Step 2: Implement storage truncation**

Rules:

- Max 1024 chars for short excerpts.
- Do not append `...`.
- Store truncation metadata where the contract supports it.
- Frontend owns visual ellipsis.

- [ ] **Step 3: Verify**

Run:

```powershell
npx.cmd vitest run --no-color --reporter verbose test/local-console-event-builder.test.ts
npx.cmd tsc --noEmit
```

Expected:

- Stored excerpts contain no synthetic ellipsis.

---

## Phase 4: Frontend Consumption Of Backend Contracts

### Task 4.1: Switch Normal Lists To Page-Based Pagination

**Files:**

- Modify/create: `frontend/src/hooks/usePagedListResource.ts`
- Modify: `frontend/src/components/tables/TablePagination.tsx`
- Modify: pages using normal list APIs
- Test: page and table tests

- [ ] **Step 1: Write frontend pagination tests**

Assert:

- The component renders `totalPages` from backend response.
- The final page is visible/clickable.
- Changing page sends `pageNum` and `pageSize`.

- [ ] **Step 2: Implement page hook and table pagination**

Rules:

- Do not estimate totals from cursor state.
- Reset to page 1 when filters change.
- `概览` recent security events can remain unpaginated.

- [ ] **Step 3: Verify**

Run:

```powershell
cd frontend
npm.cmd run test
```

Expected:

- Normal list pages can navigate to final page.

### Task 4.2: Build `问答记录` Page With Expandable Tool Chain

**Files:**

- Create: `frontend/src/api/qa-records.ts`
- Create: `frontend/src/pages/QaRecordsPage.tsx`
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/app/nav-config.ts`
- Test: `frontend/test/pages/QaRecordsPage.test.tsx`
- Test: `frontend/test/app/App.test.tsx`

- [ ] **Step 1: Write page tests**

Required behavior:

```ts
expect(await screen.findByText("问答记录")).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: /展开.*工具链/ }));
expect(await screen.findByText("用户提示词")).toBeInTheDocument();
expect(screen.getByText("工具调用")).toBeInTheDocument();
expect(screen.getByText("最终回复")).toBeInTheDocument();
```

Terminal node behavior:

```ts
fireEvent.click(screen.getByRole("button", { name: /终端.*命令/ }));
expect(await screen.findByText("执行命令")).toBeInTheDocument();
expect(screen.getByText("npm test")).toBeInTheDocument();
```

- [ ] **Step 2: Implement list + right detail**

Rules:

- Default detail is newest record.
- Clicking a row switches right detail.
- Row expansion shows the tool-chain summary.
- Clicking a chain node shows node detail in the right pane or modal.
- Terminal node detail shows command, cwd, status, duration, stdout/stderr/result when available.

- [ ] **Step 3: Verify route behavior**

Run:

```powershell
cd frontend
npx.cmd vitest run --no-color --reporter verbose test/pages/QaRecordsPage.test.tsx test/app/App.test.tsx
```

Expected:

- `/webview` routing works.
- `问答记录` appears as a primary page.

### Task 4.3: Update Advanced Pages To Show QA Context

**Files:**

- Modify: `frontend/src/pages/ToolCallsPage.tsx`
- Modify: `frontend/src/pages/ApprovalsPage.tsx`
- Modify: `frontend/src/pages/EventsPage.tsx`
- Modify: `frontend/src/pages/LynxChecksPage.tsx`
- Test: matching page tests

- [ ] **Step 1: Write QA context tests**

Assert:

- Rows show `qaRecordId` or "未关联问答记录".
- Tool call detail modal shows the related QA record.
- Approval detail modal shows the related QA record or user prompt excerpt.

- [ ] **Step 2: Implement UI context**

Rules:

- Do not delete advanced pages.
- These pages remain diagnostic views.
- Related QA record should be visible without forcing a route jump.

- [ ] **Step 3: Verify**

Run:

```powershell
cd frontend
npx.cmd vitest run --no-color --reporter verbose test/pages/ToolCallsPage.test.tsx test/pages/ApprovalsPage.test.tsx test/pages/EventsPage.test.tsx test/pages/LynxChecksPage.test.tsx
```

Expected:

- Advanced pages are still useful and now point back to the user workflow.

### Task 4.4: Detection Page Full Markdown Detail

**Files:**

- Modify: `frontend/src/pages/LynxChecksPage.tsx`
- Modify: `frontend/src/app/nav-config.ts`
- Test: `frontend/test/pages/LynxChecksPage.test.tsx`

- [ ] **Step 1: Write page tests**

Required:

```ts
expect(screen.getByText("检测")).toBeInTheDocument();
expect(await screen.findByText("最近检测报告")).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: /查看.*检测报告/ }));
expect(await screen.findByText("## Full Section")).toBeInTheDocument();
```

- [ ] **Step 2: Implement left list + right Markdown detail**

Rules:

- Left list is paginated.
- Right pane defaults to latest report.
- Clicking a list item switches the right report.
- Full report body renders as readable Markdown without truncation.

- [ ] **Step 3: Verify**

Run:

```powershell
cd frontend
npx.cmd vitest run --no-color --reporter verbose test/pages/LynxChecksPage.test.tsx
```

Expected:

- Detection detail displays complete Markdown.

---

## Phase 5: Frontend Usability Cleanup After Contracts Exist

### Task 5.1: Route And Detail Action Sanity

**Files:**

- Modify: `frontend/src/pages/ToolCallsPage.tsx`
- Modify: `frontend/src/pages/ApprovalsPage.tsx`
- Modify: `frontend/src/pages/SessionsPage.tsx`
- Modify: `frontend/src/app/nav-config.ts`
- Test: matching page/app tests

- [ ] **Step 1: Write/extend tests**

Assertions:

```ts
expect(screen.queryByRole("link", { name: /查看详情/ })).not.toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: /查看.*详情/ }));
expect(await screen.findByRole("dialog")).toBeInTheDocument();
```

- [ ] **Step 2: Implement behavior**

Rules:

- Tool calls and approvals open modal/detail panels.
- Sessions has a sidebar nav entry.
- Sessions row click switches right detail.
- No missing-route navigation.

- [ ] **Step 3: Verify**

Run:

```powershell
cd frontend
npx.cmd vitest run --no-color --reporter verbose test/app/App.test.tsx test/pages/ToolCallsPage.test.tsx test/pages/ApprovalsPage.test.tsx test/pages/SessionsPage.test.tsx
```

Expected:

- All known routes render.
- Detail actions do not navigate to missing routes.

### Task 5.2: Loading States, Sticky Operation Columns, And Overflow Tooltips

**Files:**

- Modify: `frontend/src/components/tables/DataTable.tsx`
- Modify: `frontend/src/components/tables/TablePagination.tsx`
- Modify: list pages under `frontend/src/pages/`
- Modify: `frontend/src/styles/theme.css`
- Test: table and page tests

- [ ] **Step 1: Write tests**

Cover:

- Loading skeleton/spinner appears during delayed API requests.
- Rightmost operation column is sticky.
- "查看详情" stays one line.
- Tooltip appears only when content actually overflows.
- Short enum/status columns stay compact.
- Long content columns get wider defaults.

- [ ] **Step 2: Implement shared table behavior**

Rules:

- Use `scrollWidth > clientWidth` or `scrollHeight > clientHeight` for overflow tooltip.
- Do not add tooltips to every primitive value when it fits.
- Keep operation column fixed to the right during horizontal scroll.

- [ ] **Step 3: Verify**

Run:

```powershell
cd frontend
npm.cmd run test
```

Expected:

- Table readability issues are covered by tests.

### Task 5.3: Remove Fake Export Actions

**Files:**

- Modify: `frontend/src/pages/ApprovalsPage.tsx`
- Modify: `frontend/src/pages/EventsPage.tsx`
- Modify: `frontend/src/pages/LynxChecksPage.tsx`
- Modify: `frontend/src/pages/TokensPage.tsx`
- Test: matching page tests

- [ ] **Step 1: Write tests**

Assert non-implemented export buttons are absent:

```ts
expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: /下载/ })).not.toBeInTheDocument();
```

- [ ] **Step 2: Remove only no-op actions**

Remove or keep absent:

- 审批页面 `导出报告`
- 审计日志 `导出 CSV`
- 检测页面 `导出安全审计报告`
- Token 页面 `导出报告`

- [ ] **Step 3: Verify**

Run:

```powershell
cd frontend
npm.cmd run test
```

Expected:

- No fake export actions remain.

### Task 5.4: Token Time Range Filter

**Files:**

- Modify: `frontend/src/api/tokens.ts`
- Modify: `frontend/src/pages/TokensPage.tsx`
- Test: `frontend/test/pages/TokensPage.test.tsx`

- [ ] **Step 1: Write filter tests**

Assert available ranges:

```text
最近 1 小时
最近 24 小时
最近 7 天
最近 30 天
全部时间
```

- [ ] **Step 2: Implement selector**

Rules:

- Summary, list, and trend use the same range.
- Changing range resets pagination.
- Selected text is vertically centered and height-aligned with other filters.

- [ ] **Step 3: Verify**

Run:

```powershell
cd frontend
npx.cmd vitest run --no-color --reporter verbose test/pages/TokensPage.test.tsx
```

Expected:

- Token page uses meaningful time range query params.

---

## Phase 6: Verification And Runtime Sync

### Task 6.1: Local Verification

**Files:** all touched files

- [ ] **Step 1: Run backend verification**

```powershell
cd backend
go test ./...
```

- [ ] **Step 2: Run shared verification**

```powershell
npm --prefix shared run build
```

- [ ] **Step 3: Run frontend verification**

```powershell
cd frontend
npx.cmd tsc --noEmit --pretty false
npm.cmd run test
npm.cmd run build -- --clearScreen false
```

- [ ] **Step 4: Check diffs**

```powershell
git diff --check
git status --short
```

Expected:

- No whitespace errors.
- Only intended files changed.

### Task 6.2: Runtime Verification Before Claiming Behavior Changed

**Files:** none

- [ ] **Step 1: Run sync readiness**

```powershell
node scripts/verify-dev-sync.mjs
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
```

- [ ] **Step 2: Check gateway health**

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz
```

- [ ] **Step 3: Validate real OpenClaw path**

```powershell
docker exec openclaw-openclaw-gateway-1 sh -lc "openclaw agent --agent main --message 'test message' --json --timeout 90 2>&1"
```

Expected:

- Sync succeeds.
- Health endpoint returns HTTP 200.
- Runtime path produces usable output.

---

## Recommended Execution Order

1. Phase 0: audit current mismatch after rollback.
2. Phase 1: restore backend/shared list, detail, and token contracts.
3. Phase 2: add `问答记录` backend flow and QA tool-chain detail endpoint.
4. Phase 3: store full detection reports and fix excerpt storage.
5. Phase 4: update frontend pages to consume supported backend contracts.
6. Phase 5: cleanup route/detail/table/loading/token filter usability.
7. Phase 6: local verification, sync, and real OpenClaw runtime validation.

Reasoning:

- The current frontend bugs come from backend contracts not being present, so backend/shared work must come first.
- `问答记录` is the product-level model, but it needs backend grouping and detail assembly before the page can be reliable.
- Tool calls and approvals become clearer when they show their related QA record instead of acting like isolated database rows.
- Detection and token correctness are data semantics problems first, then UI presentation problems.
- Visual-system refinements are intentionally deferred from this round.

## Deferred Visual-System Work

The target visual direction remains:

- default mixed theme
- dark blue-black sidebar/topbar with light content
- current-theme dropdown
- sticky topbar
- bottom sidebar collapse item
- smaller card padding/radius
- standardized font sizes
- coordinated blue-black topbar gradient

Do not schedule this visual work in the backend-first pass unless a small style adjustment is required to keep a changed page usable.

## Explicit Non-Goals For This Plan

- Do not rewrite the local console from scratch.
- Do not delete advanced pages.
- Do not promise export/download features.
- Do not force all historical data into perfect `问答记录` groups.
- Do not store "第几轮" as a database field.
- Do not treat local frontend tests as proof that Docker/OpenClaw runtime changed.
