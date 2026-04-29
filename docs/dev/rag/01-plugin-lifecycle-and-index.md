# 插件生命周期与 `index.ts` 总调度

## 1. `index.ts` 的真实职责

`index.ts` 不是单纯的入口文件，而是整个插件的“总编排层”。它做了 5 类事情：

1. 解析配置与初始化运行环境
2. 注册全部 OpenClaw hook
3. 在 hook 之间传递 `/lynx-check`、delivery、override 等运行时状态
4. 拼装安全策略和提示上下文
5. 做大量跨模块兜底逻辑

因此它既是“应用入口”，也是“协调器”和“补丁层”。目前文件过长，已经形成事实上的单体 orchestrator。

## 2. 顶层辅助函数

这些函数都定义在 `index.ts` 顶部，主要解决“事件到运行态”之间的桥接问题：

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `isConfirmationPhrase(text, phrase)` | 判断用户是否输入确认短语 | 仅做 `includes`，逻辑非常轻 |
| `resolveAgentStartPromptText(event)` | 从 `before_agent_start` 事件中提取主 prompt | 优先 `event.prompt`，再从 `messages` 中找最近 user message |
| `stripBracketPrefixedEnvelope(text)` | 去掉带括号前缀的包装文本 | 解决消息前缀干扰 trigger 分类 |
| `extractAgentStartPrimaryMessageText(event)` | 提取 agent_start 主消息文本 | 从消息数组逆序找 user message |
| `resolveManagedLynxCheckCommandText(event)` | 识别 agent_start 是否其实在触发 `/lynx-check` | 对 prompt 和消息逐行跑 `classifyLynxCheckTrigger()` |
| `appendLifecycleProbe(hookName, payload, ctx)` | 追加生命周期探针日志 | 统一写入 `hook-probe.log` |
| `sendHookFeedback(ctx, content)` | 在 hook 内向用户反馈即时消息 | 包装 `ctx.sendMessage`，避免每处重复 try/catch |
| `sendAssistantMessageWithRetry(options)` | 对报告回传做重试和日志封装 | 内部调用 `deliverLynxReport()`，外层只关心 tag、attempts、payload |
| `resolveManagedLynxCheckSource(ctx)` | 区分手动和定时 `/lynx-check` | 根据 `trigger`、`sessionKey`、`subsystem` 判断 |
| `resolveManagedLynxCheckRouteHint(ctx, source)` | 给 `/lynx-check` 选择投递目标 | 手动优先当前会话，定时优先最近活跃目标 |
| `resolveManagedLynxCheckPromptChannel(ctx, routeHint)` | 识别回传目标是 webchat / feishu / generic | 从上下文与 route hint 的 provider/channel 综合判断 |
| `resolveActiveManagedLynxCheckState(ctx)` | 读取当前会话是否有运行中的 `/lynx-check` | 从 run store 找最新 pending/running intent |
| `buildManagedGuardContext(event, ctx)` | 构造带 managed `/lynx-check` 状态的 guard context | 在普通 guard context 上额外挂入 `managedLynxCheckRun` 等标志 |

## 3. 启动期初始化

`setup(api)` 的初始化顺序：

1. 读取配置
   解析 `selfSafetyGuard`、`securityAudit`、`skillGuard`、`tokenOptimizer`、`scheduledLynxCheck` 等。
2. 初始化 `/lynx-check` 预授权
   如果配置允许，启动时直接 `grantManagedLynxCheckAuthorization()`。
3. 探测 hook 能力
   `getHookCapabilityReport(getOpenClawRuntimeVersion())` 用于判断当前 OpenClaw 版本是否支持输出拦截相关 hook。
4. 初始化本地身份和资源
   `ensureUserRegistered()` 读取或生成用户 ID，再调用 `registerUser()`；`ensureResources()` 同步插件自带资源到 `~/.openclaw`。
5. 启动后台异步任务
   `reconcileScheduledLynxCheck()`、`runSecurityAudit()`、`runMaliciousScriptScan()`、`verifyAllInstalledSkills()`、`checkBudget()`、`planHeartbeat()`。

这一段的实现思路是“启动不阻塞主流程，但要尽快把后台能力拉起来”，所以大量逻辑采用 fire-and-forget 异步 IIFE。

## 4. hook 级别职责拆解

### 4.1 `gateway_start`

职责很纯：

- 再次调用 `ensureResources()`
- 调用 `reconcileScheduledLynxCheck()`

实现思路是“网关重启后重新对齐资源和 cron 状态”，因此这里本质是运维同步 hook。

### 4.2 `message_received`

这是“最早的文本接入点”，做的事很多：

1. `rememberRecentActiveDeliveryTarget(ctx, { allowRouteOnly: true })`
   记录最近可投递目标，为后续 `/lynx-check` 回传做准备。
2. 解析文本
   把 string 或 block content 统一拼成文本。
3. 处理确认短语
   如果命中 `riskPolicy.confirmationPhrase`，就从 pending override store 取出待确认项，并开启 workflow auth 时间窗。
4. 识别 `/lynx-check` 与 discovery 触发
   `classifyLynxCheckTrigger(text)` 负责判定是 native passthrough、手动 `/lynx-check`、还是自然语言 discovery 请求。
5. 敏感数据快筛
   `SensitiveDataBlocker.containsSensitiveData(text)` 是最早、最便宜的一层拦截。
6. 输入风控
   `guardInput()` 检查注入、系统提示提取、身份伪装、越权等风险，并在可放行场景下写入 pending override。

这个 hook 的实现思路是：只做“早识别”和“早拦截”，尽量不在此处生成复杂报告。

### 4.3 `before_agent_start`

这是最关键的 hook，负责把“真正要给模型的上下文”构造出来。

主要流程：

1. 记录当前可投递目标
   `rememberRecentActiveDeliveryTarget(ctx)`
2. 做公网暴露检查
   `baseIpInfo()` + `checkPublicAccess()`
3. 识别是否进入 managed `/lynx-check`
   `resolveManagedLynxCheckCommandText()` + `isManualCompositeLynxCheckRequest()`
4. 为 `/lynx-check` 创建 run intent
   `createLynxCheckRunIntent()`
5. 预计算完整审计报告
   `buildManualLynxCheckReport()`，并写入 `.report.md`
6. 写入 run store 运行状态
   `updateLynxCheckRunIntentStatus()` + `writeLynxCheckRunResult()`
7. 构造 prompt 注入
   `buildManualLynxCheckPrompt()` 或 `buildScheduledLynxCheckPrompt()`
8. 跑输入 guard 和 API 风控
   `guardInput()` + `checkContent(userId, input, 1)`
9. 注入 token optimizer 建议
   `recommendContext()`、`routeModel()`、`checkBudget()`、`buildOptimizationHints()`

这一段的实现思路是“在模型开始之前，把 deterministic 的准备工作都做完”。这也是当前 `/lynx-check` 能稳定输出完整报告的核心原因。

### 4.4 `agent_end`

这是最大的“收尾与兜底” hook。

它负责：

1. 回收 workflow auth
   `revokeWorkflowAuth()`，并把已放行操作摘要发回用户。
2. 处理 `/lynx-check` 结果
   先从 run store 读 intent/result，必要时 `waitForLynxCheckRunResultSettled()` 等待短时间收敛。
3. 判断 inline 是否已经成功
   如果最后一条消息已经是可信 managed report，就直接把 run result 标为 completed。
4. 对 scheduled `/lynx-check` 做额外 fanout
   即使 cron 回合已内联输出，也会尝试 fanout 到最近活跃会话。
5. 兜底 fallback-send
   如果 inline 不存在或失败，则读取 `.report.md` 重新发送。
6. 发送旧版 discovery pending 报告
   读取 `DISCOVERY_RESULT_PATH`，通过 `deliverLynxReport()` 尝试回传。
7. 做输出侧安全检查
   `guardOutput()` + `redactAgentOutput()`
8. 做输出 API 风控
   `checkContent(userId, output, 2)`

这一段的实现思路是：先保证 `/lynx-check` 结果闭环，再处理通用输出安全问题。

### 4.5 `before_message_write`

职责有两个：

1. `decorateAssistantMessage()`
   做最终消息修饰和 discovery 附加。
2. `guardAssistantPersistence()`
   在 assistant 消息落盘前，防止泄露内容被持久化。

如果当前是 Feishu 且消息是可信 `/lynx-check` 报告，还会先 `shapeMessageForProvider()` 做 Feishu 文本整形。

### 4.6 `tool_result_persist`

只做一件事：`guardToolResultPersistence(event.toolName, event.message, guardContext)`。

目的不是阻断工具运行，而是避免高危工具结果原样落盘。

### 4.7 `message_sending`

发送前的最后一道出口：

- 如果是 Feishu，先 `shapeTextForProvider()`
- 再 `guardOutput()`，必要时 cancel 发送

也就是说，`before_message_write` 控制“存什么”，`message_sending` 控制“发什么”。

### 4.8 `before_tool_call`

这是最复杂的工具防线入口，顺序大致如下：

1. 生成 `toolFingerprint`
   作为一次性 override 的唯一标识。
2. 跑 `guardToolCall()`
   处理系统文件访问、凭据窃取、越权操作、managed `/lynx-check` 白名单等。
3. 处理 workflow auth 复用
   如果当前已在授权窗口内，记录 audit log 而不重复阻断。
4. 检测 Skill 安装
   `detectSkillInstall()` + `quickBlacklistCheck()` + `assessSkillRisk()`
5. 命令/路径黑名单
   `checkExecBlacklist()` / `checkPathBlacklist()`
6. 远端工具风控
   `checkTool()` 给本地命中的风险再加一层远端判定。
7. 需要确认时写入 pending override
   后续由 `message_received` 的确认短语触发授权窗口。

这一段相当于把“结构化规则、行为分析、远端策略”三层治理都叠到了工具调用前。

### 4.9 其他 hook

| hook | 作用 |
| --- | --- |
| `after_tool_call` | 记录生命周期探针 |
| `session_start` | 记录 route-only 最近活跃目标 |
| `session_end` | 清理当前上下文的最近活跃目标 |

## 5. `index.ts` 的设计优点

- hook 之间的状态接力很完整，尤其是 `/lynx-check` 的 run intent -> report -> delivery 闭环。
- 很多兜底逻辑都集中在一处，排障时入口清晰。
- 安全策略可以在一个文件里看完整执行顺序。

## 6. `index.ts` 的主要问题

1. 过度集中
   初始化、hook 逻辑、投递、授权、日志、回退全混在一起。
2. hook 之间存在隐式耦合
   例如 `message_received` 写 pending override，`before_tool_call` 消费授权，`agent_end` 再回收 workflow auth。
3. `/lynx-check` 与通用消息安全逻辑高度交织
   让正常消息链路也携带了大量特例判断。
4. 本地状态文件路径散落
   `DISCOVERY_RESULT_PATH`、run store 路径、recent-active 路径都在不同模块管理。

## 7. 推荐拆分方向

最值得优先拆出去的不是底层工具，而是 hook handler：

1. `hooks/message-received.ts`
2. `hooks/before-agent-start.ts`
3. `hooks/agent-end.ts`
4. `hooks/before-tool-call.ts`

`index.ts` 最理想的形态应该只保留：

- 配置解析
- 共享 helper 初始化
- hook 注册

其他逻辑交由独立 handler 模块处理。
