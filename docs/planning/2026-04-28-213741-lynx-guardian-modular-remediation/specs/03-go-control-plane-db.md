# 03. Go Control Plane And Database Spec

## 目标

把 Go 后端从日志查询服务扩展成决策控制面，承担裁决、状态、任务、Skill inventory 和可解释日志。

## 当前基础

已有目录：

- `backend/internal/app`
- `backend/internal/routes`
- `backend/internal/repo`
- `backend/internal/ingest`
- `backend/internal/db`
- `backend/internal/api`
- `backend/internal/openapi`

已有表：

- `sessions`
- `audit_events`
- `tool_calls`
- `approvals`
- `lynx_checks`
- `token_usage`
- `ingest_cursors`
- `schema_migrations`

## 新增目录建议

- `backend/internal/decision`
- `backend/internal/chain`
- `backend/internal/grants`
- `backend/internal/tasks`
- `backend/internal/skills`

## 新增数据库表

新增 migration，例如：

- `backend/internal/db/migrations/002_control_plane.sql`

表：

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

## 新增内部路由

- `POST /lynx/internal/v1/decision/input`
- `POST /lynx/internal/v1/decision/tool`
- `POST /lynx/internal/v1/decision/output`
- `POST /lynx/internal/v1/decision/install`
- `POST /lynx/internal/v1/chains/update`
- `POST /lynx/internal/v1/approvals/request`
- `POST /lynx/internal/v1/approvals/:approvalId/resolve`
- `POST /lynx/internal/v1/grants/check`
- `POST /lynx/internal/v1/grants/revoke`
- `POST /lynx/internal/v1/tasks/lynx-check/start`
- `POST /lynx/internal/v1/skills/inventory/sync`

## 新增外部查询路由

- `GET /lynx/decisions`
- `GET /lynx/decisions/:decisionId`
- `GET /lynx/chains`
- `GET /lynx/chains/:chainId`
- `GET /lynx/grants`
- `GET /lynx/skills`
- `GET /lynx/skills/:skillId`

## 服务职责

### decision

- 规范化 request。
- 调用 semantic arbiter。
- 调用 evidence arbiter。
- 仲裁最终 decision。
- 写入 decisions / arbiters / evidence / audit_events。

### chain

- 维护 `chain_id`。
- 接收 hook 事件推进 chain。
- 返回 chain summary 给判别器。

### grants

- 创建、检查、撤销 `allow-current-chain`。
- 处理风险升级和资源变化。

### tasks

- 管理 `/lynx-check` 状态机。
- 记录 facts、evidence、report skeleton、delivery。

### skills

- 同步已安装 Skill。
- 保存 hash、baseline、findings。
- 支持 before_install install-scan。

## 测试要求

- `go test ./...`
- migration 测试：空库执行 001 + 002。
- decision route 测试：block false + warn case、L4 deny case。
- grant route 测试：同链命中、风险升级失效。
- skill route 测试：inventory sync、hash mismatch。

