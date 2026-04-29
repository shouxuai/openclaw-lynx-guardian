# Lynx Local Console Product UX And Data Correctness Spec

## Scope

This spec extends the existing local-console V1 design. It does not replace the existing logging, ingest, query API, or Go backend direction. It captures the product and data-correctness requirements discussed after the first frontend expansion, where the current pages were functional but still felt like database tables surfaced directly to users.

Applies to:

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`
- Local console frontend under `frontend/`
- Local console backend under `backend/`
- Shared DTO contracts under `shared/`
- Plugin-side ingest builders under `src/console/`

Primary source documents that remain valid:

- `docs/superpowers/specs/2026-04-22-local-console-logging-design.md`
- `docs/superpowers/specs/2026-04-22-local-console-logging-001_init.sql`
- `docs/superpowers/specs/2026-04-22-local-console-ingest-contract-design.md`
- `docs/superpowers/specs/2026-04-22-local-console-query-api-dto-design.md`
- `docs/superpowers/plans/2026-04-23-local-console-v1-implementation.md`

## Product Goal

The console should answer a normal user's questions first:

- What happened in this Agent interaction?
- What did the user ask?
- What tools did the Agent call?
- Which approvals or security decisions affected the answer?
- What was the final result?
- Did the latest detection find anything important?
- Is token usage measurable and believable?

The target is not to remove advanced audit pages. The target is to make the normal workflow readable before exposing raw ledgers.

## Current Round Priority

This round is backend-first.

The frontend has already started to depend on contracts that the backend does not fully provide after the backend rollback. The next implementation pass should first restore and formalize backend/shared contracts, then update frontend pages to consume those contracts. Visual-system polish is documented below, but it is explicitly deferred for this round because parts of it have already been done and the current blocking bugs are data/API mismatches.

## Core Product Model: 问答记录

`问答记录` is the primary user-facing object.

Definition:

- One user prompt.
- The Agent's tool calls and safety decisions while handling that prompt.
- Any approval requests created during that handling.
- Any detection or audit events associated with that handling.
- The final assistant answer or terminal outcome.
- A readable tool chain from prompt to final result.

Important decision:

- Do not store "第几轮" as an authoritative database fact.
- Store a stable `qa_record_id`.
- The UI may display `本会话第 N 条问答记录`, derived from `session_key + started_at` ordering.

Why:

- "第几轮" is abstract and unreliable unless the host runtime already gives a durable turn id.
- A stable record id is suitable for joins, detail pages, and future migration.
- Display ordering can change without corrupting the data model.

Tool-chain goal:

- Users should be able to expand one `问答记录` and see what happened during that complete interaction cycle.
- The page should show a chain/tree/flow from `用户提示词` to `最终回复`.
- Tool calls, terminal commands, approvals, detections, and important audit events should appear as clickable nodes.
- Clicking a node opens an in-page detail panel or modal with the concrete content behind that node.
- Terminal nodes must expose the actual command content, not only a generic "tool call" label.

## Target Navigation

Primary pages:

- `概览`: main entry, product-level health and recent important events.
- `问答记录`: the main user workflow page.
- `检测`: latest and historical Lynx detection reports.
- `Skill`: top-level page.
- `Token`: top-level page.

Advanced pages:

- `会话`
- `工具调用`
- `审批`
- `安全审计日志`
- `授权/决策/链路` if retained by current implementation

Rules:

- Existing pages should not be deleted.
- Existing pages can move under a collapsed `高级页面` navigation group.
- `概览` remains the main landing page.
- `Skill` and `Token` stay first-level pages.
- `会话` should have a sidebar entry if the route exists.

## Page Requirements

### 概览

Purpose:

- Serve as the main operational entry.
- Show high-level safety posture and recent activity without forcing users into raw tables.

Requirements:

- Recent security events can remain unpaginated.
- Other list-style sections should either be short summaries or link into paginated pages.
- Copy should explain meaning in plain Chinese, not expose database field names as page concepts.

### 问答记录

Purpose:

- Present complete interaction cycles instead of isolated calls.

Required list fields:

- User prompt excerpt.
- Final status or final answer excerpt.
- Session identity.
- Started/completed time.
- Risk level summary.
- Tool call count.
- Approval count.
- Detection/audit signal count.
- Token total if measurable.

Required detail layout:

- Left: paginated records list.
- Right: selected record detail.
- Default right pane: newest record.
- Row click switches the right detail; do not navigate to a missing route.

Detail content:

- User prompt.
- Final assistant answer or terminal outcome.
- Expandable tool-chain visualization.
- Timeline fallback for narrow/mobile layouts.
- Clickable nodes for tool calls, terminal commands, approvals, audit events, detection events, and token usage.
- Related session link.

Tool-chain node requirements:

- `userPrompt`: shows the user's prompt excerpt and opens the full stored prompt excerpt/detail when available.
- `agentStep`: optional model/agent planning or routing step, if the runtime exposes it.
- `toolCall`: shows tool name, status, risk level, start/end time, and parameter/result detail.
- `terminal`: shows command, cwd, args, environment summary if available, status, exit code, duration, stdout/stderr/result content according to storage availability.
- `approval`: shows approval reason, requester, approver, decision, and affected operation.
- `detection`: links to the related detection report and summary.
- `auditEvent`: shows safety event type, severity, message, and evidence.
- `finalAnswer`: shows final assistant answer or terminal outcome.

Minimum user interaction:

- The list row can expand inline to show the chain summary.
- The right detail pane should update when a row is selected.
- Clicking a node updates a node detail panel or opens a modal without navigating to a missing route.
- The selected node should remain visually clear while the user inspects details.

### 检测

Naming:

- Use `检测` or `安全检测`.
- Avoid user-facing `检查任务` and `检查报告` as the primary page name.

Purpose:

- Let users see detection results directly on the page.

Required layout:

- Left: paginated detection list.
- Right: selected detection report.
- Default right pane: latest report.
- Clicking a list item switches the right report.

Report behavior:

- The Markdown detection report must be displayed in full.
- The report body must not be truncated.
- Use readable Markdown rendering in the right pane.
- List summaries may be shortened by frontend display rules only.

Storage requirement:

- Store full report Markdown separately from short list fields.
- `report_markdown` or equivalent should be a `TEXT` field.
- Do not apply the 1024-character summary limit to full reports.

### 工具调用

Purpose:

- Advanced page for tool-call-level diagnosis.

Requirements:

- Every row should visibly show which `问答记录` it belongs to once `qa_record_id` exists.
- "查看详情" should open a dialog or switch an in-page detail pane, not navigate to a route that does not exist.
- Rightmost operation column must remain fixed/sticky during horizontal scroll.

### 审批

Purpose:

- Advanced page for approval and governance diagnosis.

Requirements:

- Every row should visibly show which `问答记录` or user prompt it affected once `qa_record_id` exists.
- "查看详情" should open a dialog or switch an in-page detail pane, not navigate to a route that does not exist.
- Rightmost operation column must remain fixed/sticky during horizontal scroll.

### 会话

Purpose:

- Advanced session ledger plus useful entry into recent session activity.

Current known gap:

- Route exists.
- Sidebar entry was missing.
- Detail defaults to the first row.
- Row click should switch the right detail.

Requirements:

- Add navigation entry.
- List + right detail layout.
- Default detail: newest or first loaded row.
- Row click switches detail.

### Token

Purpose:

- Show believable token usage and usage-data quality.

Known current issue:

- If actual usage is unavailable but estimated rows exist, the page can show token total as `0`, which is misleading.

Required semantics:

- Distinguish `actual`, `estimated`, and `unavailable`.
- The UI must not present "0 total" as the primary truth when estimated measurable rows exist.
- The page should clearly show actual tokens, estimated tokens, and unavailable record counts.
- Time range filter must be richer than a fixed "过去 24 小时" button.

Required filters:

- 最近 1 小时
- 最近 24 小时
- 最近 7 天
- 最近 30 天
- 全部时间

Open design decision:

- Backend summary may either expose `actualTokens`, `estimatedTokens`, and `measurableTokens`, or change `totalTokens` to mean measurable `actual + estimated`.
- This must be finalized before backend code changes.

## Data Model Requirements

### `qa_records`

Add a new table when implementing the target model.

Proposed fields:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `qa_record_id TEXT NOT NULL UNIQUE`
- `session_key TEXT`
- `run_id TEXT`
- `agent_id TEXT`
- `user_prompt_excerpt TEXT`
- `user_prompt_hash TEXT`
- `final_answer_excerpt TEXT`
- `final_answer_hash TEXT`
- `status TEXT NOT NULL`
- `risk_level TEXT`
- `risk_score INTEGER`
- `tool_call_count INTEGER NOT NULL DEFAULT 0`
- `approval_count INTEGER NOT NULL DEFAULT 0`
- `detection_count INTEGER NOT NULL DEFAULT 0`
- `total_tokens INTEGER NOT NULL DEFAULT 0`
- `started_at INTEGER NOT NULL`
- `completed_at INTEGER`
- `ingested_at INTEGER NOT NULL`
- `payload_json TEXT`

Relationship fields to add later:

- `audit_events.qa_record_id`
- `tool_calls.qa_record_id`
- `approvals.qa_record_id`
- `lynx_checks.qa_record_id`
- `token_usage.qa_record_id`

Migration rule:

- Existing data should not be destroyed.
- Backfill can infer best-effort `qa_record_id` by session/run/time only if the inference is clearly marked.
- UI can show "未关联问答记录" for legacy rows.

### QA Tool-Chain Detail Contract

The backend should expose a prebuilt detail response so the frontend does not have to reconstruct a complete interaction chain from unrelated list endpoints.

List endpoint:

```text
GET /lynx/qa-records?pageNum=1&pageSize=20
```

Detail endpoint:

```text
GET /lynx/qa-records/:qaRecordId
```

Target DTO:

```ts
interface QaRecordDetailDto {
  qaRecordId: string;
  sessionKey?: string;
  runId?: string;
  agentId?: string;
  userPromptExcerpt?: string;
  finalAnswerExcerpt?: string;
  status: string;
  riskLevel?: string;
  startedAtMs: number;
  completedAtMs?: number;
  chainNodes: QaChainNodeDto[];
  chainEdges: QaChainEdgeDto[];
  relatedToolCalls: ToolCallListItemDto[];
  relatedApprovals: ApprovalListItemDto[];
  relatedEvents: AuditEventListItemDto[];
  relatedDetections: LynxCheckListItemDto[];
}

interface QaChainNodeDto {
  nodeId: string;
  qaRecordId: string;
  type:
    | "userPrompt"
    | "agentStep"
    | "toolCall"
    | "terminal"
    | "approval"
    | "detection"
    | "auditEvent"
    | "tokenUsage"
    | "finalAnswer";
  title: string;
  summary?: string;
  occurredAtMs: number;
  completedAtMs?: number;
  status?: string;
  riskLevel?: string;
  detailRef?: { kind: string; id: string };
  detailJson?: Record<string, unknown>;
}

interface QaChainEdgeDto {
  fromNodeId: string;
  toNodeId: string;
  label?: string;
}
```

Chain construction rules:

- Prefer runtime-provided parent/child ids if available.
- Otherwise order nodes by `qa_record_id`, timestamp, and stable table/id tie breakers.
- A `terminal` node can be derived from a tool call when the tool name or payload represents shell/terminal execution.
- `detailJson` for terminal nodes should include `command`, `cwd`, `args`, `envSummary`, `exitCode`, `durationMs`, `stdout`, `stderr`, and result excerpt/full content when available.
- Do not fabricate missing command text. If legacy payloads do not contain the command, the UI should show "历史记录未保存命令明细".
- The backend may build nodes dynamically from existing tables first; a persisted `qa_chain_nodes` table is optional unless dynamic assembly becomes too expensive or lossy.

### Summary/Excerpt Storage

Current issue:

- Some plugin-side truncation stores literal `...` into the database.
- This makes it impossible for the frontend to distinguish stored content from display truncation.

Requirement:

- Do not store display ellipses in database summary fields.
- Store as much redacted summary as is useful up to 1024 characters.
- Store metadata such as original character count and truncation flag when practical.
- Frontend owns visual ellipsis and overflow tooltip behavior.

Suggested metadata fields:

- `*_excerpt_original_chars`
- `*_excerpt_truncated`

Scope note:

- This 1024-character rule applies to short excerpts and summaries.
- It does not apply to full detection Markdown reports.

### Pagination

Current issue:

- Cursor responses do not provide total counts.
- UI cannot know final page.

Target response shape for normal lists:

```ts
{
  items: T[];
  total: number;
  pageNum: number;
  pageSize: number;
  totalPages: number;
}
```

Rules:

- All list pages should use pagination except `概览` recent security events.
- Backend list endpoints should support `pageNum` and `pageSize`.
- Repositories should use `COUNT(*)` plus `LIMIT/OFFSET`.
- Cursor pagination can remain only where infinite scroll or log-tail behavior is intentionally kept.

### Loading

Requirement:

- Every page/list/detail that waits on API data must show a loading animation or skeleton.
- Do not rely on only "正在刷新" text.
- Entering a new page with delayed requests should visibly show loading state.

## Table And UI Requirements

### Table Columns

Requirements:

- Rightmost operation column is sticky/fixed to the right.
- Users should not scroll to the far right just to find "查看详情".
- Text should stay one line where appropriate.
- Short enum/status columns should be compact.
- Long content columns should have more width.
- Tooltip should appear only when content actually overflows.
- Tooltip should be used for naturally long text, not every primitive value.

### Fake Export Buttons

Requirement:

- Remove export/download/report buttons that do not have real implementation.
- Reintroduce export only when backend export endpoints and frontend download behavior are implemented.

Known fake actions to remove or keep absent:

- 审批页面 `导出报告`
- 审计日志 `导出 CSV`
- 检测页面 `导出安全审计报告`
- Token 页面 `导出报告`

### Visual System

Status: deferred for this round.

These requirements remain valid as the target visual direction, but they should not drive this backend-first pass unless a change is required to keep a page usable.

Requirements:

- Default theme: mixed.
- Mixed theme: sidebar and topbar dark blue-black, content light.
- Theme control should show current theme.
- Theme control should be a dropdown-style button.
- Topbar should be fixed/sticky.
- Sidebar collapse control should sit at the bottom as an equal-width menu item.
- Sidebar width and topbar height should remain close to the user's prior hand-written project.
- Cards should have smaller padding and smaller radius.
- Font sizes should be standardized.
- Topbar gradient should be coordinated blue-black, not overly black and not grey at the right edge.

## Route And Navigation Requirements

Rules:

- Every sidebar item must point to a real route.
- Every detail action must either open a modal/detail pane or navigate to an existing detail route.
- Do not create links to missing routes.
- `/webview` base path behavior must continue to work.

## Validation Requirements

Frontend:

- `cd frontend; npx.cmd tsc --noEmit --pretty false`
- `cd frontend; npm.cmd run test`
- `cd frontend; npm.cmd run build -- --clearScreen false`

Backend:

- Focused Go tests for changed repositories/routes.
- Full backend tests when data contracts or migrations change.

Shared:

- Build/typecheck shared DTOs after DTO changes.

Runtime:

- Local build/test is not enough to claim OpenClaw runtime behavior changed.
- For runtime-facing changes, run the repo sync flow and validate the real gateway path before claiming success.

## Open Decisions

1. Token summary naming:
   - Recommended default for implementation: keep `totalTokens = actual only`, add `actualTokens`, `estimatedTokens`, `measurableTokens`, `estimatedCount`, and `unavailableCount`.
   - Option B: redefine `totalTokens = actual + estimated`, and expose `actualTokens` separately.

2. `qa_record_id` inference:
   - Target: runtime/plugin creates `qa_record_id` when a user prompt begins.
   - Compatibility fallback: backend derives a temporary id from `session_key + run_id + user prompt timestamp`, but marks it as inferred.

3. Detection report renderer:
   - Use an existing Markdown library if already available.
   - If adding a package, keep it small and verify bundle/build impact.

4. Pagination migration:
   - Either migrate all list endpoints in one coordinated contract change.
   - Or add page-based responses page by page while keeping compatibility wrappers.

5. Existing frontend draft edits:
   - Before implementation starts, inspect current working tree and decide whether to keep, revise, or discard any draft UI-only changes.
