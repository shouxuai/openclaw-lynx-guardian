# Findings

## Current Code Shape

- Go 后端已经存在 `backend/internal/api/app/config/db/httpserver/ingest/middleware/openapi/repo/routes/service`。
- 插件运行时状态文件集中在 `src/runtime`，审批、grant、/lynx-check、投递、上下文恢复都较分散。
- 前端已有 Dashboard / Events / Tool Calls / Approvals / Lynx Checks / Sessions / Tokens 等页面基础。
- shared 已有 `cursor / enums / ingest / query-dto`，适合新增 `decision.ts`。

## Planning Decisions

- 先做 decision contract 和日志语义，再做 Go API，再接插件 DecisionBroker。
- sync-only hook 不能等待 Go，只能使用本地规则和缓存裁决。
- fire-and-forget hook 只能观察、预取、审计，不能硬拦截。
- `/lynx-check` 迁移为 Go task plane，但仍允许 LLM/skill 生成审计报告正文。
- Skill 供应链需要 `before_install`，不能只靠工具命令猜测和 `/lynx-check` 扫描。

