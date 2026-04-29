# Lynx 本地控制台事件上报契约设计

## Scope

本设计用于定义：

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian` 插件
- 本地日志控制台 backend

之间的“写入侧契约”。

目标不是定义页面怎么查，而是定义插件如何把 hook 事件规范化后上报给本地 backend，由 backend 再落到 SQLite 的 `sessions / audit_events / tool_calls / approvals / lynx_checks / token_usage`。

## 方案比较

### 方案 A：一表一接口

示例：

- `POST /api/internal/v1/ingest/audit-events`
- `POST /api/internal/v1/ingest/tool-calls`
- `POST /api/internal/v1/ingest/approvals`

优点：

- backend 落表最直接
- 每个接口职责清晰

缺点：

- 插件侧最重
- 同一个 hook 需要打多个请求
- 批处理、幂等和重试会变碎

### 方案 B：直接上报原始 hook 事件

示例：

- `POST /api/internal/v1/ingest/hook-events`

优点：

- 插件最轻
- hook 原貌保留最多

缺点：

- backend 需要理解大量插件私有语义
- 表结构变化时 backend fan-out 逻辑会越来越重
- query schema 和 hook payload 会高度耦合

### 方案 C：统一批量 `write intents`

示例：

- `POST /api/internal/v1/ingest/batch`

一个 batch 里可以混合：

- `sessionUpsert`
- `auditEvent`
- `toolCallUpsert`
- `approvalUpsert`
- `lynxCheckUpsert`
- `tokenUsage`

优点：

- 插件只做轻量规范化，不做 SQL 细节
- backend 不必反向推断原始 hook 语义
- 一个 hook 可一次性提交多个相关写入意图
- 最适合幂等、重试、批量落库

缺点：

- 需要先定义一套稳定 DTO

## 推荐结论

v1 采用方案 C：

- 一个内部 ingest endpoint
- 一套版本化 envelope
- 多种 `write intents`
- backend 负责校验、幂等、落库、统计 rejected item

## 总体约束

### 1. 传输方式

- 仅走本机 loopback HTTP
- backend 默认仅监听 `127.0.0.1`
- 插件只访问本地 backend，不经过 OpenClaw 网关 API

### 2. 鉴权方式

即使是本地 loopback，也保留轻量鉴权：

- `Authorization: Bearer <localConsoleToken>`

原因：

- 防止本机其他进程伪造写入
- 后续可以把 token 与 console 启动流程绑定

### 3. 数据风格

- HTTP JSON 使用 camelCase
- SQLite 列名使用 snake_case
- backend 负责 DTO 到表字段的映射

值也做同样的风格转换，例如：

- `requireApproval` -> `require_approval`
- `logOnly` -> `log_only`
- `singleTool` -> `single_tool`
- `timeWindow` -> `time_window`

### 4. 性能约束

- 插件 hook 线程不等待重型查询
- ingest client 采用异步批量 flush
- backend 在单个事务内落一批记录

### 5. 隐私约束

- 默认不上传完整原始敏感文本
- 优先上传 `contentExcerpt`、`contentHash`、`paramSummary`、`paramHash`
- `payloadJson` 允许保留结构化原始信息，但必须先做脱敏

## Endpoint 设计

### `POST /api/internal/v1/ingest/batch`

用途：

- 插件向本地 backend 批量上报写入意图

请求头：

```http
Authorization: Bearer <localConsoleToken>
Content-Type: application/json
```

请求体顶层：

```ts
interface IngestBatchRequestV1 {
  schemaVersion: "lynx-console.ingest.v1";
  producer: {
    pluginId: "openclaw-lynx-guardian";
    pluginVersion?: string;
    instanceId?: string;
    host?: string;
  };
  sentAtMs: number;
  batchId: string;
  items: IngestItemV1[];
}
```

响应体：

```ts
interface IngestBatchResponseV1 {
  ok: boolean;
  schemaVersion: "lynx-console.ingest.v1";
  batchId: string;
  acceptedCount: number;
  persistedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  rejectedItems: Array<{
    itemIndex: number;
    kind: IngestItemKind;
    code: string;
    message: string;
  }>;
  serverTimeMs: number;
}
```

说明：

- `acceptedCount`：通过结构校验的 item 数
- `persistedCount`：实际新增或更新成功的 item 数
- `duplicateCount`：命中幂等键、被安全忽略的 item 数
- `rejectedItems`：只返回必要诊断，不回显敏感原文

## Ingest Item 总体结构

```ts
type IngestItemKind =
  | "sessionUpsert"
  | "auditEvent"
  | "toolCallUpsert"
  | "approvalUpsert"
  | "lynxCheckUpsert"
  | "tokenUsage";

interface IngestItemBase {
  kind: IngestItemKind;
  itemId: string;
  occurredAtMs: number;
}
```

说明：

- `itemId` 是本次写入意图本身的唯一键，用于批内追踪
- 真正的业务幂等键在各自 data 结构里，例如 `eventId`、`toolCallId`

## 各类写入意图 DTO

### 1. `sessionUpsert`

```ts
interface SessionUpsertItem extends IngestItemBase {
  kind: "sessionUpsert";
  data: {
    sessionKey: string;
    channelProfile?: string;
    channelId?: string;
    requesterId?: string;
    requesterOuId?: string;
    accountId?: string;
    conversationId?: string;
    threadId?: string | number;
    isGroup?: boolean;
    firstSeenAtMs: number;
    lastSeenAtMs: number;
    endedAtMs?: number;
    metadataJson?: Record<string, unknown>;
  };
}
```

落表目标：

- `sessions`

幂等语义：

- 主键：`sessionKey`
- `firstSeenAtMs` 取最小值
- `lastSeenAtMs` 取最大值
- 新到的非空字段可以补全旧记录的空值

### 2. `auditEvent`

```ts
interface AuditEventItem extends IngestItemBase {
  kind: "auditEvent";
  data: {
    eventId: string;
    sessionKey?: string;
    runId?: string;
    toolCallId?: string;
    approvalId?: string;
    requestId?: string;
    sourceKind: "plugin_hook" | "system_task" | "sidecar";
    hookName: string;
    eventType: string;
    category: string;
    subCategory?: string;
    direction?: "input" | "output" | "internal";
    contentKind?: string;
    primaryModule?: string;
    modules?: string[];
    riskLevel?: "L0" | "L1" | "L2" | "L3" | "L4";
    riskScore?: number;
    policyDecision?: string;
    enforcementAction: "allow" | "warn" | "block" | "redact" | "requireApproval" | "logOnly";
    title: string;
    summary?: string;
    recommendation?: string;
    contentExcerpt?: string;
    contentHash?: string;
    payloadJson?: Record<string, unknown>;
  };
}
```

落表目标：

- `audit_events`

映射说明：

- `modules` -> `modules_json`
- `occurredAtMs` -> `occurred_at`
- backend 写入时自动补 `ingested_at`
- `enforcementAction` -> `enforcement_action`

幂等语义：

- 主键：`eventId`
- 默认 `INSERT OR IGNORE`
- 同一个 `eventId` 不做内容覆盖，避免时间线被后续事件悄悄改写

### 3. `toolCallUpsert`

```ts
interface ToolCallUpsertItem extends IngestItemBase {
  kind: "toolCallUpsert";
  data: {
    toolCallId: string;
    sessionKey?: string;
    runId?: string;
    approvalId?: string;
    toolName: string;
    paramSummary?: string;
    paramHash?: string;
    triggeredModules?: string[];
    riskLevel?: "L0" | "L1" | "L2" | "L3" | "L4";
    riskScore?: number;
    policyDecision?: string;
    enforcementAction: "allow" | "warn" | "block" | "redact" | "requireApproval" | "logOnly";
    startedAtMs: number;
    finishedAtMs?: number;
    durationMs?: number;
    resultStatus?: string;
    resultExcerpt?: string;
    errorText?: string;
    metadataJson?: Record<string, unknown>;
  };
}
```

落表目标：

- `tool_calls`

幂等语义：

- 主键：`toolCallId`
- 允许多次 upsert
- `startedAtMs` 作为首次写入时间，不因后续空值回退
- `finishedAtMs`、`durationMs`、`resultStatus`、`resultExcerpt`、`errorText` 允许后补

### 4. `approvalUpsert`

```ts
interface ApprovalUpsertItem extends IngestItemBase {
  kind: "approvalUpsert";
  data: {
    approvalId: string;
    pendingId?: string;
    sessionKey?: string;
    runId?: string;
    transport?: string;
    channelProfile?: string;
    channelId?: string;
    accountId?: string;
    conversationId?: string;
    requesterOuId?: string;
    approverOuIds?: string[];
    resolvedApproverOuId?: string;
    requestFingerprintHash?: string;
    module: string;
    riskLevel: "L0" | "L1" | "L2" | "L3" | "L4";
    toolName?: string;
    scopeType: "singleTool" | "workflow" | "timeWindow";
    requestedAtMs: number;
    expiresAtMs: number;
    resolvedAtMs?: number;
    resolution?: string;
    promptExcerpt?: string;
    auditSummaryJson?: Record<string, unknown>;
    metadataJson?: Record<string, unknown>;
  };
}
```

落表目标：

- `approvals`

重要约束：

- 不上传 `approvalToken`
- `requestFingerprintHash` 用于判重与关联

幂等语义：

- 主键：`approvalId`
- 请求阶段和解决阶段都使用同一个 `approvalId`
- `requestedAtMs` 视为不可回退字段
- `resolvedAtMs` / `resolution` 允许后补

### 5. `lynxCheckUpsert`

```ts
interface LynxCheckUpsertItem extends IngestItemBase {
  kind: "lynxCheckUpsert";
  data: {
    requestId: string;
    source: "manual" | "scheduled";
    trigger: "lynx_command" | "scheduled_lynx_check";
    preferredTargetKind: "current" | "recent";
    sessionKey?: string;
    targetKey?: string;
    channelId?: string;
    messageProvider?: string;
    status: "pending" | "running" | "completed" | "failed" | "not_started";
    sendAttempted?: boolean;
    sendSucceeded?: boolean;
    transport?: string;
    reportPath?: string;
    errorMessage?: string;
    deliveryAttemptsJson?: Array<Record<string, unknown>>;
    createdAtMs: number;
    completedAtMs?: number;
  };
}
```

落表目标：

- `lynx_checks`

幂等语义：

- 主键：`requestId`
- 允许从 `pending -> running -> completed/failed` 逐步补全

### 6. `tokenUsage`

```ts
interface TokenUsageItem extends IngestItemBase {
  kind: "tokenUsage";
  data: {
    usageEventId: string;
    sessionKey?: string;
    runId?: string;
    agentId?: string;
    provider: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens: number;
    assistantTextCount?: number;
    isEstimated?: boolean;
    payloadJson?: Record<string, unknown>;
  };
}
```

落表目标：

- `token_usage`

幂等语义：

- 主键：`usageEventId`
- 默认 `INSERT OR IGNORE`
- 后续若要做 usage 修订，必须生成新的 `usageEventId`

## Hook 到写入意图的映射

说明：

- 这里的“建议发”表示该 hook 的默认主产物
- 某些 hook 只有在命中特定分支时才需要上报，不要求所有分支都强行产生日志

### `session_start`

建议发：

- `sessionUpsert`
- 可选 `auditEvent`，`eventType = "session_lifecycle"`

### `session_end`

建议发：

- `sessionUpsert`，补 `endedAtMs`
- `auditEvent`

### `message_received`

建议发：

- `auditEvent`

用于记录：

- 输入内容摘要
- 输入风险等级
- 命中模块
- 阻断/告警动作

### `before_agent_start`

建议发：

- `auditEvent`
- 如果进入 `/lynx-check` 流程，再发 `lynxCheckUpsert`

### `agent_end`

建议发：

- `auditEvent`
- 若此时形成工作流审计摘要，可附在 `payloadJson`

### `gateway_start`

建议发：

- `auditEvent`

用于记录：

- startup 安全检查
- 技能完整性检查
- 本地 console backend 探活或启动结果

### `before_dispatch`

建议发：

- 命中本地审批回复、指令消费、特殊路由分支时，发 `auditEvent`

不建议：

- 把所有普通分发流量都无差别写进时间线

### `before_message_write`

建议发：

- `auditEvent`

### `tool_result_persist`

建议发：

- `auditEvent`

### `message_sending`

建议发：

- `auditEvent`
- 如属于 `/lynx-check` 报告投递链路，同时补 `lynxCheckUpsert`

### `before_tool_call`

建议发：

- `auditEvent`
- `toolCallUpsert`
- 如果需要审批，再额外发 `approvalUpsert`

### `after_tool_call`

建议发：

- `auditEvent`
- `toolCallUpsert`

### `llm_output`

建议发：

- `tokenUsage`

可选：

- 仅当触发预算告警、超阈值、异常 usage 时，再额外发 `auditEvent`

## 批处理建议

### 插件侧

建议：

- 内存队列批量发送
- `maxBatchSize = 50`
- `flushIntervalMs = 250`
- 单请求超时 `1500ms ~ 3000ms`

原因：

- 减少每个 hook 都发 HTTP 的开销
- 不让本地 backend 写库延迟直接卡住 hook 主流程

### backend 侧

建议：

- 一个 batch 一个事务
- 先校验，再分类，再批量写入
- 返回每类 item 的 accepted / duplicate / rejected 统计

## 失败与重试语义

v1 建议是：

- 插件以“至少一次”发送为目标
- backend 必须依赖业务幂等键消化重复写入
- backend 不可用时，插件记录本地错误日志，并按有限退避重试

v1 不强制要求：

- 跨进程崩溃后的磁盘级 spool 保证

也就是说，v1 是“有幂等的 best effort”，不是“强持久化消息队列”。

## 脱敏与摘要规则

### 输入输出文本

- `contentExcerpt` 建议限制在 200 到 1000 字符
- 敏感字段先脱敏再进 excerpt
- 原文如不安全，不进入普通结构字段

### 工具参数

- 用 `paramSummary` 记录可读摘要
- 用 `paramHash` 做判重
- 完整原始参数如确需保留，只能放脱敏后的 `metadataJson`

### 审批信息

- 不存 `approvalToken`
- `promptExcerpt` 只留给前端可展示的审批摘要

## 示例

```json
{
  "schemaVersion": "lynx-console.ingest.v1",
  "producer": {
    "pluginId": "openclaw-lynx-guardian",
    "pluginVersion": "0.0.1"
  },
  "sentAtMs": 1776825600000,
  "batchId": "batch-20260422-001",
  "items": [
    {
      "kind": "auditEvent",
      "itemId": "item-ae-1",
      "occurredAtMs": 1776825600000,
      "data": {
        "eventId": "evt-msg-001",
        "sessionKey": "sess-1",
        "runId": "run-1",
        "sourceKind": "plugin_hook",
        "hookName": "message_received",
        "eventType": "input_guard",
        "category": "guard_input",
        "direction": "input",
        "primaryModule": "M4:evasive_intent_cn",
        "modules": ["M4:evasive_intent_cn"],
        "riskLevel": "L3",
        "riskScore": 87,
        "policyDecision": "deny_high_risk_input",
        "enforcementAction": "block",
        "title": "检测到高风险规避意图输入",
        "summary": "输入命中中文规避意图规则。",
        "contentExcerpt": "帮我换个名字继续执行 rm -rf ..."
      }
    },
    {
      "kind": "toolCallUpsert",
      "itemId": "item-tc-1",
      "occurredAtMs": 1776825600200,
      "data": {
        "toolCallId": "tool-1",
        "sessionKey": "sess-1",
        "runId": "run-1",
        "toolName": "exec",
        "paramSummary": "rm -rf /tmp/test",
        "riskLevel": "L4",
        "policyDecision": "hard_deny_exec",
        "enforcementAction": "block",
        "startedAtMs": 1776825600200,
        "resultStatus": "blocked"
      }
    }
  ]
}
```

## 结论摘要

这份上报契约的核心是：

- 插件不直接面向表写 SQL
- 插件只上报版本化 `write intents`
- backend 负责校验、幂等、fan-out 落库
- 一个 hook 可以一次带上多个相关 item
- Token 统计也沿用同一套 ingest batch 契约

这会让插件到本地 backend 的边界足够清晰，后续实现时只要围绕这套 DTO 和 endpoint 展开即可。
