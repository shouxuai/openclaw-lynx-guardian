# Lynx Guardian Modular Remediation Docs

日期：2026-04-28

本目录把上一份总 spec 拆成正式可执行的模块化整改规格与总实施计划。

## 文档索引

- `implementation-plan.md`：总执行计划，按模块排序，说明每个阶段要改哪些文件、怎么验证。
- `specs/00-execution-boundaries.md`：总体边界、迁移原则、模块依赖。
- `specs/01-decision-contracts.md`：Go 决策接口、双判别器返回值、日志颜色与 `block:false` 语义。
- `specs/02-plugin-hook-decision-broker.md`：插件 hook 策略、DecisionBroker、sync-only / fire-and-forget 处理。
- `specs/03-go-control-plane-db.md`：Go 控制面、数据库扩展、repository/service/routing 组织。
- `specs/04-approval-chain-state.md`：审批、`allow-current-chain` grant、多轮 chain 与状态收束。
- `specs/05-output-guard.md`：输出四层防护、按 sink 分类、过度替换修正。
- `specs/06-lynx-check-task-plane.md`：`/lynx-check` 任务控制面、手动/定时统一状态机、LLM/skill 报告生成。
- `specs/07-skill-token-frontend.md`：Skill 供应链、Token usage、前端可观测页面。
- `task_plan.md`：本次文档整理任务记录。
- `findings.md`：整理过程中确认的事实。
- `progress.md`：本次文档生成进度。

## 执行原则

1. 先做契约和数据面，再接插件 hook。
2. 插件保留本地 L4 快速拒绝，复杂判别迁入 Go。
3. `before_message_write` 和 `tool_result_persist` 是 sync-only，只读缓存和本地规则。
4. `llm_input` / `llm_output` 这类 fire-and-forget hook 只做观察、预取和审计，不能做硬拦截。
5. 每个模块完成后都要有 focused tests，最后再做 OpenClaw runtime sync 和真实路径验证。

