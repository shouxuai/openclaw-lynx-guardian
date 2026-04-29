# 2026-04-12 `/lynx-check` 调试复盘与 OpenClaw 运行时知识总结

## 目的

这份文档只沉淀两类内容：

1. 已经被真实 Docker 运行结果证明过的事实。
2. 已经从 OpenClaw 源码直接读到、可以支撑后续设计判断的事实。

目标不是复述一次修 bug 过程，而是给下一轮 `/lynx-check`、审计报告、定时任务和 skill 设计提供可靠底座，避免再次掉进“看起来像权限问题，其实是运行时路由和上下文能力不一致”的坑。

---

## 一句话结论

这次 `/lynx-check` 的核心问题并不是“审计报告没有生成”，也不只是“最新消息通道判断错了”，而是：

- 手动与定时链路拿到的 hook 上下文能力并不等价。
- Feishu 可以继续走已有的 inline/outbound 投递。
- WebChat 不能假设普通 `ctx.sendMessage` 或 `ctx.resolveMessageTarget` 在定时 `agent_end` 里总是可用。
- 对 WebChat 来说，已经生成好的审计报告更适合走 `chat.inject` 这类网关侧注入能力，而不是重新调度模型或复活 orchestrator。

---

## 已验证的最终状态

### 1. 真实成功案例已经存在

在宿主侧最新产物中，`requestId = lynx-check-1775985818246-szg2sw` 的结果为：

- `status = completed`
- `sendSucceeded = true`
- `transport = inline-message,gateway-chat.inject`
- Feishu 投递成功，`transport = inline-message`
- WebChat 投递成功，`transport = gateway-chat.inject`

这说明“同一份预计算审计报告同时发飞书和 WebChat”不是理论推演，而是真实跑通过的链路。

### 2. 最近多次 cron 运行大多已经具备双通道能力

最近几次产物里，多数运行都能看到：

- `inline-message,gateway-chat.inject`
- 或者至少 `gateway-chat.inject`

这表明新的 fanout 设计不是一次性的偶然成功。

### 3. 但它还没有完全收敛为 100% 稳定

最新一条结果 `lynx-check-1775991000454-vnnamy` 依然出现：

- Feishu 成功
- WebChat 目标存在，但 `transport = none`
- `messageProvider = heartbeat`
- `errorMessage = No delivery transport resolved for target`

这说明当前实现已经证明“WebChat 可送达”，但仍有一个剩余边界条件：

- 当最近活跃路由或 session store 恢复出来的是 `heartbeat` 风格上下文，而不是可直接投递的 WebChat 路由时，WebChat fanout 仍可能退化成仅 Feishu 成功。

后续如果继续打磨，不应该假设问题已经彻底归零，而应该把它视为“主问题已解，仍有一个路由恢复边界待收口”。

---

## 这次真正坏掉的是什么

### 1. 不是审计报告生成失败

本次 `/lynx-check` 的大部分问题都不是报告生成本身失败，而是：

- 报告已经生成
- 运行结果也已经写入
- 但是最后一跳的用户可见投递并不稳定

因此，排障时必须先看 `*.result.json` 和匹配的 `*.report.md`，再看 CLI 上那句超时或阻塞提示。

### 2. 不是“判断最新通道”这一个问题

“发给最新消息通道”这个说法太粗了。真实问题拆开看至少有三层：

- 当前 hook 上下文里有没有可直接发消息的能力
- 记住的 recent-active route 是否还是可投递 route，而不是仅供追踪的 route hint
- 当前渠道是否允许用通用 `send` 语义完成投递

Feishu 与 WebChat 在这三层上的行为并不对称。

### 3. 不是恢复 orchestrator 就能彻底解决

`lynx-guardian-check-orchestrator` 曾经承担过“调度审计 + 调度发现 + 拼装报告”的职责，但这次问题的根因并不在于“有没有 orchestrator”。

真正的问题在：

- 审计报告何时预计算
- 哪个 hook 是 awaited 的
- 哪个上下文拥有可靠的投递能力
- 哪条发送链路适合哪个消息面

因此本轮结论是：

- 不要复活 orchestrator 作为核心解法
- 更应该把 `/lynx-check` 视为一个受信任、可预计算、按渠道 fanout 的内部工作流

---

## 真实 Docker 排障方法论

这次最有价值的经验之一，不是某个 TypeScript 细节，而是排障顺序。

### 1. Docker 结果优先于 Windows 主机直觉

这个插件最终跑在 Docker 里的 OpenClaw 网关环境中，所以以下事实必须长期记住：

- Windows 主机上“能读到文件”不代表容器里同样能读到
- 本地 `npm test` 通过不代表容器运行时真的按预期工作
- 只有容器重启、同步脚本跑完、网关日志稳定后，行为变化才算真实生效

### 2. 产物优先于 CLI 即时文案

调 `/lynx-check` 时，应该优先信下面三类东西：

1. 最新 `*.result.json`
2. 匹配的 `*.report.md`
3. 最新 session `*.jsonl`

原因很简单：

- `/lynx-check` 是异步链路
- CLI 的超时、阻塞、配对提示经常只代表“这一跳没看到最终回显”
- 但并不等价于“整次运行失败”

### 3. 源码分析必须放在产物诊断之后

正确顺序应该是：

1. 看容器日志
2. 找 `requestId`
3. 看 result/report/session 产物
4. 再带着具体症状回源码定位

如果顺序反过来，很容易在“猜权限”、“猜 hook 没跑”、“猜 orchestrator 卡死”里浪费很多时间。

### 4. 插件改完后必须先做 dev sync

本项目里，修改插件后不经过同步脚本直接下结论，风险极高。当前可靠流程仍然是：

- `node scripts-dev/verify-dev-sync.mjs`
- `.\scripts-dev\sync-openclaw-dev.ps1 --logs 200`
- 或者直接 `.\scripts-dev\sync-openclaw-dev-ready.ps1 --logs 200`

尤其是这个 ready 包装脚本已经把 cron store 的 Docker-state 同步补偿也做进去了，实际价值非常高。

---

## 从 OpenClaw 源码读到的关键事实

下面这些点不是“猜测”，而是已经从 OpenClaw 源码读到并用于这次设计判断的事实。

### 1. hook `ctx` 不是完整运行时

从 OpenClaw 插件 runtime 类型可以看出，插件拿到的能力分成两层：

- 一层是 hook 的 `EventContext`
- 一层是更完整的 `PluginRuntime`

而我们在 hook 里实际拿到的 `ctx`，只暴露了很薄的一层能力，例如：

- `sendMessage`
- `resolveMessageTarget`
- 少量 route 相关字段

这也是为什么“在某个 hook 里看起来能发消息”的经验，不能直接外推到所有 hook。

### 2. `before_agent_start` / `before_tool_call` 是 awaited，其他很多 hook 不是

这次已经再次验证：

- 关键预计算必须放在 awaited hook
- 手动 `/lynx-check` 能稳定产出完整报告，根本原因之一就是把确定性的重活前移到了 `before_agent_start`
- 不能把关键成功条件寄托在 fire-and-forget hook 恰好及时跑完

这条结论对未来所有“先算完再让模型写”的方案都非常重要。

### 3. WebChat 不是普通“任意 send 都可达”的通道

从 `src/gateway/server-methods/chat.ts` 可见，OpenClaw 的聊天路由恢复本身就有一套严格规则。尤其是：

- session route 的可继承性带有明显约束
- WebChat 不应该被当成“和别的渠道一样，恢复到 target 后随便发”来理解
- 一部分上下文只适合还原为 route hint，不足以直接变成成功的外发 transport

这解释了为什么某些定时 `agent_end` 上下文里：

- `ctx.resolveMessageTarget` 看起来存在
- 但最终仍然拿不到一个真正可发到 WebChat 的 transport

### 4. `chat.inject` 是网关侧的管理能力，不是野路子

从 `src/gateway/server-methods/chat.ts` 和 `src/gateway/method-scopes.ts` 可以确认：

- `chat.inject` 是一个正式存在的网关方法
- 它受 `ADMIN_SCOPE` 管控

这意味着对已经生成好的审计报告来说，`chat.inject` 并不是 hack，而是一个有明确定位的“把消息注入会话/转录/UI”的正式能力。

对本次场景来说，它非常适合用来补足 WebChat 的 transcript/UI 可见性。

### 5. OpenClaw 的公开类型导出不一定覆盖全部实际运行能力

这次还踩到一个很典型的坑：

- runtime 里实际可用的能力，不一定完整反映在插件侧的公开导出或声明文件里
- `dist/plugin-sdk/plugins/types.d.ts` 里并没有直接给出这次最终用到的 CLI 网关调用入口
- 但真实运行时和构建产物中，相关能力是存在的

因此，未来遇到“类型里没写，但运行时确实有”的情况时：

- 不能只看导出声明就下结论
- 需要同时看 runtime 源码、构建产物和真实容器行为

### 6. 运行时模块解析必须按宿主 app 视角做，而不是按扩展本地路径做

这次已经实证过：

- 直接从扩展本地上下文解析 `openclaw/plugin-sdk`，在容器里可能失败
- 更稳的方式是从 `process.cwd()` 对齐到宿主 app 根，再去解析真实 runtime helper

这是典型的“插件代码运行在宿主进程里，但仓库结构和模块解析视角并不天然一致”的问题。

---

## 对 Lynx Guardian 架构的直接结论

### 1. `/lynx-check` 应该继续走“预计算报告 + 最终投递 fanout”

比起让模型临时决定调谁、去哪发、如何拼装，当前更靠谱的方向已经很明确：

- 确定性审计先由插件本身预计算
- prompt 的职责是“学习并自然表达报告”
- 投递层再按渠道能力分别处理

这样更稳定，也更容易验证。

### 2. 不要在第一条成功后提前返回

用户已经明确要求：

- 飞书和 WebChat 可以同时发
- 不要因为先有一个成功就提前结束

这次实现和验证也说明，这个要求是合理的。因为：

- Feishu 成功不代表 WebChat 一定成功
- WebChat 成功也不代表 Feishu 一定完成
- fanout 需要逐个目标执行，并把每次结果写回 run store

### 3. Feishu 与 WebChat 应分别利用各自特性

这个结论已经非常清楚：

- Feishu 更适合首屏突出“总体评级 / 最高优先级风险 / 立即整改动作”
- WebChat 更适合保留更完整的 Markdown 连续阅读体验

它们不应该被一个完全相同的模板强行覆盖。

### 4. `/lynx-check` 的自检放行要保持窄白名单，而不是全局放开

经验上看，“让 `/lynx-check` 不再被自己拦”是对的，但实现方式必须克制：

- 只放行 `/lynx-check` 必需的读路径、状态读取和安全审计命令
- 不要把这种放行膨胀成对任意敏感读写或任意 exec 的全局通行证

否则下一次会把真正危险的自检误伤混在一起，很难收口。

### 5. `lynx-guardian-check-orchestrator` 不应再是后续方案的依赖中心

基于这轮结果，更合理的定位是：

- 它不是当前问题的根因修复点
- 它也不应该再成为手动/定时 `/lynx-check` 的主干依赖

如果未来保留，也更适合作为历史兼容或过渡层，而不是新的设计中心。

---

## 这次代码改动实际落点

本轮与消息投递直接相关的主要落点集中在：

- `src/runtime/lynx-message-delivery.ts`
- `src/runtime/lynx-webchat-delivery.ts`
- `test/plugin.test.ts`

对应的设计意图分别是：

- `lynx-message-delivery.ts`
  - 从“单目标/碰运气”投递升级为真正的 fanout
  - 允许 Feishu 与 WebChat 同时尝试
  - 把每次 delivery attempt 记回运行结果
- `lynx-webchat-delivery.ts`
  - 专门承接 WebChat 的网关注入能力
  - 提供独立测试 seam，避免测试强耦合真实网关导出
- `plugin.test.ts`
  - 把“不能提前返回”“WebChat 需要独立 fallback”“orchestrator 已移除”这些关键行为锁进回归测试

---

## 仍然存在的噪音与边界条件

### 1. `duplicate plugin id detected` 在当前 dev 布局里通常只是噪音

当前仓库和容器的 staging 方式决定了：

- `%USERPROFILE%\\.openclaw\\extensions\\...`
- `/app/extensions/...`

可能同时存在同一个插件 ID。

只要真实运行结果正常，这条日志不应该被误判为 `/lynx-check` 故障根因。

### 2. `/home/node/.openclaw` 权限问题仍然会影响同步判断

这类问题通常表现为：

- `EPERM ... copyfile ... /home/node/.openclaw/skills/...`
- 技能文件或扩展文件看起来“本地改了，但容器没生效”

后续如果再遇到，应优先：

- 验证 `/app/extensions/openclaw-lynx-guardian`
- 必要时直接在容器里用 root 做修复或检查

### 3. `pairing required` 仍然是另一条独立失败链路

它和本次 WebChat 投递问题不是一回事，但会制造非常像的表象：

- 命令需要批准
- exec 被挡
- 子链路中断

以后看到这类日志时，必须和“消息发送路由失效”分开分析。

### 4. `heartbeat` 风格 recent-active 记录是当前最重要的剩余边界

最新一次失败说明：

- session store 或 recent-active 快照可能恢复出 `messageProvider = heartbeat`
- 这个 targetKey 虽然能表示“最近关联过这里”
- 但不等于一定恢复出一个真正可投递到 WebChat 的 transport

下次如果要继续打磨，优先级最高的剩余问题就是把“可追踪 route hint”和“可送达 route”进一步区分清楚。

---

## 面向下一轮 prompt / skill 设计的建议

### 1. 审计报告 prompt 不要强调“原样输出”，要强调“学习并自然表达”

用户已经明确表达过不喜欢“强制原样输出”的味道。结合本次经验，更好的提示方向是：

- 给模型完整预计算报告
- 明确必须保留章节完整性
- 允许模型用自然、专业、完整的中文重新组织表达
- 但禁止删章、禁止回到阻塞说明、禁止暴露内部工件路径

这比“逐字照抄 Markdown”更贴近 OpenClaw 的真实使用场景。

### 2. 手动与定时 prompt 应分开设计

两者虽然共用同一份预计算报告，但目标不同：

- 手动 `/lynx-check`
  - 直接面向当前用户
  - 更强调完整正文、可读性、自然语气
- 定时 `/lynx-check`
  - 更强调首屏结论、风险级别、整改动作
  - 适合转发，但不能压缩成无内容的短摘要

### 3. 证据不足时必须保留章节，而不是删章

这条是这次需求里最稳定、也最值得固化为 skill 规则的一条：

- 某节证据不足时写“未能采集”或“需要进一步复核”
- 不能因为证据不足就把章节删掉

这能明显改善“定时任务只有一小段空话”的问题。

### 4. 提示词里不要再强化内部阻塞文案

未来 prompt 应明确压制这些内容进入最终用户视图：

- `BLOCKED`
- `Approve with`
- `allow-once`
- `allow-always`
- 本地工件路径
- `report.md` / `result.json`

这些内容会把“完整中文审计报告”重新拉回到内部执行说明，用户体验非常差。

### 5. 对插件自身与 lesson 自身的检测结果要更审慎地定级

用户已经明确反馈：

- `lynx-guardian-lesson` 自身 skill
- Lynx 插件自身执行内容

不应该轻易被直接打成高危。

这个方向是对的，但建议实现位置放在：

- 评分策略
- allowlist / policy
- 结果解释逻辑

而不是把“对自己放宽”赤裸裸写进提示词里。

---

## 适合沉淀成新 skill 的能力候选

### 1. `lynx-check-docker-runtime-verification`

职责：

- 修改插件后自动执行 Docker sync
- 触发真实 `/lynx-check`
- 读取最新 `result/report/session/log` 产物
- 给出“是报告生成问题、投递问题、还是路由恢复问题”的结论

价值：

- 能大幅减少只看 CLI 文案导致的误判

### 2. `lynx-check-report-delivery-fanout`

职责：

- 统一整理 Feishu / WebChat / current session / recent-active fanout 策略
- 明确何时继续尝试、何时记失败、何时允许 fallback
- 对 provider-specific shaping 做收敛

价值：

- 可以把当前消息投递逻辑从“问题修复代码”提炼成稳定的设计资产

### 3. `lynx-check-report-prompting`

职责：

- 统一维护手动与定时两套 prompt
- 固化“学习报告而非原样照抄”的写法
- 固化“章节不得缺失、证据不足要明确标注”的规则
- 固化 Feishu 首屏与 WebChat 长文差异

价值：

- 直接解决“内容缺失、语气僵硬、内部执行说明污染输出”的老问题

### 4. `lynx-check-artifact-triage`

职责：

- 给定一个 `requestId` 或最新一次运行
- 自动聚合 `intent/result/report/session/log`
- 输出排障摘要和下一步建议

价值：

- 特别适合下次再遇到“到底是没跑、没发，还是发了但没显示”这种模糊故障

---

## 下次迭代不该再犯的几个错误

- 不要只看 CLI 的即时提示就判断 `/lynx-check` 成败。
- 不要把 hook `ctx` 当成完整 runtime 使用。
- 不要假设 WebChat 和 Feishu 可以共享完全相同的投递实现。
- 不要在第一条投递成功后就停止 fanout。
- 不要把 recent-active 的 route hint 误当成已经可送达的 transport。
- 不要把关键预计算放到非 awaited hook。
- 不要再把 orchestrator 当成默认修复方向。

---

## 推荐配套阅读

- `docs/superpowers/openclaw-docker-debug-runbook.md`
- `docs/superpowers/lynx-guardian-code-tour.md`
- `docs/superpowers/plans/2026-04-11-lynx-check-async-hardening.md`
- `docs/superpowers/plans/2026-04-12-feishu-outbound-safety.md`
- `docs/superpowers/plans/2026-04-12-lynx-check-direct-audit-delivery.md`

以及 OpenClaw 源码中的这些位置：

- `D:\all-works\openclaw\src\plugins\runtime\types.ts`
- `D:\all-works\openclaw\src\plugins\runtime\types-channel.ts`
- `D:\all-works\openclaw\src\gateway\server-methods\chat.ts`
- `D:\all-works\openclaw\src\gateway\method-scopes.ts`
- `D:\all-works\openclaw\dist\plugin-sdk\plugins\types.d.ts`

---

## 当前最值得记住的总判断

`/lynx-check` 已经从“经常被自己拦住、经常只剩阻塞提示”推进到了“报告可预计算、Feishu 可稳定送达、WebChat 已被证明可直达但仍有 heartbeat 路由恢复边界”的阶段。

这意味着下一轮工作不该再从“怎么让它第一次跑起来”开始，而应该从下面三件事开始：

1. 把 heartbeat 场景下的 WebChat 路由恢复继续收口。
2. 把 prompt / 报告表达整理成更稳的 skill 资产。
3. 把 Docker-first 验证和产物优先排障流程工具化。
