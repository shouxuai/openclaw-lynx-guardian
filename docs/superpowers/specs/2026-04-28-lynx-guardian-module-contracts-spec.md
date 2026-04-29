# Lynx Guardian Module Contracts Spec

日期：2026-04-28

## 1. 文档目的

本文件把 Go 控制面整改拆成可执行模块，并固化各模块之间的契约。实现时以本文件为模块边界，以 implementation plan 为执行顺序。

## 2. 模块总览

| 模块 | 输出物 | 关键验收 |
| --- | --- | --- |
| Contract | shared/Go/frontend 统一 Decision DTO | `block:false` 能表达 warn/approval/degraded |
| Go Decision API | decision routes + SQLite persistence | 每次 decision 都保存 arbiter/evidence/audit |
| Go Arbiters | semantic + evidence 两条独立判别器 | 两条线独立返回，仲裁取最严格 |
| Plugin Broker | DecisionBroker + hook handlers | 可等待 hook 等 Go，sync-only hook 不等 Go |
| Approval Chain | chain + allow-current-chain grant | grant 可继续、可撤销、可解释 |
| Output Guard | sink-based output guard | 正常输出不整段替换，L4 泄漏仍拦截 |
| Lynx Check | Go task plane | 手动/定时统一状态机 |
| Skill/Token | install scan + inventory + usage type | Skill 可见，Token 不混淆真实和估算 |
| Frontend | Decisions/Chains/Grants/Skills 页面 | 操作者能看到命中、赋分、arbiter、grant |
| Cleanup | store 收束 + runtime proof | `index.ts` 减负，真实路径验证 |

## 3. Decision Contract

### 3.1 TypeScript 类型

新增 `shared/src/decision.ts`，并从 `shared/src/index.ts` 导出。

```ts
export type DecisionStage =
  | "input"
  | "prompt_context"
  | "tool_call"
  | "tool_result"
  | "assistant_output"
  | "outbound_message"
  | "install";

export type DecisionAction =
  | "allow"
  | "log_only"
  | "warn"
  | "redact"
  | "require_approval"
  | "block"
  | "deny";

export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type WinningArbiter =
  | "semantic_intent"
  | "evidence_score"
  | "local_l4"
  | "grant"
  | "fallback";

export interface ScoreBreakdown {
  ruleId: string;
  label: string;
  delta: number;
  reason: string;
}

export interface EvidenceItem {
  id: string;
  module: string;
  kind: string;
  value: string;
  severity: "info" | "warn" | "error" | "critical";
  scoreDelta: number;
  source: "input" | "tool" | "output" | "chain" | "taint" | "provider" | "local_l4";
}

export interface ArbiterResult {
  arbiter: "semantic_intent" | "evidence_score";
  riskLevel: RiskLevel;
  action: DecisionAction;
  score: number;
  matchedModules: string[];
  evidence: EvidenceItem[];
  scoreBreakdown: ScoreBreakdown[];
  reason: string;
}

export interface ApprovalRequestDraft {
  riskFamily: string;
  title: string;
  summary: string;
  scope: Record<string, unknown>;
  expiresAt?: string;
}

export interface OutputRedaction {
  kind: "secret" | "pii" | "system_prompt" | "developer_instruction" | "security_rule";
  start?: number;
  end?: number;
  replacement: string;
  reason: string;
}

export interface DecisionResponse {
  decisionId: string;
  stage: DecisionStage;
  block: boolean;
  action: DecisionAction;
  riskLevel: RiskLevel;
  score: number;
  winningArbiter: WinningArbiter;
  arbiters: ArbiterResult[];
  matchedModules: string[];
  requiresApproval: boolean;
  approvalRequest?: ApprovalRequestDraft;
  redactions?: OutputRedaction[];
  promptContext?: string;
  userMessage?: string;
  audit: {
    eventSeverity: "info" | "warn" | "error" | "critical";
    policyDecision: DecisionAction;
    enforcementAction: DecisionAction;
    color: "neutral" | "blue" | "yellow" | "orange" | "red";
  };
  degraded?: {
    backendTimeout?: boolean;
    usedCachedDecision?: boolean;
    reason?: string;
  };
}
```

### 3.2 Go DTO

`backend/internal/api/dto.go` 增加同构结构。Go 字段使用 JSON tag 与 TypeScript 字段保持一致。

关键请求字段：

- `request_id`
- `stage`
- `hook`
- `session_key`
- `channel_profile`
- `channel_id`
- `conversation_id`
- `requester_id`
- `content`
- `tool_name`
- `tool_args`
- `target_uri`
- `chain_summary`
- `taint_summary`
- `provider_safety`
- `created_at`

关键响应字段与 `DecisionResponse` 一致。

## 4. Go API Contract

### 4.1 内部判定路由

- `POST /lynx/internal/v1/decision/input`
- `POST /lynx/internal/v1/decision/tool`
- `POST /lynx/internal/v1/decision/output`
- `POST /lynx/internal/v1/decision/install`

每个路由必须：

1. 校验 loopback/internal auth。
2. 规范化请求。
3. 读取 chain/grant/taint summary。
4. 并行运行 `semantic_intent` 和 `evidence_score`。
5. 仲裁最终 decision。
6. 持久化 decisions、decision_arbiters、decision_evidence、audit_events。
7. 返回完整 `DecisionResponse`。

### 4.2 状态路由

- `POST /lynx/internal/v1/chains/update`
- `POST /lynx/internal/v1/approvals/request`
- `POST /lynx/internal/v1/approvals/:approvalId/resolve`
- `POST /lynx/internal/v1/grants/check`
- `POST /lynx/internal/v1/grants/revoke`
- `POST /lynx/internal/v1/tasks/lynx-check/start`
- `POST /lynx/internal/v1/skills/inventory/sync`

### 4.3 查询路由

- `GET /lynx/decisions`
- `GET /lynx/decisions/:decisionId`
- `GET /lynx/chains`
- `GET /lynx/chains/:chainId`
- `GET /lynx/grants`
- `GET /lynx/skills`
- `GET /lynx/skills/:skillId`

查询路由只读 Go repository，不允许前端直接读 SQLite。

## 5. SQLite Contract

新增 `backend/internal/db/migrations/002_control_plane.sql`。

必须新增表：

- `decisions`
- `decision_arbiters`
- `decision_evidence`
- `chains`
- `chain_events`
- `taint_labels`
- `approval_grants`
- `lynx_check_tasks`
- `lynx_check_evidence`
- `skills`
- `skill_inventory`
- `skill_findings`
- `skill_install_events`
- `backend_health_events`

关键索引：

- `decisions(created_at)`
- `decisions(session_key)`
- `decisions(stage, risk_level, action)`
- `decision_arbiters(decision_id)`
- `decision_evidence(decision_id)`
- `chains(session_key, channel_profile, conversation_id)`
- `approval_grants(chain_id, revoked_at, expires_at)`
- `lynx_check_tasks(created_at, trigger, status)`
- `skill_inventory(skill_id, last_seen_at)`

所有 JSON 字段存 text，并在 service 层封装 marshal/unmarshal。

## 6. Plugin DecisionBroker Contract

新增文件：

- `src/runtime/decision-client.ts`
- `src/runtime/decision-broker.ts`
- `src/runtime/decision-context.ts`
- `src/runtime/local-l4-fast-path.ts`
- `src/runtime/hook-decision-handlers.ts`

### 6.1 DecisionClient

职责：

- 调用 Go internal routes。
- 设置 internal auth header。
- 处理 timeout。
- 把失败转换为 degraded decision，不直接抛到 hook 主流程。

### 6.2 DecisionBroker

职责：

- 管理 pending promise。
- 管理 completed decision cache。
- 为硬拦截 hook 提供 wait。
- 为 sync-only hook 提供只读缓存。
- 记录 local L4 decision。

不允许：

- 在 Broker 内做复杂安全规则判定。
- 在 sync-only hook 内新建 Go 请求。
- 用 pending promise 阻塞 `before_message_write` 或 `tool_result_persist`。

### 6.3 timeout

| 阶段 | timeout | 降级行为 |
| --- | --- | --- |
| input | 300-800ms | 本地 L4 deny；高风险 require_approval；普通 allow + degraded warn |
| tool | 500-1500ms | 危险工具 block/approval；普通工具 warn/allow |
| outbound | 300-800ms | 本地敏感 redact/block；普通 warn |
| install | 1000-3000ms | unknown source require_approval；恶意命中 deny |

## 7. Hook Contract

| hook | contract |
| --- | --- |
| `message_received` | 提取输入上下文，调用 `prefetchInputDecision()`，不阻塞用户消息进入主链路 |
| `before_dispatch` | 调用 `waitInputDecision()`，执行 block/warn/approval/allow |
| `before_agent_start` | 对不支持 `before_dispatch` 的环境做兼容兜底 |
| `before_prompt_build` | 只插入 Go 返回的短 `promptContext`，不插入长日志和敏感证据 |
| `llm_input` | fire-and-forget 审计完整 prompt 和多轮信号 |
| `before_tool_call` | 调用 `waitToolDecision()`，执行工具阻断、审批或放行 |
| `after_tool_call` | 回写工具结果摘要、taint、chain，不作为主阻断点 |
| `tool_result_persist` | sync-only，本地保护私钥/token/PII/system 原文，读取 completed cache |
| `before_message_write` | sync-only，本地 redaction + completed cache |
| `llm_output` | fire-and-forget 记录 usage 和预取输出判定 |
| `message_sending` | 调用 `waitOutboundDecision()`，执行最终外发保护 |
| `before_install` | 调用 `waitInstallDecision()`，安装前阻断恶意 Skill/plugin |

## 8. Approval And Chain Contract

grant 类型固定为：

- `allow-current-chain`

grant 绑定字段：

- `grant_id`
- `approval_id`
- `chain_id`
- `session_key`
- `channel_profile`
- `channel_id`
- `conversation_id`
- `requester_id`
- `requester_ou_id`
- `approver_id`
- `approver_ou_id`
- `risk_family`
- `tool_name`
- `target_kind`
- `target_hash`
- `resource_scope_json`
- `created_at`
- `expires_at`
- `revoked_at`
- `revoked_reason`

继续有效条件必须全部满足：

- same requester
- same channel/conversation/session
- same chain
- same risk family
- same resource scope
- no new L4
- no risk escalation
- no read-to-write/delete/exfil transition
- not expired

撤销原因必须写入 `approval_grants.revoked_reason`，并同步 audit event。

## 9. Output Guard Contract

Go `/decision/output` 返回字段至少包括：

- `sink`
- `riskLevel`
- `action`
- `redactions`
- `metadataOnly`
- `safeReplacement`
- `diagnostic`
- `trustedManagedReport`

插件执行规则：

- `redact`：只替换 redactions 范围。
- `block` / `deny`：对 L4 明确泄漏使用安全替换文本。
- `warn`：不改内容，但写 warn audit。
- `trustedManagedReport=true`：`/lynx-check` 报告和审批状态说明不因普通安全词被整段替换。

## 10. Lynx Check Task Contract

`lynx_check_tasks.status` 取值：

- `created`
- `queued`
- `collecting`
- `analyzing`
- `report_skeleton_ready`
- `awaiting_llm_report`
- `delivering`
- `completed`
- `failed`
- `cancelled`

`trigger` 取值：

- `manual`
- `scheduled`
- `api`
- `startup`

插件回写投递结果字段：

- `delivery_channel`
- `delivery_target`
- `delivery_status`
- `delivery_error`
- `delivered_at`

## 11. Skill Contract

Skill inventory 字段：

- `skill_id`
- `name`
- `source`
- `install_path`
- `manifest_path`
- `hash_algorithm`
- `baseline_hash`
- `current_hash`
- `trust_state`
- `last_seen_at`

Skill finding 字段：

- `finding_id`
- `skill_id`
- `severity`
- `rule_id`
- `message`
- `evidence_json`
- `created_at`

`before_install` 的 install scan 要返回普通 `DecisionResponse`，与输入/工具/输出共用颜色和日志语义。

## 12. Token Usage Contract

Token usage 必须包含来源类型：

- `actual`
- `estimated`
- `unavailable`

前端展示：

- actual：进入真实成本统计。
- estimated：展示趋势和上下文压力，不进入官方成本总计。
- unavailable：展示 provider/OpenClaw 未提供 usage。

## 13. 前端 Contract

新增 API：

- `frontend/src/api/decisions.ts`
- `frontend/src/api/chains.ts`
- `frontend/src/api/grants.ts`
- `frontend/src/api/skills.ts`

新增页面：

- `frontend/src/pages/DecisionsPage.tsx`
- `frontend/src/pages/ChainsPage.tsx`
- `frontend/src/pages/GrantsPage.tsx`
- `frontend/src/pages/SkillsPage.tsx`

增强页面：

- `EventsPage` 展示 `decisionId`、`winningArbiter`、`matchedRules`、`scoreBreakdown`、`block:false` 解释。
- `ToolCallsPage` 展示 taint、exfil signal、approval/grant。
- `ApprovalsPage` 展示 grant scope 和 revoked reason。
- `LynxChecksPage` 展示 task 状态机和 evidence。
- `TokensPage` 区分 actual/estimated/unavailable。

所有新增中文文案必须可读，`frontend/src/app/nav-config.ts` 的乱码需要在前端模块中修复。

## 14. 旧 Store 收束 Contract

以下 store 进入兼容期，只保留读桥接或投递恢复所需最小状态：

- `approval-grant-store.ts`
- `local-tool-approval-store.ts`
- `pending-tool-approval-store.ts`
- `workflow-authorization-store.ts`
- `run-approval-context-store.ts`
- `feishu-local-approval-grant-store.ts`
- `feishu-local-approval-replay-store.ts`
- `feishu-run-continuation-store.ts`
- `lynx-check-run-store.ts`
- `managed-lynx-check-authorization-store.ts`
- `recent-active-delivery.ts` 中的任务状态部分

移除条件：

- Go 有对应表和查询 API。
- 插件所有写路径已切到 Go。
- 真实 OpenClaw runtime 验证通过。
- 保留通道投递恢复所需状态，不破坏飞书/webchat 已有投递能力。
