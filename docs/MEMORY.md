# Project Memory

本文件是 `openclaw-lynx-guardian` 项目的共享记忆，供该项目下不同线程共通复用。

## openclaw-lynx-guardian

- 2026-04-08：当前拦截链路建议按“本地直拦 / 评分拦截 / 后端二次裁决 / 仅提示”四类理解；判断现状时以当前代码和 `docs/改动.md` 为准，不只看旧设计文档标题。

| 分类 | 入口 hook | 当前链路 | 默认结果 |
| --- | --- | --- | --- |
| 本地直拦 | `message_received` | `SensitiveDataBlocker.containsSensitiveData`：敏感词、高置信 key、私钥头、高熵长串 | 直接 `block: true` |
| 本地直拦 | `message_received` / `before_agent_start` | `guardInput()` 即时危险通道：高置信 / 间接 `M1`、`M2:system_prompt_extraction`、主凭证 `M5`、大多数 `M6` | 直接 L4 deny，不走后端 |
| 本地直拦 | `before_tool_call` | `guardToolCall()` 即时危险通道：主凭证 `M5`、工具侧 `M3`、`fatal_triangle` 三角全命中 | 直接 L4 deny |
| 本地直拦 | `before_tool_call` | Skill Guard 恶意安装：恶意 skill 名称 / 内容 / 远程黑名单命中 | 直接拦截 |
| 评分拦截 | `message_received` / `before_agent_start` | `guardInput()` 评分通道：`M0`、低置信 `M1`、`M2:protected_file_access`、`M3`、非主凭证 `M5`、合法研究场景 `M6`、`M7` 弱信号、会话异常累积 | `L3/L4` 拦截；`L1/L2` 仅警告 |
| 评分拦截 | `before_tool_call` | `guardToolCall()` 评分通道：`M2:protected_file_access`、非主凭证 `M5`、`fatal_triangle` 两角、`M7` 弱信号、会话异常累积 | `L3/L4` 拦截；可放行只限 `M0/M2/M3` |
| 评分拦截 | `agent_end` | `guardOutput()`：系统提示泄露、输出中真实密钥、链式注入输出、高危操作建议 | best-effort 替换输出 / 脱敏 |
| 后端二次裁决 | `before_tool_call` | 本地 `checkExecBlacklist/checkPathBlacklist` 命中后，再调 `checkTool()`；本地命中设置风险下限：critical=3、warning=2 | critical 硬拦；warning 需确认；API 挂时 critical fail-closed / warning fail-open |
| 仅提示 | `before_agent_start` | `guardInput()` 的 `L1/L2` warning + `buildSecurityAwarenessInjection()` 预警注入 | 不拦截，给模型加安全上下文 |
| 仅提示 | `before_agent_start` | `checkContent(type=1)` 当前后端只回 `0/1`，所以实际只把 warning 追加到 `prependContext` | 当前不形成真实拦截 |
| 仅提示 | `agent_end` | `checkContent(type=2)` 输出侧后端内容检查 | 仅日志 / 警告，不阻断 |
| 仅提示 | `before_tool_call` | Skill Guard `warning` 级命中 | 记录 warning，不阻断 |

- 重要例外：一次确认不是“只放这一次”，而是开启默认 180s 的 workflow auth window；当前实现 `scopeAll=true`，窗口内后续被拦操作会自动放行并记审计。
- 不计入上表：`/lynx-check` / `openclaw-check` 和确认口令属于控制流 / 授权流，不属于安全拦截分类本体。
- 主要依据：`docs/拦截流程全链路-2026-04-07.md`、`docs/拦截策略全局分析-2026-04-07.md`、`docs/拦截操作实例汇总-2026-04-07.md`、`docs/改动.md`、`index.ts`、`src/guard/safety-guard.ts`。

## Recent Updates

- 2026-04-12：新增 `docs/superpowers/2026-04-12-lynx-check-delivery-learnings.md`，沉淀 `/lynx-check` 的 Docker 优先排障、hook ctx 与 runtime 差异、Feishu / WebChat 投递分流、`chat.inject` 依据，以供 future skill 候选；注意当前已证明双通道可行，但最新一次运行仍暴露 `heartbeat` 路由恢复边界。
