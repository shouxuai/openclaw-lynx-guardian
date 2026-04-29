# Runtime：投递、状态、授权与脚本运行层

## 1. 这一层的职责

`src/runtime/*` 是整个项目里最像“基础设施层”的目录。它不直接做业务判断，而是负责：

1. 把状态写到文件系统
2. 把消息投递到正确渠道
3. 给不同渠道做文本整形
4. 管理一次性确认和工作流授权
5. 封装 Python 审计脚本与 Token 优化脚本
6. 维护 cron job 与运行时能力探测

## 2. 运行时辅助层：`plugin-runtime-helpers.ts`

### 关键函数

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `canonicalizePath(raw)` | 路径标准化 | 展开 `~`，绝对化，归一化 |
| `normalizeString(value)` | 统一清洗字符串 | 去空白，非 string 返回空串 |
| `normalizeStringList(value)` | 清洗字符串数组 | 统一做输入归一化 |
| `resolveRuntimeHomeDir()` | 解析运行时 HOME | 兼容 `HOME`、`USERPROFILE`、`HOMEDRIVE` |
| `isTrustedManagedLynxCheckReportText(value)` | 判断文本是否是可信审计报告 | 通过报告标题与章节模式识别 |
| `buildGuardContext(config, event, ctx)` | 构造 guard context | 统一计算 verified owner、trusted internal read、managed run 等信息 |
| `redactAgentOutput(event, replacement)` | 就地改写 agent 输出 | 处理 string 和 block message 两种形态 |
| `extractMessageText(message)` | 统一提取消息文本 | 兼容 string/block content |
| `createReplacementMessage(message, replacement)` | 构造替换后的消息对象 | 持久化保护时使用 |

### 设计要点

这是 runtime 层最核心的“胶水文件”，很多模块都依赖它完成字符串、路径和上下文归一化。

## 3. 本地状态存储族

### 3.1 `/lynx-check` 运行状态：`lynx-check-run-store.ts`

详见 `03-lynx-check-and-discovery.md`，这里强调它的基础设施特征：

- 通过 `resolveRootDir()` 统一运行目录
- 对 `reportPath` 做 root 内路径约束
- `normalizeIntent()` / `normalizeResult()` 对磁盘 JSON 做严格校验

### 3.2 最近活跃投递目标：`recent-active-delivery.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `readRecentActiveDeliverySnapshots()` | 读取最近活跃目标快照 |
| `readSessionStoreDeliverySnapshots()` | 从 OpenClaw session store 恢复投递目标 |
| `rememberRecentActiveDeliveryTarget()` | 记录当前上下文的投递目标 |
| `getRecentActiveDeliveryTargets()` | 获取带 live sender 的可投递目标 |
| `clearRecentActiveDeliveryTargetForContext()` | 在 session_end 清理当前上下文 |
| `shouldPreferRecentActiveDelivery()` | 判断 scheduled 场景是否优先 recent-active |
| `resetRecentActiveDeliveryTargets()` | 重置快照 |

#### 实现思路

- 磁盘上存 snapshot
- 内存里存 live sender
- 允许在进程重启后，通过 session store 恢复基础 route 信息

这让 scheduled `/lynx-check` 即使和原会话不在同一个执行上下文，也有机会把报告送回最近活跃聊天通道。

### 3.3 `/lynx-check` 授权状态：`managed-lynx-check-authorization-store.ts`

职责单一：

- 存 `/lynx-check` 预授权
- 让 managed 自检读取和回传不被误伤

### 3.4 一次性 override：`pending-override-store.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `savePendingOverride()` | 存待确认项 |
| `getPendingOverride()` | 查看待确认项 |
| `consumePendingOverride()` | 取一次并删除 |
| `clearPendingOverride()` | 主动清理 |
| `consumeMostRecentPendingOverride()` | fallback 场景取最近一条 |

#### 实现思路

这个 store 只解决“等待用户确认”这个短生命周期问题，不负责记录放行后的整段工作流。

### 3.5 工作流授权：`workflow-authorization-store.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `grantWorkflowAuth()` | 开启一段授权窗口 |
| `getWorkflowAuth()` | 判断当前操作是否落在授权窗口内 |
| `recordWorkflowOperation()` | 记录窗口期放行的操作 |
| `revokeWorkflowAuth()` | 结束窗口并返回 audit summary |
| `hasAnyWorkflowAuth()` | 判断是否已有任何授权 |

#### 实现思路

这里把“用户同意一次”提升成“同一工作流内的一段时间窗口”。这比单条 override 更符合真实使用场景。

### 3.6 override 桥接：`override-runtime.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `buildOperationFingerprint()` | 用 actionType + payload 生成唯一指纹 |
| `resolveOverrideKeys()` | 同时解析 `sessionKey` 和 `channelId` |
| `resolveOverrideKey()` | 解析主要 key |
| `savePendingOverrideFull()` | 把待确认项按多个 key 存入 store |
| `approvePendingOverrideFull()` | 把确认结果扩散到多个 key |
| `consumeApprovedOverrideFull()` | 消费一次性 override |
| `inferBlacklistModules()` | 把黑名单命中原因映射成风险模块 |

#### 设计思路

这个文件的作用是把“临时待确认项”“单次放行结果”“黑名单语义”衔接起来，避免 hook 层直接操作多个 store。

## 4. 消息投递层

### 4.1 `lynx-message-delivery.ts`

这是投递主入口。

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `shapeTextForProvider()` | 针对 provider 做文本整形，目前重点支持 Feishu |
| `shapeMessageForProvider()` | 对 message 对象整体整形 |
| `collectDeliveryCandidates()` | 组装 routeHint、live target、snapshot、session store 等候选目标 |
| `deliverToCandidate()` | 对单个候选目标尝试多种 transport |
| `deliverLynxReport()` | 对所有候选目标执行投递并汇总 deliveryAttempts |

#### transport 尝试顺序

同一个 candidate 内部，优先级大致是：

1. `shared-resolved-target`
2. `candidate.sendMessage`
3. `ctx.sendMessage` 同会话兜底
4. WebChat 网关注入

#### Feishu 特殊处理

为了避免飞书消息过长、表格渲染差、卡片超限，这里额外提供：

- `flattenMarkdownTablesForFeishu()`
- `shortenFeishuAuditForSafety()`
- `extractFeishuLead()`

设计上属于 provider adapter，但目前还内嵌在主投递文件里。

### 4.2 `lynx-webchat-delivery.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `extractInjectableWebchatText()` | 从消息里提取可注入 WebChat 的纯文本 |
| `setLynxWebchatGatewayCallerForTests()` | 测试替身注入点 |
| `injectLynxWebchatReportViaGateway()` | 通过网关把报告注入 WebChat 会话 |

这个文件只处理 WebChat 的专用 transport，不掺杂通用候选选择逻辑，职责比较清晰。

### 4.3 `message-decoration.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `decorateOutgoingMessage()` | 对普通字符串消息加装饰 |
| `formatDiscoveryReport()` | 给 discovery 结果套统一头部 |
| `appendDiscoveryReportToContent()` | 往纯文本内容附加 discovery 报告 |
| `appendDiscoveryReportToMessage()` | 往 message 对象附加 discovery 报告 |
| `decorateAssistantMessage()` | 对 assistant message 进行整体装饰 |

### 设计思路

它的角色是“格式层”，把内容组织成更适合落盘和发送的文本，但不做风险判断。

## 5. cron 与能力探测

### 5.1 `scheduled-lynx-check.ts`

它负责 cron store 幂等同步，已经在前一篇详述。

### 5.2 `hook-capabilities.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `isVersionAtLeast()` | 比较版本 |
| `getOpenClawRuntimeVersion()` | 读取运行时 OpenClaw 版本 |
| `getHookCapabilityReport()` | 生成 hook 能力报告 |

这个模块的意义是让插件可以在运行时判断“某些 hook 是否真的可用”，避免在不支持的版本上盲目依赖新能力。

## 6. 策略拼装层：`policy-runtime.ts`

### 关键函数

| 函数 | 作用 |
| --- | --- |
| `normalizePolicyConfig()` | 标准化确认短语、override TTL、workflow window 等配置 |
| `buildApiRiskAssessment()` | 把远端 API 风险级别映射到本地 RiskAssessment |
| `buildOverridePrompt()` | 生成用户确认提示文案 |
| `buildParamSummary()` | 对工具参数做摘要 |
| `formatWorkflowAuthSummary()` | 生成授权窗口结束时的操作汇总 |

### 实现思路

这个文件的价值在于把“文案、配置默认值、API 风险级别翻译”从 `index.ts` 抽出来，减少主文件的策略杂糅。

## 7. 外部脚本封装层

### 7.1 `security-audit-runner.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `findScriptsDir()` | 找到 `SX-security-audit` 技能脚本目录 |
| `findPython()` | 找到可用 Python |
| `runSecurityAudit()` | 执行 `security_audit.py` |
| `runMaliciousScriptScan()` | 执行 `malicious_script_scanner.py` |
| `formatAuditSummary()` | 格式化摘要 |

### 7.2 `token-optimizer-runner.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `findTokenOptimizerScriptsDir()` | 找到 token optimizer 脚本目录 |
| `findPython()` | 找 Python |
| `runScript()` | 统一脚本执行器 |
| `recommendContext()` | 推荐最小上下文 |
| `routeModel()` | 推荐模型档位 |
| `planHeartbeat()` | 规划哪些 heartbeat 检查可以跳过 |
| `checkBudget()` | 获取预算状态 |
| `buildOptimizationHints()` | 拼成可以注入给模型的提示 |
| `isTokenOptimizerAvailable()` | 判断脚本是否可用 |

### 设计观察

这两个 runner 非常像：

- 都要找脚本目录
- 都要找 Python
- 都要做子进程执行
- 都要把脚本输出转回 TypeScript 可消费数据

这是明显可进一步抽象的重复点。

## 8. runtime 层的总体特点

### 优点

- 运行时状态基本都有独立文件，职责比 `index.ts` 更清楚
- 投递层支持多 transport、多候选、多兜底
- 通过文件状态机，把 hook 间耦合变成了可观察的持久化状态

### 问题

- store 模板代码重复明显
- route hint / target normalization 在多个文件里重复实现
- provider 适配逻辑还没有完全抽离成独立 adapter 层
- 旧 discovery 文件流和新 run-store 流并存
