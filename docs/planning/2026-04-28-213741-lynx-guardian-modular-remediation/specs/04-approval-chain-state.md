# 04. Approval Grant And Multi-Turn Chain Spec

## 目标

把审批 grant 和多轮威胁状态从多个插件 runtime store 收束到 Go 后端。

## 统一 grant 模型

当前先不区分用户选择的 `allow-once` / `allow-always`。

所有 allow 都解释为：

- `allow-current-chain`

## grant 绑定字段

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

## grant 继续有效条件

必须全部满足：

- 同一 requester。
- 同一 channel / conversation / session。
- 同一 chain。
- 同一 risk family。
- 同一资源范围。
- 没有新增 L4。
- 没有风险升级。
- 没有从读变写、删除、外传。
- 未超时。

## grant 收束条件

- `agent_end`
- `session_end`
- `subagent_ended`
- chain complete
- risk escalation
- target changed
- actor mismatch
- channel mismatch
- deny/cancel
- timeout

## 多轮 chain summary

Go 给判别器返回：

- 最近身份声明。
- 最近敏感请求。
- 最近拒绝记录。
- 最近审批记录。
- 最近工具调用。
- 最近 taint read/write。
- 最近规避词。
- active grant。
- pending approval。

## 插件职责

- 在 `before_dispatch`、`before_tool_call`、`message_sending` 带上 session/channel/requester。
- 审批结果回传 Go。
- 在 session/subagent/agent end 时通知 Go 收束。

## 需要迁移的插件 store

后续逐步停止写入：

- `approval-grant-store.ts`
- `local-tool-approval-store.ts`
- `pending-tool-approval-store.ts`
- `workflow-authorization-store.ts`
- `run-approval-context-store.ts`
- `feishu-local-approval-grant-store.ts`
- `feishu-local-approval-replay-store.ts`
- `feishu-run-continuation-store.ts`

保留短期 bridge：

- 当前 native approval pending map。
- 当前通道投递恢复所需的最小状态。

