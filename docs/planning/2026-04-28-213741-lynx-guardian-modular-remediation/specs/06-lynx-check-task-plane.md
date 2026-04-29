# 06. Lynx Check Task Plane Spec

## 目标

让 Go 后端成为 `/lynx-check` 任务控制面，插件不再用大量 runtime store 管理任务状态。

## 手动与定时统一

统一进入 `lynx_check_tasks`。

字段：

- `request_id`
- `trigger`: `manual | scheduled | api | startup`
- `source`
- `requested_by`
- `session_key`
- `channel_profile`
- `target_key`
- `status`
- `created_at`
- `started_at`
- `completed_at`
- `error_message`

## 状态机

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

## Go 负责

- 创建任务。
- 调度定时任务。
- 采集 facts。
- 保存 evidence bundle。
- 生成 report skeleton。
- 保存投递结果。
- 提供查询 API。

## 插件负责

- 识别 `/lynx-check` 手动触发。
- 调用 Go start task。
- 如果需要 LLM 报告，触发 OpenClaw/skill。
- 在 `message_sending` 做最终通道格式化和投递记录。

## Skill / LLM 角色

保留：

- `SX-openclaw-discovery`
- `SX-security-audit`
- `runSecurityAudit()`
- `runMaliciousScriptScan()`
- `verifyAllInstalledSkills()`

但它们不拥有任务状态，只产出 facts/evidence/report fragment。

## 旧 store 收束

逐步替代：

- `lynx-check-run-store.ts`
- `managed-lynx-check-authorization-store.ts`
- `scheduled-lynx-check.ts`
- `recent-active-delivery.ts` 的任务状态部分

保留：

- 通道投递 helper。
- report shaping helper。
- runtime target recovery 的最小 bridge。

