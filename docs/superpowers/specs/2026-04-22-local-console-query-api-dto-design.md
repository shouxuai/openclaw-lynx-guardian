# Lynx 本地控制台查询 API 与 DTO 草案

## Scope

本设计用于定义本地 backend 的“读取侧契约”：

- 前端日志页面通过哪些查询 API 取数据
- 每个接口支持哪些筛选参数
- 每个接口返回的 DTO 长什么样

本设计建立在以下前提之上：

- SQLite 表结构已由 `2026-04-22-local-console-logging-001_init.sql` 定义
- 插件到 backend 的写入侧契约由 `2026-04-22-local-console-ingest-contract-design.md` 定义

## 设计原则

### 1. API 风格

- 只读接口统一用 `GET`
- JSON 字段统一 camelCase
- 数据库 snake_case 到 DTO camelCase 的转换由 backend 完成

值也统一做风格转换，例如：

- 数据库 `require_approval` -> DTO `requireApproval`
- 数据库 `log_only` -> DTO `logOnly`
- 数据库 `single_tool` -> DTO `singleTool`
- 数据库 `time_window` -> DTO `timeWindow`

### 2. 列表页与详情页分离

- 列表接口返回轻量 DTO
- 详情接口才返回 `payloadJson`、`metadataJson` 等重字段

### 3. 时间与筛选优先

日志页的主要查询路径几乎都围绕：

- 时间范围
- 风险等级
- 执行动作
- 会话
- 运行链路 ID

因此 v1 的接口和索引都优先服务这些维度。

### 4. v1 使用 cursor 分页

原因：

- 本地日志会持续增长
- 相比 `offset`，cursor 对大表更稳

统一约定：

- 列表接口支持 `limit`
- 列表接口支持 `cursor`
- 排序默认都是“最新在前”

## 通用 DTO

### Cursor 分页

```ts
interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}
```

### 风险分布

```ts
interface RiskBucketDto {
  riskLevel: "L0" | "L1" | "L2" | "L3" | "L4";
  count: number;
}
```

### 动作分布

```ts
interface EnforcementBucketDto {
  enforcementAction: "allow" | "warn" | "block" | "redact" | "requireApproval" | "logOnly";
  count: number;
}
```

### 时间趋势点

```ts
interface TimeSeriesPointDto {
  bucketStartMs: number;
  value: number;
}
```

## 通用筛选参数

大多数列表接口建议支持：

```ts
interface CommonListQuery {
  fromMs?: number;
  toMs?: number;
  sessionKey?: string;
  runId?: string;
  riskLevel?: Array<"L0" | "L1" | "L2" | "L3" | "L4">;
  enforcementAction?: Array<"allow" | "warn" | "block" | "redact" | "requireApproval" | "logOnly">;
  limit?: number;
  cursor?: string;
}
```

## Health 与能力接口

### `GET /api/health`

用途：

- 前端探活

返回：

```ts
interface HealthDto {
  ok: boolean;
  serverTimeMs: number;
  schemaVersion: string;
}
```

### `GET /api/meta/capabilities`

用途：

- 前端判断哪些页面可以显示

返回：

```ts
interface CapabilitiesDto {
  tokenUsageEnabled: boolean;
  gatewayAuthLogsEnabled: boolean;
  queryApiVersion: "v1";
}
```

## Dashboard

### `GET /api/dashboard/overview`

参数：

- `fromMs`
- `toMs`

返回：

```ts
interface DashboardOverviewDto {
  totals: {
    eventCount: number;
    highRiskEventCount: number;
    toolCallCount: number;
    approvalCount: number;
    lynxCheckCount: number;
    totalTokens: number;
  };
  riskDistribution: RiskBucketDto[];
  enforcementDistribution: EnforcementBucketDto[];
  eventTrend: TimeSeriesPointDto[];
  tokenTrend: TimeSeriesPointDto[];
  recentHighRiskEvents: AuditEventListItemDto[];
  recentToolCalls: ToolCallListItemDto[];
  recentApprovals: ApprovalListItemDto[];
}
```

用途：

- Dashboard 顶部卡片
- 风险分布图
- 动作分布图
- 最近高风险事件
- 最近工具调用与审批

## 审计事件 API

### `GET /api/events`

额外参数：

- `hookName`
- `eventType`
- `category`
- `subCategory`
- `direction`
- `primaryModule`
- `requestId`
- `toolCallId`
- `approvalId`

返回：

```ts
interface AuditEventListItemDto {
  eventId: string;
  sessionKey?: string;
  runId?: string;
  toolCallId?: string;
  approvalId?: string;
  requestId?: string;
  sourceKind: string;
  hookName: string;
  eventType: string;
  category: string;
  subCategory?: string;
  direction?: string;
  primaryModule?: string;
  riskLevel?: string;
  riskScore?: number;
  policyDecision?: string;
  enforcementAction: string;
  title: string;
  summary?: string;
  contentExcerpt?: string;
  occurredAtMs: number;
}
```

响应：

```ts
type AuditEventListResponse = CursorPage<AuditEventListItemDto>;
```

### `GET /api/events/:eventId`

返回：

```ts
interface AuditEventDetailDto extends AuditEventListItemDto {
  contentKind?: string;
  modules?: string[];
  recommendation?: string;
  contentHash?: string;
  ingestedAtMs: number;
  payloadJson?: Record<string, unknown>;
}
```

## 工具调用 API

### `GET /api/tool-calls`

额外参数：

- `toolName`
- `resultStatus`
- `approvalId`

返回：

```ts
interface ToolCallListItemDto {
  toolCallId: string;
  sessionKey?: string;
  runId?: string;
  approvalId?: string;
  toolName: string;
  riskLevel?: string;
  riskScore?: number;
  policyDecision?: string;
  enforcementAction: string;
  startedAtMs: number;
  finishedAtMs?: number;
  durationMs?: number;
  resultStatus?: string;
  resultExcerpt?: string;
}
```

响应：

```ts
type ToolCallListResponse = CursorPage<ToolCallListItemDto>;
```

### `GET /api/tool-calls/:toolCallId`

返回：

```ts
interface ToolCallDetailDto extends ToolCallListItemDto {
  paramSummary?: string;
  paramHash?: string;
  triggeredModules?: string[];
  errorText?: string;
  metadataJson?: Record<string, unknown>;
}
```

## 审批 API

### `GET /api/approvals`

额外参数：

- `resolution`
- `toolName`
- `module`
- `scopeType`
- `requesterOuId`

返回：

```ts
interface ApprovalListItemDto {
  approvalId: string;
  pendingId?: string;
  sessionKey?: string;
  runId?: string;
  transport?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: string;
  toolName?: string;
  scopeType: string;
  requestedAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  resolution?: string;
  promptExcerpt?: string;
}
```

响应：

```ts
type ApprovalListResponse = CursorPage<ApprovalListItemDto>;
```

### `GET /api/approvals/:approvalId`

返回：

```ts
interface ApprovalDetailDto extends ApprovalListItemDto {
  channelProfile?: string;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  approverOuIds?: string[];
  resolvedApproverOuId?: string;
  requestFingerprintHash?: string;
  auditSummaryJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
}
```

## Lynx Check API

### `GET /api/lynx-checks`

额外参数：

- `source`
- `trigger`
- `status`
- `messageProvider`

返回：

```ts
interface LynxCheckListItemDto {
  requestId: string;
  source: "manual" | "scheduled";
  trigger: "lynx_command" | "scheduled_lynx_check";
  preferredTargetKind: "current" | "recent";
  sessionKey?: string;
  targetKey?: string;
  channelId?: string;
  messageProvider?: string;
  status: string;
  sendAttempted: boolean;
  sendSucceeded: boolean;
  transport?: string;
  reportPath?: string;
  errorMessage?: string;
  createdAtMs: number;
  completedAtMs?: number;
}
```

响应：

```ts
type LynxCheckListResponse = CursorPage<LynxCheckListItemDto>;
```

### `GET /api/lynx-checks/:requestId`

返回：

```ts
interface LynxCheckDetailDto extends LynxCheckListItemDto {
  deliveryAttemptsJson?: Array<Record<string, unknown>>;
}
```

## Session API

### `GET /api/sessions`

额外参数：

- `channelProfile`
- `channelId`
- `requesterId`
- `requesterOuId`
- `isGroup`

返回：

```ts
interface SessionListItemDto {
  sessionKey: string;
  channelProfile?: string;
  channelId?: string;
  requesterId?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  isGroup: boolean;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  endedAtMs?: number;
  eventCount?: number;
  highRiskEventCount?: number;
  toolCallCount?: number;
}
```

响应：

```ts
type SessionListResponse = CursorPage<SessionListItemDto>;
```

### `GET /api/sessions/:sessionKey`

返回：

```ts
interface SessionDetailDto extends SessionListItemDto {
  metadataJson?: Record<string, unknown>;
  recentEvents: AuditEventListItemDto[];
  recentToolCalls: ToolCallListItemDto[];
  recentApprovals: ApprovalListItemDto[];
  tokenSummary?: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
}
```

## Token API

### `GET /api/tokens/usage`

额外参数：

- `provider`
- `model`
- `agentId`
- `isEstimated`

返回：

```ts
interface TokenUsageListItemDto {
  usageEventId: string;
  sessionKey?: string;
  runId?: string;
  agentId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  assistantTextCount: number;
  isEstimated: boolean;
  occurredAtMs: number;
}
```

响应：

```ts
type TokenUsageListResponse = CursorPage<TokenUsageListItemDto>;
```

### `GET /api/tokens/summary`

参数：

- `fromMs`
- `toMs`
- `sessionKey`
- `runId`
- `provider`
- `model`

返回：

```ts
interface TokenSummaryDto {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCount: number;
  topModels: Array<{
    model: string;
    totalTokens: number;
  }>;
}
```

### `GET /api/tokens/trend`

参数：

- `fromMs`
- `toMs`
- `bucket = hour | day`
- `provider`
- `model`

返回：

```ts
interface TokenTrendDto {
  bucket: "hour" | "day";
  points: Array<{
    bucketStartMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
}
```

## Cursor 规则

统一建议：

- 事件页以 `(occurredAtMs DESC, eventId DESC)` 排序
- 工具调用页以 `(startedAtMs DESC, toolCallId DESC)` 排序
- 审批页以 `(requestedAtMs DESC, approvalId DESC)` 排序
- Lynx Check 页以 `(createdAtMs DESC, requestId DESC)` 排序
- Session 页以 `(lastSeenAtMs DESC, sessionKey DESC)` 排序
- Token 页以 `(occurredAtMs DESC, usageEventId DESC)` 排序

cursor 可以是不透明字符串，但内部应至少包含：

- 当前排序时间字段
- 当前记录唯一键

## DTO 与页面映射

### Dashboard

主要使用：

- `DashboardOverviewDto`

### 全量日志页

主要使用：

- `AuditEventListItemDto`
- `AuditEventDetailDto`

### 工具调用页

主要使用：

- `ToolCallListItemDto`
- `ToolCallDetailDto`

### 审批页

主要使用：

- `ApprovalListItemDto`
- `ApprovalDetailDto`

### Lynx Check 页

主要使用：

- `LynxCheckListItemDto`
- `LynxCheckDetailDto`

### 会话页

主要使用：

- `SessionListItemDto`
- `SessionDetailDto`

### Token 页

主要使用：

- `TokenUsageListItemDto`
- `TokenSummaryDto`
- `TokenTrendDto`

## v1 不做的接口

- 不做写接口给前端
- 不做复杂布尔查询 DSL
- 不做自定义列配置持久化
- 不做 gateway auth logs 查询接口

## 结论摘要

这版查询 API / DTO 草案的重点是：

- 前端永远通过本地 backend 查数据
- 列表与详情 DTO 分层
- 以 cursor 分页支撑持续增长的本地日志
- 所有页面都围绕已定下来的 `6 + 2` 表架构展开

这样后续实现本地 backend 时，可以直接先把这些 `GET` 接口按优先级排出来，再逐页接前端。
