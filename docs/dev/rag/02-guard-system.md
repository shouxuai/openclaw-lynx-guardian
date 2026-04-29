# Guard 安全体系梳理

## 1. 设计目标

`src/guard/*` 这组代码负责把“安全风险”从模糊文本转成结构化决策。它的核心目标不是做完美语义理解，而是提供一套能稳定落在 hook 上运行的风险分级框架。

它实际分成 4 层：

1. 信号检测层
   例如 prompt injection、system prompt leak、敏感信息识别。
2. 风险归并层
   主要在 `safety-guard.ts`，把多个模块信号折叠成一个评分。
3. 策略解析层
   主要在 `risk-policy.ts`，决定是否允许一次性放行。
4. 持久化/输出保护层
   主要在 `result-guard.ts`，防止危险内容被写盘或继续发出。

## 2. 模块分工

| 文件 | 角色 | 核心能力 |
| --- | --- | --- |
| `src/guard/prompt-injection.ts` | 输入攻击检测器 | 提示注入、系统提示提取、编码混淆 |
| `src/guard/system-prompt-guard.ts` | 输出泄露检测器 | 检测系统提示、内部规则、受保护文件内容泄露 |
| `src/guard/sensitive.ts` | 敏感数据快筛器 | 高熵串、常见敏感信息 |
| `src/guard/safety-guard.ts` | 总评分器 | 输入、输出、工具调用的统一风险评估 |
| `src/guard/risk-policy.ts` | 放行策略器 | 把风险结果转成是否允许 override |
| `src/guard/result-guard.ts` | 持久化保护层 | 工具结果和 assistant 输出落盘前改写 |
| `src/guard/security-awareness.ts` | 预警注入器 | 在 L1/L2 场景向模型注入安全上下文 |
| `src/path-glob-protection.ts` | 路径混淆检测工具 | 识别 glob、变量拼接、静态组装绕过 |

## 3. `prompt-injection.ts`

### 关键函数

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `matchPatterns(text, patterns)` | 统一跑一批正则 | 返回所有命中的标签 |
| `hasBase64InjectionPayload(text)` | 检测 base64 包裹的注入载荷 | 先找长串，再尝试解码后匹配关键字 |
| `detectPromptInjection(text)` | 提示注入总入口 | 组合直接注入、角色劫持、绕过安全、编码混淆等信号 |
| `detectSystemPromptExtraction(text)` | 系统提示提取检测 | 专门拦截“把 system prompt / 受保护文件吐出来”类语句 |

### 实现特点

- 这是正则 + 关键字规则驱动，不依赖模型。
- 优先解决“高确定性攻击表达”，牺牲一部分自然语言泛化。
- 和 `path-glob-protection.ts` 联动，用于识别混淆后的受保护路径读取。

## 4. `system-prompt-guard.ts`

### 核心函数

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `detectSystemPromptLeak(output)` | 检测输出中是否包含内部提示或受保护规则内容 | 看文件名、内部标记、规则片段、敏感路径等组合特征 |

### 设计思路

这个模块只看“已经生成出的内容”，本质是输出侧 DLP。它不关心用户是否恶意，只关心结果里有没有不该出现的内部信息。

## 5. `sensitive.ts`

### 类与方法

| 结构 | 作用 | 实现思路 |
| --- | --- | --- |
| `SensitiveDataBlocker` | 敏感数据快筛器 | 维护多类模式并提供统一检测入口 |
| `isHighEntropy()` | 判断高熵串 | 避免把普通短文本误判为密钥 |
| `containsSensitiveData()` | 主检测入口 | 综合高熵串、密钥样式、常见敏感标记 |

### 设计思路

这个模块是最轻量的一层，放在 `message_received` 最前面，目的是用最低成本拦住最明显的敏感内容。

## 6. `safety-guard.ts`

这是整个 guard 体系的核心文件。

### 6.1 风险模型

它定义了：

- 风险等级：`L0` 到 `L4`
- 决策动作：`allow`、`log`、`warn`、`block`、`deny`
- 风险维度：`harm`、`rev`、`auth`、`pattern`、`clarity`
- 加权折叠机制：首个模块 full value，后续同维度信号按 0.5 折叠

### 6.2 关键函数组

#### 评分基础设施

| 函数 | 作用 |
| --- | --- |
| `createAccumulators()` | 初始化五维度计分容器 |
| `foldDim(values)` | 同一维度做折叠累加 |
| `pushDim(accum, key, value)` | 写入维度分值 |
| `computeWeightedScore(accum)` | 计算最终 0-10 分 |
| `scoreToLevel(score)` | 把分数映射到 L0-L4 |
| `levelToAction(level)` | 把等级映射成 allow/warn/block/deny |
| `buildInstantDeny()` / `buildInstantDenyForModules()` | 直接构造 L4 硬拒绝结果 |

#### 会话状态与序列攻击检测

| 函数 | 作用 |
| --- | --- |
| `evictStaleSessions()` | 清理过期会话状态 |
| `getSessionState(sessionKey)` | 读取或初始化会话状态 |
| `inferOperationCategory(modules)` | 把命中模块映射为行为类别 |
| `checkSequencePatterns()` | 检测多步攻击模式 |
| `computeAnomalyAdjustment()` | 给连续攻击行为加权升分 |

#### 输入信号检测

| 函数 | 作用 |
| --- | --- |
| `detectIdentityClaims()` | 检测身份冒充或“我是管理员/主人” |
| `detectPluginIntegrityViolation()` | 检测试图篡改插件自身 |
| `detectProtectedFileAccess()` | 检测受保护文件访问 |
| `detectCredentialTheft()` | 检测凭据读取或窃取 |
| `detectOverAgency()` | 检测越权代理与权限提升 |
| `detectMaliciousCodeRequest()` | 检测恶意代码请求 |
| `checkFatalTriangle()` | 检测“高危工具 + 外发 + 敏感信息”组合 |

#### 路径与命令混淆检测

| 函数 | 作用 |
| --- | --- |
| `normalizeGuardPath()` | 统一路径格式 |
| `detectExecMasqueradeSetup()` | 识别命令影子替换或 PATH 污染 |
| `detectExecMasqueradeHint()` | 识别伪装执行的辅助线索 |
| `updateExecMasqueradeState()` | 把 taint 写入会话状态 |
| `detectSensitiveDirEntry()` | 检测进入敏感目录 |
| `detectWildcardObfuscation()` | 检测 glob 混淆路径 |
| `detectPathObfuscation()` | 检测变量/拼接路径混淆 |
| `detectPipeExecution()` | 检测管道执行风险 |

#### 三个总入口

| 函数 | 作用 | 用在何处 |
| --- | --- | --- |
| `guardInput(text, sessionKey, guardContext)` | 输入文本风险判断 | `message_received`、`before_agent_start` |
| `guardOutput(output, sessionKey, guardContext)` | 输出风险判断 | `agent_end`、`message_sending` |
| `guardToolCall(toolName, params, sessionKey, guardContext)` | 工具调用风险判断 | `before_tool_call` |
| `clearSessionState(sessionKey)` | 清理会话状态 | 测试和重置 |

### 6.3 实现思路

`safety-guard.ts` 的关键设计是“多模块命中，但统一决策”。也就是：

1. 每个子检测器只负责给出局部信号
2. 统一通过加权 + 折叠得到总风险
3. 特殊场景走 instant deny，直接跳过评分
4. 结果由 `risk-policy.ts` 决定是否可 override

这样做的优点是：

- hook 层只需要消费一个 `GuardDecision`
- 新增模块时不需要重写整个 hook 流程

缺点是：

- 检测信号很多时，调参与误报边界会越来越难维护
- 一些强耦合模块名已经变成了外部策略配置的一部分

## 7. `risk-policy.ts`

### 关键函数

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `resolveRiskPolicy(riskAssessment, policy)` | 判断当前风险是否允许一次性 override | 根据 score、level、module override 白名单、硬拒绝模块做决策 |

### 关键结论

- 并不是所有 `L4` 都能 override。
- `M1:prompt_injection`、`M5:credential_theft`、`M6:malicious_code`、`fatal_triangle` 等被硬编码成不可放行。
- 这个文件把“风险结果”和“用户确认策略”分开，保持了职责清晰。

## 8. `result-guard.ts`

### 关键函数

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `containsProtectedResult()` | 判断工具结果是否包含受保护内容 | 复用输出 guard 逻辑 |
| `guardToolResultPersistence(toolName, message, guardContext)` | 在工具结果写入前改写消息 | 返回替换后的安全 message |
| `guardAssistantPersistence(message, guardContext)` | assistant 消息落盘前保护 | 防止泄露内容持久化 |

### 设计思路

这个模块解决的是“即使前面漏了，也不能让脏数据落盘”。所以它本质是安全兜底层。

## 9. `security-awareness.ts`

### 核心函数

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `buildSecurityAwarenessInjection(modules)` | 给低到中风险情境注入安全提醒 | 把模块命中映射为模型可读的预警文本 |

这个模块不做阻断，只做“弱信号提醒”，是 guard 体系里唯一偏提示工程的组件。

## 10. `path-glob-protection.ts`

这个文件是 guard 体系非常重要的底层辅助层，用于识别“看起来不是危险路径，实际上经过 glob/变量/拼接后能指向危险路径”的情况。

### 关键函数

| 函数 | 作用 |
| --- | --- |
| `hasGlobMeta()` | 判断字符串里是否有 glob 元字符 |
| `findObfuscatedSystemAuthPath()` | 识别混淆后的系统认证文件路径 |
| `findObfuscatedLynxPluginPath()` | 识别混淆后的 Lynx 插件目录路径 |
| `findObfuscatedProtectedReferenceLabels()` | 识别混淆后的受保护标签引用 |

内部还包含大量辅助函数：

- `collectPathLikeTokens()`
- `collectGlobCandidateTokens()`
- `resolveVariableValue()`
- `collectObfuscatedCandidateTokens()`

这些函数的共同思路是：尽量在不执行脚本的前提下，做有限度的静态展开。

## 11. guard 体系与 hook 的映射关系

| hook | guard 能力 |
| --- | --- |
| `message_received` | `SensitiveDataBlocker`、`guardInput` |
| `before_agent_start` | `guardInput`、`buildSecurityAwarenessInjection` |
| `before_tool_call` | `guardToolCall` |
| `tool_result_persist` | `guardToolResultPersistence` |
| `before_message_write` | `guardAssistantPersistence` |
| `message_sending` | `guardOutput` |
| `agent_end` | `guardOutput` + `redactAgentOutput` |

## 12. 测试覆盖点

重点测试主要在：

- `test/safety-guard.test.ts`
- `test/risk-policy.test.ts`
- `test/regression.test.ts`
- `test/blacklist.test.ts`

测试策略很明确：

1. 单点规则检测
2. 会话升级与异常加权
3. 误报回归
4. 受保护路径绕过回归

## 13. 当前 guard 体系的优缺点

### 优点

- 基本覆盖了输入、工具、输出、持久化四个阶段
- 有统一风险结构体，便于记录和策略处理
- 对 `/lynx-check` 场景引入了 trust context，避免自我阻断

### 风险

- `safety-guard.ts` 已经接近“策略平台”，继续往里塞规则会越来越难维护
- 模块 ID 与策略配置绑定太深，后续重命名成本高
- 本地规则、黑名单、远端 API 风控之间仍有职责交叉
