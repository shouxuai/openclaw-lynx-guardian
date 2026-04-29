# Findings

## Repo Context

- 当前仓库已有本地日志控制台设计文档，原始方向是插件 hook 采集、本地 backend 落 SQLite、frontend 查询展示。
- 当前 Go 后端已经实现日志控制台部分 API，但还不是裁决控制面。
- 当前插件已注册的 hook 子集不足以覆盖后续所有迁移目标，可以按 OpenClaw 已支持 hook 增补。
- 当前仓库 `.gitignore` 忽略 `/docs` 和 `/.workplace/`，本轮 spec 是本地工作文档；如果需要纳入版本库，后续要显式 force-add 或调整 ignore 规则。

## Hook Evidence

- OpenClaw hook 类型中存在 `before_prompt_build`、`llm_input`、`llm_output`、`before_agent_reply`、`reply_dispatch`、`before_install`、`subagent_*`。
- `tool_result_persist` 与 `before_message_write` 是 sync-only，不适合等待 Go 后端。
- `llm_input` 与 `llm_output` 是 fire-and-forget，适合观察和预取，不适合硬拦截。

## Design Findings

- `block:false` 不能作为安全颜色和风险结论的唯一来源。
- 双线并行必须在 Go 中变成真正独立的语义判别器和赋分判别器。
- 输出防护需要按 sink 分类，不能继续默认整段替换。
- 审批 grant 应收敛为 `allow-current-chain`。
- `/lynx-check` 应由 Go 成为任务控制面，但报告正文仍可调用 OpenClaw/LLM/skill。
- Skill 供应链保护需要新增 `before_install` 和前端 inventory 页面。
- Token 统计必须区分 actual、estimated、unavailable。
