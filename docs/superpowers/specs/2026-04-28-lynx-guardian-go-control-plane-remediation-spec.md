# Lynx Guardian Go Control Plane Remediation Spec

日期：2026-04-28

## 1. 背景

当前 Lynx Guardian 已经有本地日志控制台、输入/工具/输出防护、审批、`/lynx-check`、Skill 完整性检查和 Token 统计等能力，但安全判定逻辑仍分散在插件侧多个 runtime store、guard 模块和 hook 分支里。

这会带来四个问题：

1. 插件越来越厚，`index.ts` 和 `src/runtime` 同时承担 hook 编排、状态管理、策略判定和投递恢复。
2. “双线防护”仍处在过渡态，新 evidence/policy 线更多是增强证据包，未成为真正独立并行判别器。
3. 日志语义不清晰，`block:false` 容易被误读成安全，warn、赋分、命中规则、审批状态和最终动作没有统一结构。
4. 多轮对话、审批 grant、`/lynx-check` 任务、Skill 供应链和 Token usage 需要跨 hook、跨通道、跨 session 的长期状态，插件侧 runtime store 很难继续扩展。

## 2. 目标

把 Lynx Guardian 重构为：

- 插件层：OpenClaw hook 接入、上下文提取、本地 L4 快速拒绝、调用 Go、执行裁决、审批桥接和最终消息投递。
- Go 后端：决策控制面、状态控制面、日志控制台、SQLite 持久化、审批 grant、多轮 chain、`/lynx-check` task、Skill inventory 和 Token usage 可信语义。
- 前端 webview：展示决策证据、双判别器结果、审批 grant、chain、task、Skill、Token 和运行时健康状态。

核心目标不是“把所有代码搬到 Go”，而是把复杂策略、长期状态和可解释审计迁到 Go；插件保留必须发生在 hook 现场的强制边界。

## 3. 非目标

本整改不做以下事情：

- 不修改 OpenClaw 源码作为主路径。
- 不把 Go 后端变成直接操作 OpenClaw hook 的组件。
- 不取消插件本地 L4 快速拒绝。
- 不把 `block:false` 改成“安全”的含义。
- 不把 Token 估算伪装成 provider 返回的真实 usage。
- 不把 `/lynx-check` 降级成普通定时任务。
- 不在本轮设计 allow-once / allow-always 的完整产品交互；审批通过先统一解释为 `allow-current-chain`。

## 4. 当前仓库事实锁定

本 spec 基于当前仓库结构：

- 根插件入口是 `index.ts`。
- Go 后端已经存在 `backend/internal/api`、`backend/internal/app`、`backend/internal/config`、`backend/internal/db`、`backend/internal/httpserver`、`backend/internal/ingest`、`backend/internal/middleware`、`backend/internal/openapi`、`backend/internal/repo`、`backend/internal/routes`、`backend/internal/service`。
- SQLite 迁移当前有 `backend/internal/db/migrations/001_init.sql`。
- shared 已有 `shared/src/cursor.ts`、`shared/src/enums.ts`、`shared/src/index.ts`、`shared/src/ingest.ts`、`shared/src/query-dto.ts`。
- 前端已有 `frontend/src/pages/DashboardPage.tsx`、`EventsPage.tsx`、`ToolCallsPage.tsx`、`ApprovalsPage.tsx`、`LynxChecksPage.tsx`、`SessionsPage.tsx`、`TokensPage.tsx`。
- 插件 runtime store 集中在 `src/runtime`，审批、grant、`/lynx-check`、投递恢复、token、policy state 都已有历史文件。
- repo-local 规则要求 `index.ts` 只做 setup 和 hook 编排，复杂 helper 应拆到 `src/`。

## 5. 分层边界

| 层 | 保留职责 | 迁出职责 |
| --- | --- | --- |
| 插件 | hook 注册、上下文提取、本地 L4 fast path、Go 调用、执行 allow/warn/redact/approval/block/deny、通道投递 | 完整赋分模型、语义意图判别、长期 grant store、长期 chain store、`/lynx-check` task owner |
| Go 后端 | 双判别器、仲裁、决策日志、chain、grant、task、Skill inventory、Token usage 语义、查询 API | OpenClaw hook 注册、直接发送飞书/webchat 消息、直接替换模型输出 |
| 前端 | 展示风险、证据、arbiter、score、审批、grant、chain、task、Skill、Token | 直接推断风险、直接读取 SQLite、替代 Go 仲裁 |

## 6. 必须保留在插件侧的 L4 fast path

以下场景必须在插件本地快速拒绝，不等待 Go：

- 禁用 Lynx Guardian 插件。
- 修改 `openclaw.json` 把插件设置为 disabled。
- 删除、移动、篡改插件防护文件或关键黑名单文件。
- 读取私钥、token、`.env`、system prompt、开发者指令、安全规则原文。
- 敏感文件内容加外部发送目标形成外传三角。
- 键盘记录、静默上传、恶意脚本、隐藏执行链。
- 明确要求绕过审批、免确认、跳过授权、混淆检测。
- 明确要求关闭安全限制或忽略所有规则。

Go 可以记录这些事件，但不能成为这些场景是否拒绝的唯一条件。

## 7. 双判别器架构

Go 后端必须实现两个真正独立的判别器：

1. `semantic_intent`
   - 负责意图、语义、上下文和多轮信号。
   - 输入是规范化后的请求、chain summary、channel/requester、最近拒绝/审批/敏感请求。
   - 输出独立的 risk/action/reasons，不读取 evidence scorer 的分数结果。

2. `evidence_score`
   - 负责关键词、规则、taint、chain、内容安全信号、工具属性和资源属性赋分。
   - 输出 score、breakdown、matched rules、risk/action。
   - 不依赖 semantic arbiter 的结论。

仲裁规则：

1. 本地 L4 最高。
2. 两个 Go 判别器取更高 riskLevel。
3. 同级 riskLevel 取更严格 action。
4. active grant 只能把已批准的同链同范围请求降为 allow/warn，不能覆盖新 L4、风险升级、目标变化、actor/channel mismatch。
5. backend degraded 时必须返回可解释 degraded decision，而不是静默放行。

## 8. 统一 DecisionResponse 语义

`block:false` 只表示“当前裁决没有直接阻断”，不表示安全。

颜色、日志级别和前端状态必须从以下字段共同得出：

- `riskLevel`
- `action`
- `audit.eventSeverity`
- `audit.enforcementAction`
- `winningArbiter`
- `requiresApproval`
- `degraded`

示例：

| block | riskLevel | action | eventSeverity | 含义 |
| --- | --- | --- | --- | --- |
| false | L0 | allow | info | 普通放行 |
| false | L2 | warn | warn | 命中风险但未阻断 |
| false | L3 | require_approval | warn | 进入审批，不是安全 |
| true | L4 | deny | critical | 强拒绝 |

## 9. Hook 使用原则

插件 hook 分为四类：

1. 硬性拦截 hook：必须能等待 Go 或本地 L4 直接拒绝。
2. 预取 hook：提前发起 Go 请求，减少后续硬拦截等待时间。
3. sync-only hook：不能返回 Promise，不等待 Go，只读缓存和本地规则。
4. fire-and-forget hook：只做观察、预取、审计，不能作为硬拦截点。

关键安排：

| hook | 角色 | Go 调用方式 |
| --- | --- | --- |
| `message_received` | 输入观察和预取 | fire-and-forget prefetch |
| `before_dispatch` | 输入主拦截 | wait decision |
| `before_agent_start` | 旧版本/兼容兜底 | wait decision |
| `before_prompt_build` | 插入短 promptContext | wait or read cache |
| `llm_input` | 精确 prompt 审计、多轮补全 | fire-and-forget |
| `before_tool_call` | 工具主拦截 | wait decision |
| `after_tool_call` | 工具结果审计、taint、chain 更新 | best-effort update |
| `tool_result_persist` | 工具结果持久化保护 | sync-only |
| `before_message_write` | transcript 写入保护 | sync-only |
| `llm_output` | usage、输出预取 | fire-and-forget |
| `message_sending` | 最终外发 kill switch | wait decision |
| `before_install` | Skill/plugin 安装前扫描 | wait decision |
| `subagent_*` | chain、投递、收束 | 按具体 hook 能力处理 |

## 10. 审批与多轮状态

审批通过统一解释为：

- `allow-current-chain`

grant 继续有效必须同时满足：

- 同 requester。
- 同 channel / conversation / session。
- 同 chain。
- 同 risk family。
- 同资源范围。
- 没有新增 L4。
- 没有风险升级。
- 没有从读变写、删除、外传。
- 未超时。

grant 收束点：

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

Go 要为每次决策提供 chain summary，包括身份声明、敏感请求、拒绝记录、审批记录、工具调用、taint、规避词、active grant 和 pending approval。

## 11. 输出防护

输出防护不是单点拦截，而是多 sink 分层：

| sink | hook | 主策略 |
| --- | --- | --- |
| LLM 原始输出 | `llm_output` | 审计、usage、预取 |
| assistant 持久化 | `before_message_write` | sync-only 本地脱敏 + cached decision |
| 工具结果持久化 | `tool_result_persist` | sync-only 本地密钥/PII/system 原文保护 |
| 最终外发 | `message_sending` | 可等待 Go 的最终 kill switch |

默认行为：

- L0/L1：allow/log。
- L2：warn，不改内容。
- L3 可安全脱敏：局部 redact。
- L3 不可确认：require_approval 或 warn，按 sink 裁决。
- L4 明确泄漏：block/deny，必要时整段替换。

不得整段替换的正常内容：

- 普通业务建议。
- 文件名列表。
- metadata-only 配置摘要。
- 审批状态说明。
- `/lynx-check` 报告。
- 合法安全培训解释。

必须拦截或脱敏：

- PEM 私钥。
- API key / token。
- `.env` 明文。
- 身份证号、住址、银行卡等 PII。
- system prompt / developer instruction / 安全规则原文。
- 工具结果中携带敏感文件全文。

## 12. `/lynx-check` 控制面

Go 后端成为 `/lynx-check` task owner。

统一状态机：

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

Go 负责：

- 创建任务。
- 调度定时任务。
- 采集 facts。
- 保存 evidence bundle。
- 生成 report skeleton。
- 保存投递结果。
- 提供查询 API。

插件负责：

- 识别手动 `/lynx-check`。
- 调用 Go start task。
- 在需要 LLM 报告时触发 OpenClaw/skill。
- 在 `message_sending` 做最终通道格式化并回写投递结果。

`SX-openclaw-discovery`、`SX-security-audit`、`runSecurityAudit()`、`runMaliciousScriptScan()`、`verifyAllInstalledSkills()` 保留为 facts/evidence/report fragment 生产者，不拥有任务状态。

## 13. Skill 供应链与 Token usage

Skill 供应链保护必须纳入迁移边界：

- 插件注册 `before_install`。
- 插件本地 L4 拒绝明显恶意安装。
- 插件调用 Go `/decision/install`。
- Go 记录 install event、hash、baseline、findings、inventory。
- `/lynx-check` 消费 Go 中的 Skill inventory。
- 前端展示 installed skills、hash 状态、findings、install events。

Token usage 语义：

- `actual`：provider/OpenClaw 明确返回的真实 usage。
- `estimated`：插件估算，仅用于趋势和上下文压力。
- `unavailable`：没有真实 usage，也不做估算或估算不可用。

官方成本统计只聚合 `actual`，不能把 `estimated` 混入真实成本。

## 14. 迁移阶段

1. 契约冻结：shared/Go/frontend 统一 DecisionResponse、颜色和日志语义。
2. Go 数据面：新增 decision、arbiter、evidence、chain、grant、task、skill 表。
3. Go 判别器：实现 semantic_intent 和 evidence_score，并持久化两条线结果。
4. 插件 DecisionBroker：可等待 hook 调 Go，sync-only hook 读缓存。
5. 审批与 chain：Go 管 grant，插件只桥接 native/channel approval 结果。
6. 输出防护：减少整段替换，保留 L4 强保护。
7. `/lynx-check`：Go 管 task，插件管 OpenClaw/skill/LLM 报告与投递。
8. Skill/Token/前端：补齐供应链、usage 语义和可解释页面。
9. 旧 store 收束：删除或冻结插件侧重复策略和长期状态。

## 15. 验收标准

必须同时满足：

- 本地 L4 场景不依赖 Go 也能拒绝。
- Go 能返回两条独立 arbiter 结果，并解释 `block:false` 为什么仍然 warn。
- 前端能看到 matched rules、score breakdown、winning arbiter、policy action、enforcement action。
- 审批通过后 grant 只在同 chain、同 actor、同 channel、同范围、无升级时继续有效。
- `before_message_write` 和 `tool_result_persist` 不等待 Go。
- 输出正常业务内容不被整段替换。
- `/lynx-check` 手动和定时进入同一 task 表。
- Skill inventory 可查询，Skill install 可在安装前判定。
- Token actual/estimated/unavailable 分离展示。
- `index.ts` 明显回到 hook 编排角色。
- 完成模块后通过真实 OpenClaw runtime 路径验证，而不是只通过本地单测宣称完成。
