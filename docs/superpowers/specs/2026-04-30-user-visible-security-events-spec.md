# Lynx Local Console User-Visible Security Events Spec

## Scope

This spec refines the local-console product model after the audit-count review on 2026-04-30. It does not remove the existing raw audit ledger. It introduces a user-visible security event layer that sits above raw hook records and becomes the default source for dashboard charts, audit-log pages, and QA execution chains.

Applies to:

- `backend/`
- `shared/`
- `frontend/`
- `src/console/`
- packaged runtime under `server/`

Primary source documents that remain valid:

- `docs/superpowers/specs/2026-04-22-local-console-logging-design.md`
- `docs/superpowers/specs/2026-04-22-local-console-ingest-contract-design.md`
- `docs/superpowers/specs/2026-04-22-local-console-query-api-dto-design.md`
- `docs/superpowers/specs/2026-04-29-lynx-local-console-product-ux-data-correctness-spec.md`
- `docs/superpowers/plans/2026-04-29-lynx-local-console-product-ux-data-correctness.md`

## Product Decision

The console now has two event layers:

1. **User-visible security events**
   - Default layer for normal users.
   - One record means one user-understandable safety checkpoint or process.
   - Every record has a `riskLevel`, including safe records as `L0`.
   - Dashboard charts, level counts, trends, and the default audit-log page use this layer.

2. **Raw audit events**
   - Advanced evidence layer for troubleshooting and proof.
   - One record means one hook/backend audit write.
   - Raw counts are still valuable, but they are not the primary user-facing event count.
   - Existing `audit_events` queries remain available through a secondary page.

The user-facing phrase `事件` refers to user-visible security events. The phrase `原始审计流水` refers to `audit_events`.

## User-Visible Event Types

| Event kind | Counting unit | Typical process | Required risk level |
| --- | --- | --- | --- |
| `input` | Once per QA record | User prompt safety check | Yes, default `L0` |
| `tool` | Once per tool call | Tool call safety check and execution result | Yes, default `L0` |
| `output` | Once per QA record | Final assistant output safety check | Yes, default `L0` |
| `install` | Once per install process | Skill/plugin install, import, enable, or local copy into a protected skill/plugin area | Yes, default `L0` |
| `process` | Once per user-visible non-chat process | `/lynx-check`, approval process, batch operation, or other product process | Yes, default `L0` |

Every event must be independently countable. A conversation with one tool call normally produces three user-visible events:

1. input
2. tool
3. output

A conversation with three tool calls normally produces five user-visible events:

1. input
2. tool
3. tool
4. tool
5. output

A standalone skill install produces one `install` event even when no QA record exists.

## Risk And Action Aggregation

When several raw records support one user-visible event:

- `riskLevel` is the highest risk among all supporting records.
- Empty, null, or missing risk levels normalize to `L0`.
- `riskScore` is the highest known score; if no score exists, use the numeric floor for the selected risk level.
- `enforcementAction` is the strongest supporting action.
- `policyDecision` is the strongest supporting policy decision.
- `rawAuditEventIds` stores the supporting raw IDs in chronological order.
- `rawAuditCount` is the count of supporting raw records.

Risk order:

```text
L0 < L1 < L2 < L3 < L4
```

Enforcement order:

```text
allow/logOnly < warn < redact < requireApproval/require_approval < block/deny
```

Policy decision order:

```text
allow < warn < confirm/require_approval < workflow_auth < block < deny
```

## Read Model

The first implementation should build a dynamic read model in the Go backend. A new persisted table is not required unless query performance or historical replay needs it.

Recommended backend name:

- Repository: `SecurityEventsRepository`
- Route: `GET /lynx/security-events`
- Detail route: `GET /lynx/security-events/:eventId`
- Dashboard source: the same repository
- QA detail source: the same repository filtered by `qaRecordId`

The raw route remains:

- `GET /lynx/events`
- `GET /lynx/events/:eventId`

Frontend naming:

- Primary page: `审计日志`
- Secondary page or tab: `原始审计流水`

## DTO Shape

Shared DTOs should add a user-visible event contract:

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
```

QA detail should keep the existing raw chain fields and add the new display chain:

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

## Event Construction Rules

### Input Event

Build one `input` event per QA record.

Primary source:

- `qa_records.user_prompt_excerpt`
- `qa_records.started_at`

Supporting raw audit records:

- `category = 'decision' AND event_type = 'input'`
- `hook_name IN ('message_received', 'before_dispatch', 'before_agent_start')`
- local `input_guard` records linked to the same `qa_record_id`, `run_id`, or session/time window
- `before_prompt_build` records that were ingested through the agent-start path

Title:

- `输入检查`

Object label:

- user prompt excerpt

### Tool Event

Build one `tool` event per `tool_calls` row.

Primary source:

- `tool_calls`

Supporting raw audit records:

- `audit_events.tool_call_id = tool_calls.tool_call_id`
- `hook_name IN ('before_tool_call', 'after_tool_call', 'tool_result_persist')`
- Go decision records with `event_type = 'tool_call'`

Title:

- `工具调用检查`

Object label:

- tool name

Terminal detail:

- If the tool parameters contain a shell command, expose command, cwd, exit code, stdout/stderr/result excerpt when available.

### Output Event

Build one `output` event per QA record that has a final answer or agent-end evidence.

Primary source:

- `qa_records.final_answer_excerpt`
- `qa_records.completed_at`

Supporting raw audit records:

- `category = 'decision' AND event_type IN ('assistant_output', 'outbound_message')`
- `hook_name IN ('llm_output', 'agent_end', 'before_message_write', 'message_sending')`
- output persistence or outbound guard records linked to the same QA record or run

Title:

- `输出检查`

Object label:

- assistant final answer excerpt

### Install Event

Build one `install` event per user-visible install process.

Supporting raw audit records:

- `category = 'decision' AND event_type = 'install'`
- `hook_name = 'before_install'`
- `before_tool_call` records whose command or path targets skill/plugin install areas

Grouping key:

- Prefer `request_id`.
- Fallback to `run_id + targetUri`.
- Fallback to raw `event_id` for isolated historical records.

Title examples:

- `Skill 安装检查`
- `插件安装检查`

### Process Event

Build one `process` event for important non-chat processes that users understand as one operation.

Initial process kinds:

- `lynx_check`
- `approval`

Rules:

- A `/lynx-check` run is one event, not every hook involved in producing and delivering the report.
- A standalone approval process is one event if it is not already clearly represented by a tool event.
- Process events also require `riskLevel`; safe completion is `L0`.

## Dashboard Requirements

Dashboard primary metrics and charts must use user-visible security events:

- Total event count
- Risk distribution by `L0` through `L4`
- Event trend
- Enforcement distribution
- Recent security events

Dashboard overview responses must not send raw audit aggregate volume to the frontend:

- Do not include `rawAuditEventCount` in `/lynx/dashboard/overview`.
- Do not include `highRiskEventCount` in `/lynx/dashboard/overview`; `L3` and `L4` must remain separate in `riskDistribution`.
- Raw hook-level records remain available only through the secondary `原始审计流水` page/API.
- The top overview cards stay as the existing `L0` through `L4` risk-level summary plus total, using security-event-derived values.

Risk chart total must equal user-visible event total.

## Audit Log Requirements

The default `审计日志` page lists user-visible security events.

Required columns:

- 时间
- 事件类型
- 过程
- 对象/内容
- 风险等级
- 处置动作
- 关联问答
- 原始证据

The time column must be a standalone column on every list page touched by this work. It must not be hidden in the title, subtitle, or ID cell.

The secondary `原始审计流水` page can keep hook-level fields:

- hook
- event type
- raw category
- source kind
- raw payload

## QA Record Drawer Requirements

The QA drawer defaults to the user-visible display chain.

Layout:

- Wider drawer: `min(960px, calc(100vw - 32px))` on desktop.
- Full width on mobile.
- Display chain visible by default.
- No separate bottom node-detail card.
- Clicking a chain node expands that node card in place.

Default display chain:

```text
输入检查
工具调用检查
工具调用检查
输出检查
```

Node cards:

- Always show time, type, risk level, action, title, and summary.
- Expanded input card shows prompt detail and supporting raw evidence count.
- Expanded tool card shows tool parameters and terminal command detail when available.
- Expanded output card shows final answer and output enforcement detail.
- Expanded install/process card shows target object, source, status, and supporting evidence.

The existing raw chain can remain available behind `查看原始链路` or inside the raw evidence section.

## Old Layer Placement

Old/raw audit remains valuable and must stay accessible.

Recommended navigation:

- `审计日志`: user-visible security events
- `原始审计流水`: hook-level `audit_events`
- `高级诊断`: can contain raw chains, decisions, sessions, grants, and other low-level tables

## Testing Requirements

Every user-visible event kind must have backend tests and frontend rendering tests.

Backend cases:

- safe input creates `input/L0`
- risky input creates `input/L3` or `input/L4`
- safe tool call creates `tool/L0`
- risky command or protected resource creates `tool/L3` or `tool/L4`
- safe output creates `output/L0`
- risky output creates `output/L2+`
- safe install creates `install/L0`
- risky install creates `install/L3` or `install/L4`
- `/lynx-check` creates `process/L0` or the highest observed risk
- every produced event has non-empty `eventId`, `eventKind`, `occurredAtMs`, `riskLevel`, and `enforcementAction`

Dashboard tests:

- risk bucket totals equal user-visible event total
- raw audit total is not exposed by the dashboard overview response
- chart data uses user-visible events

Frontend tests:

- audit log default page renders user-visible events
- raw audit page renders hook-level raw events
- time is a standalone table column
- QA drawer opens wide on desktop
- QA display chain is visible by default
- clicking a node expands the node card itself
- no bottom node-detail card appears after node selection

## Acceptance Criteria

- Dashboard level counts and charts use user-visible events.
- Default audit log uses user-visible events.
- Raw audit stays accessible as a secondary page.
- QA drawer shows input/tool/output chain by default.
- Skill/plugin install and other user-visible processes can be counted as events outside conversation flow.
- Every event displayed to users has a risk level.
- Time is a separate list column on touched list pages.
- Runtime sync and real OpenClaw validation are performed before claiming live behavior changed.
