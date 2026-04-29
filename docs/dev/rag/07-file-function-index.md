# 文件与函数索引

## 1. 使用方式

这份索引聚焦“运行逻辑里真正有决策意义的函数”。对大文件我尽量覆盖所有顶层函数；对纯常量文件，我只写文件职责。

阅读建议：

1. 先按目录看文件角色
2. 再按函数看“作用 + 实现思路”
3. 遇到 `/lynx-check`、delivery、guard 等跨模块链路，再回到前面的专题文档

## 2. 根入口与基础文件

### `index.ts`

角色：插件总入口、hook 注册中心、跨模块编排层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `isConfirmationPhrase()` | 判断用户是否输入确认短语 | 简单字符串包含判断，作为 override 入口 |
| `resolveAgentStartPromptText()` | 提取 `before_agent_start` 的主 prompt | 优先 `event.prompt`，否则从消息里找最近 user 文本 |
| `stripBracketPrefixedEnvelope()` | 去掉包装前缀 | 解决日志/前缀对 trigger 判断的干扰 |
| `extractAgentStartPrimaryMessageText()` | 提取 agent start 主消息文本 | 从 message 数组逆序找 user |
| `resolveManagedLynxCheckCommandText()` | 检测是否在触发 `/lynx-check` | 对 prompt 与消息逐行跑 trigger 分类 |
| `setup()` | 注册全部 hook，并初始化运行环境 | 解析配置、同步资源、启动后台任务、挂接生命周期处理 |

### `src/config.ts`

角色：基础常量仓库。

| 常量 | 作用 |
| --- | --- |
| `CONFIG.API_BASE_URL` | 远端安全中心 API 地址 |
| `CONFIG.CACHE_DIR` | 插件缓存目录 |
| `CONFIG.ID_FILE` | 用户 ID 文件名 |

### `src/types.ts`

角色：插件与 OpenClaw 之间的类型契约。

重点结构：

- `PluginConfig`
- `Message`
- `EventContext`
- `LynxReportDeliveryAttempt`
- `ResolvedMessageTarget`
- `OpenClawPluginApi`

实现思路：把 hook 事件、消息、投递目标、配置 schema 统一类型化，减少 `index.ts` 与 runtime 层的接口歧义。

### `src/api.ts`

角色：远端安全中心 API 客户端。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `safeFetch()` | 通用请求封装 | 统一超时、状态码校验、JSON 解析 |
| `registerUser()` | 注册当前用户 ID | 建立远端身份 |
| `checkContent()` | 远端内容风控 | 区分输入和输出两类检查 |
| `checkTool()` | 远端工具风控 | 对本地命中的工具风险做补充判断 |
| `pushRecord()` | 上报风险事件 | 形成远端审计记录 |
| `checkPublicAccess()` | 检查公网暴露 | `/lynx-check` 的公网探测之一 |
| `fetchMaliciousSkillBlacklist()` | 拉取远端 Skill 黑名单 | 补充本地静态情报 |
| `checkSkill()` | 远端 Skill 检查 | 作为本地 Skill 真实性校验补充 |

### `src/blacklist.ts`

角色：高确定性命令与路径黑名单。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `isQuotedOrCommented()` | 判断命中片段是否只是注释或引用 | 降低误报 |
| `matchRules()` | 批量匹配规则 | 统一执行 critical/warning/safe 规则组 |
| `splitCommand()` | 安全拆分命令链 | 按 `&&`、`;`、`|` 等分段但尽量不误拆字符串 |
| `hasDangerousTaintStructure()` | 判断 taint 后的危险结构 | 给 exec masquerade 联动使用 |
| `isClearlyReadOnlySafeSegment()` | 判断命令片段是否明显只读 | 降低 taint 场景下误报 |
| `shouldShortCircuitSafeExec()` | 判断是否可直接视为安全命令 | 用于快速放行 |
| `matchTaintedUnknownExec()` | 匹配 taint 状态下的未知执行器 | 防止 PATH 污染后借壳执行 |
| `checkExecBlacklist()` | 检查 exec 命令 | 覆盖整条命令和分段命令两层 |
| `checkPathBlacklist()` | 检查写入/编辑路径 | 拦截系统敏感路径与插件硬锁目录 |

### `src/utils.ts`

角色：跨模块基础工具箱。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `getCacheDir()` | 获取缓存目录 | 基于 `CONFIG.CACHE_DIR` |
| `getUserIdFile()` | 获取用户 ID 文件路径 | 基于缓存目录和 `ID_FILE` |
| `generateUserId()` | 生成用户 ID | 日期 + 随机串格式 |
| `ensureUserRegistered()` | 读取或创建本地用户 ID | 启动时调用 |
| `resolveSessionsDir()` | 找到 OpenClaw sessions 目录 | 供上下文读取使用 |
| `readRecentContext()` | 读取最近会话上下文摘要 | 给工具风控和审计回传辅助信息 |
| `copyFolderRecursiveSync()` | 递归复制目录 | 资源同步基础能力 |
| `findStalePluginManagedDirectories()` | 找出应清理的旧目录 | 宿主机资源同步辅助 |
| `syncNamedDirectories()` | 同步命名子目录 | 用于 `hooks/` 和 `skills/` |
| `ensureResources()` | 把仓库内 `hooks/skills` 同步到 `~/.openclaw` | 启动期和 gateway_start 都会调用 |
| `getOpenClawPort()` | 读取 OpenClaw gateway 端口 | 供公网检查与 discovery 使用 |
| `isPrivateIp()` | 判断是否私网 IP | 网络探测基础函数 |
| `ipv4ToNumber()` / `numberToIpv4()` | IPv4 与整数互转 | 供网段计算使用 |
| `netmaskToPrefix()` | 子网掩码转前缀长度 | 构造 CIDR |
| `buildIpv4Cidr()` | 根据 IP + 掩码生成 CIDR | 本地网段枚举准备 |
| `listLocalSubnetCidrs()` | 枚举本地子网段 | discovery 自动扩展目标 |
| `hasCommand()` | 判断系统命令是否存在 | `curl` 等能力探测 |
| `requestTextByCurl()` | 用 curl 请求文本 | 优先外部命令实现 |
| `requestTextByHttp()` | 用 Node http/https 请求文本 | curl 不存在时回退 |
| `requestText()` | 统一文本请求入口 | 先 curl 后 http |
| `getPublicIpFromService()` | 获取公网 IP | 公网暴露判断数据源 |
| `isProcessRunning()` | 判断进程是否在运行 | tunnel 检测辅助 |
| `resolveHostIp()` | 做 DNS 解析 | discovery 目标处理辅助 |
| `extractHost()` | 从 URL 或 host 字符串提取 host | 网络扫描预处理 |
| `detectNgrok()` | 检测 ngrok | 推断公网暴露来源 |
| `detectFrp()` | 检测 frp | 同上 |
| `getLocalIpFromInterfaces()` | 从网卡信息取本地 IP | 局域网识别 |
| `getLocalIpByIpconfig()` | 在特定平台上获取 IP | 平台兼容分支 |
| `getLocalIp()` | 汇总本机 IP 获取逻辑 | discovery 基础信息 |
| `getIpAdress()` | 选取“最能代表外部访问”的地址 | 依次考虑 tunnel、公网、本地 IP |
| `baseIpInfo()` | 生成公网暴露检查基础信息 | `/lynx-check` 的前置情报核心函数 |
| `extractContentAfterDate()` | 去掉带日期前缀的消息包装 | 给 trigger 和风控输入做净化 |

## 3. Discovery 目录

### `src/discovery/discovery-hook-utils.ts`

角色：hook 侧的 discovery 编排辅助层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `isManualCompositeLynxCheckRequest()` | 判断是否为手动复合 `/lynx-check` 请求 | 支持自然语言包装 |
| `isManualDiscoveryRequest()` | 判断是否只是服务发现请求 | 区分审计与 discovery |
| `resolveDiscoveryTargets()` | 计算扫描目标集合 | 结合显式 targets 与自动扩展 |
| `runDiscoveryAndNotify()` | 执行 discovery 并返回摘要 | 供 `message_received` 和 `manual-lynx-check` 复用 |

### `src/discovery/discovery-runtime-config.ts`

角色：discovery 配置归一化。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `loadDiscoveryRuntimeConfig()` | 读取并归一化 discovery 配置 | 合并默认值与 inline config |

### `src/discovery/lynx-check-report-template.ts`

角色：手动 `/lynx-check` 报告模板层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `renderDetailedLynxAuditReport()` | 渲染完整 Markdown 报告 | 负责章节排版而非审计逻辑 |

### `src/discovery/lynx-check-trigger.ts`

角色：`/lynx-check` 与自然语言 discovery 的触发分类器。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `normalizeRawInput()` | 输入预清洗 | 去空白和简单归一化 |
| `escapeRegExp()` | 正则安全转义 | 关键字匹配辅助 |
| `hasEnglishKeyword()` | 英文关键字检测 | 命中 scan/check/openclaw 等 |
| `hasCjkKeyword()` | 中文关键字检测 | 命中检测/扫描/审计等 |
| `hasKeywordGroup()` | 检查是否满足一组关键词组合 | 提升触发判断的可配置性 |
| `isLikelySenderPrefix()` | 判断前缀是否只是发送者标记 | 降低误报 |
| `normalizeInput()` | 标准化输入 | 统一 slash/natural-language 格式 |
| `hasSlashCommand()` | 判断是否 slash command | 优先识别显式命令 |
| `isKeywordDiscoveryPrompt()` | 判断是否自然语言 discovery 请求 | 支持中文和英文 |
| `classifyLynxCheckTrigger()` | 总入口 | 输出命令类别和归一化文本 |

### `src/discovery/manual-lynx-check.ts`

角色：手动 `/lynx-check` 报告聚合器。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `formatTimestamp()` | 生成报告时间 | 固定时区输出 |
| `extractDiscoveryTargets()` | 从 discovery 摘要提取 `IP:port` | 报告章节整理辅助 |
| `filterAuditFindings()` | 按关键字筛审计项 | 让章节内容更聚焦 |
| `deriveOverallRating()` | 计算总评级 | 综合公网暴露、恶意脚本、严重漏洞、Skill 完整性 |
| `buildConfigSection()` | 构造配置安全章节 | 聚合 config/env/credential 相关 findings |
| `buildGatewaySection()` | 构造网关与执行面章节 | 聚合公网暴露与 discovery 结果 |
| `buildChannelSection()` | 构造通道与投递链章节 | 强调回传链路安全 |
| `buildSkillSection()` | 构造 Skill 风险章节 | 聚合恶意脚本扫描与完整性校验 |
| `buildDependencySection()` | 构造依赖供应链章节 | 筛出依赖类 findings |
| `buildPermissionSection()` | 构造权限章节 | 筛出 world-writable 等权限问题 |
| `buildNextActions()` | 生成优先整改建议 | 基于风险结果动态给出建议 |
| `buildManualLynxCheckReport()` | 报告总入口 | 聚合多数据源并交给模板渲染 |

### `src/discovery/openclaw-discovery.ts`

角色：OpenClaw 服务发现引擎。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `getConfidenceLabel()` | 将数值置信度映射成标签 | 便于摘要展示 |
| `uniquePorts()` | 端口去重 | 扫描前清理输入 |
| `clamp()` | 限制数值范围 | 参数防御性处理 |
| `isIpv4()` | 判断 IPv4 | 目标解析基础函数 |
| `ipToNumber()` / `numberToIp()` | IP 与整数互转 | CIDR 展开用 |
| `expandIpv4Cidr()` | 展开 CIDR 网段 | 支持批量 host 探测 |
| `parseHostTarget()` | 解析目标字符串 | 支持 host、URL、CIDR、host:port |
| `asyncPool()` | 并发池执行器 | 控制 host/port 并发度 |
| `normalizeHeaders()` | 标准化响应头 | 指纹识别前处理 |
| `performRequest()` | 执行请求并收集响应 | HTTP 探测底层封装 |
| `httpGet()` | 执行 GET 探测 | 支持 HTTP/HTTPS 回退 |
| `checkWebSocket()` | 检测 WebSocket | OpenClaw 指纹辅助 |
| `checkTcpPort()` | 探测 TCP 端口 | 最低成本探活 |
| `tcpScanPorts()` | 批量端口探活 | 对单 host 多 port 使用 |
| `buildFullPortList()` | 生成全端口列表 | full scan 模式 |
| `fingerprintOpenClaw()` | 识别 OpenClaw 指纹 | 综合 body、header、health、ws 等特征 |
| `scanTarget()` | 扫描单目标 | 组合端口探活与指纹识别 |
| `sortHits()` | 排序命中结果 | 按分数与稳定顺序输出 |
| `normalizeHitHost()` | 统一 host 表示 | 例如 localhost -> 127.0.0.1 |
| `dedupeHits()` | 去重命中结果 | 保留最佳置信度版本 |
| `discoverOpenClaw()` | discovery 总入口 | 整合目标扩展、扫描、去重、排序 |
| `formatDiscoverySummary()` | 生成摘要文本 | 给用户和报告章节使用 |

### `src/discovery/pending-discovery-store.ts`

角色：旧版 discovery 文件状态层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `ensureParentDirectory()` | 确保父目录存在 | 文件写入前置能力 |
| `writePendingDiscoveryRequest()` | 写入 pending 请求 | 供旧版 discovery 发送链使用 |
| `readPendingDiscoveryRequest()` | 读取请求 | 给 agent_end 判断是否应附加报告 |
| `clearPendingDiscoveryRequest()` | 清理请求 | 发送成功后调用 |
| `shouldAttachPendingDiscoveryReport()` | 判断是否应附加旧报告 | 基于 sessionKey 等上下文匹配 |

## 4. Guard 目录

### `src/guard/prompt-injection.ts`

角色：输入攻击检测器。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `matchPatterns()` | 批量正则匹配 | 统一收集命中模式 |
| `hasBase64InjectionPayload()` | 检测 base64 注入载荷 | 先找可疑长串，再尝试解码 |
| `detectPromptInjection()` | 提示注入总入口 | 综合直接注入、角色劫持、绕过安全、编码混淆 |
| `detectSystemPromptExtraction()` | 系统提示提取检测 | 专门拦截读取内部规则/文件的表达 |

### `src/guard/result-guard.ts`

角色：持久化保护层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `containsProtectedResult()` | 判断结果中是否含受保护内容 | 复用 guard 逻辑做快速判断 |
| `guardToolResultPersistence()` | 工具结果落盘前保护 | 必要时返回替换后的 message |
| `guardAssistantPersistence()` | assistant 消息落盘前保护 | 防止内部内容持久化 |

### `src/guard/risk-policy.ts`

角色：风险结果到策略决策的转换层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `isModuleOverridable()` | 判断单个模块是否可 override | 过滤硬拒绝模块 |
| `areAllModulesOverridable()` | 判断一组模块是否都可放行 | 批量校验模块 |
| `resolveRiskPolicy()` | 输出最终策略结果 | 综合分数、等级、模块 override 配置 |

### `src/guard/safety-guard.ts`

角色：输入、输出、工具调用的统一总评分器。

| 函数 | 作用 |
| --- | --- |
| `createAccumulators()` | 初始化五维度计分容器 |
| `foldDim()` | 对同维度多信号做折叠 |
| `pushDim()` | 写入维度分值 |
| `computeWeightedScore()` | 计算总分 |
| `scoreToLevel()` | 分数转 L0-L4 |
| `levelToAction()` | 等级转动作 |
| `buildInstantDeny()` / `buildInstantDenyForModules()` | 直接输出 L4 拒绝 |
| `evictStaleSessions()` | 清理过期会话状态 |
| `getSessionState()` | 读取/创建会话状态 |
| `inferOperationCategory()` | 将风险模块映射为行为类别 |
| `checkSequencePatterns()` | 检测多步序列攻击 |
| `computeAnomalyAdjustment()` | 对连续风险行为加权升分 |
| `detectIdentityClaims()` | 检测身份冒充表述 |
| `normalizeGuardPath()` | 统一 guard 用路径格式 |
| `extractPluginTargets()` | 提取插件目标路径 |
| `detectPluginIntegrityViolation()` | 检测试图篡改插件自身 |
| `detectProtectedFileAccess()` | 检测受保护文件访问 |
| `detectCredentialTheft()` | 检测凭据读取 |
| `detectOverAgency()` | 检测越权代理 |
| `detectExecMasqueradeSetup()` | 检测命令伪装铺垫 |
| `detectExecMasqueradeHint()` | 检测命令伪装提示信号 |
| `getActiveExecMasqueradeLevel()` | 读取当前伪装 taint 级别 |
| `updateExecMasqueradeState()` | 更新 taint 状态 |
| `detectSensitiveDirEntry()` | 检测进入敏感目录 |
| `detectWildcardObfuscation()` | 检测 glob 混淆 |
| `detectPathObfuscation()` | 检测变量/拼接混淆路径 |
| `detectPipeExecution()` | 检测管道执行风险 |
| `detectMaliciousCodeRequest()` | 检测恶意代码请求 |
| `hasLegalSecurityContext()` | 区分合法安全语境与攻击语境 |
| `checkFatalTriangle()` | 检测高危三角组合 |
| `guardInput()` | 输入风险总入口 |
| `detectSecretsInOutput()` | 输出秘密信息检测 |
| `guardOutput()` | 输出风险总入口 |
| `guardToolCall()` | 工具调用风险总入口 |
| `buildDescription()` | 拼装风险描述文案 |
| `clearSessionState()` | 清理会话状态 |

### `src/guard/security-awareness.ts`

角色：低中风险场景的安全预警注入器。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `buildSecurityAwarenessInjection()` | 把命中模块转成模型可读安全提醒 | 给 `before_agent_start` 注入弱约束上下文 |

### `src/guard/sensitive.ts`

角色：敏感信息快筛器。

| 结构 | 作用 | 实现思路 |
| --- | --- | --- |
| `SensitiveDataBlocker` | 聚合敏感数据检测能力 | 暴露 `isHighEntropy()` 和 `containsSensitiveData()` 两个核心方法 |

### `src/guard/system-prompt-guard.ts`

角色：输出泄露检测器。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `detectSystemPromptLeak()` | 识别输出中的内部规则或受保护内容 | 基于文件名、规则标记、内部词汇等组合判断 |

### `src/path-glob-protection.ts`

角色：路径混淆检测基础库。

| 函数 | 作用 |
| --- | --- |
| `escapeRegex()` | 构造安全正则片段 |
| `stripWrapping()` | 去掉包裹符号 |
| `normalizePathToken()` | 统一路径片段格式 |
| `pathToComponents()` | 路径拆分成组件 |
| `globComponentToRegexSource()` | glob 组件转正则源 |
| `componentCouldMatch()` | 判断组件是否可能命中 |
| `exactProtectedTargetMatch()` | 精确匹配受保护目标 |
| `protectedSubpathMatch()` | 受保护子路径匹配 |
| `collectPathLikeTokens()` | 收集可疑路径 token |
| `collectGlobCandidateTokens()` | 收集 glob token |
| `normalizeVariableName()` | 变量名归一化 |
| `collectRawAssignments()` | 收集静态赋值 |
| `looksLikeProtectedFragment()` | 判断片段是否像敏感路径 |
| `addLimitedResult()` | 限制结果集规模 |
| `resolveCommandSubstitution()` | 解析简单命令替换 |
| `resolveVariableValue()` | 解析简单变量引用 |
| `findVariableReference()` | 查找变量引用 |
| `expandStaticTextVariants()` | 展开静态变体 |
| `collectObfuscatedCandidateTokens()` | 收集混淆候选 token |
| `hasGlobMeta()` | 判断是否包含 glob |
| `findObfuscatedSystemAuthPath()` | 找混淆后的系统认证文件路径 |
| `findObfuscatedLynxPluginPath()` | 找混淆后的插件路径 |
| `findObfuscatedProtectedReferenceLabels()` | 找混淆后的保护标签引用 |

## 5. Runtime 目录

### `src/runtime/hook-capabilities.ts`

角色：运行时版本与 hook 能力探测。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `parseVersionPart()` | 解析单个版本段 | 比较版本前的基础处理 |
| `parseVersion()` | 解析版本字符串 | 生成可比较的版本数组 |
| `isVersionAtLeast()` | 比较版本是否达到下限 | 给 hook 能力判断服务 |
| `readOpenClawPackageVersion()` | 从包信息中读版本 | 运行时探测辅助 |
| `getOpenClawRuntimeVersion()` | 获取当前 OpenClaw 版本 | 优先环境变量，再尝试包信息 |
| `getHookCapabilityReport()` | 输出 hook 能力报告 | 告诉上层当前 runtime 是否支持相关 hook |

### `src/runtime/lynx-check-prompt.ts`

角色：`/lynx-check` prompt 注入模板层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `buildSharedInstructions()` | 构造手动/定时共用指令 | 约束模型输出完整报告 |
| `buildChannelInstructions()` | 构造渠道差异指令 | 区分 WebChat、Feishu、generic |
| `buildManualLynxCheckPrompt()` | 构造手动 prompt | 强调当前会话直出完整中文报告 |
| `buildScheduledLynxCheckPrompt()` | 构造定时 prompt | 强调完整性与定时场景 |
| `buildLynxCheckFallbackFailureNotice()` | 构造回传失败提示 | 给 fallback 失败场景兜底 |

### `src/runtime/lynx-check-run-store.ts`

角色：`/lynx-check` intent/result/report 状态存储层。

| 函数 | 作用 |
| --- | --- |
| `resolveRootDir()` | 解析 run store 根目录 |
| `ensureParentDirectory()` | 确保父目录存在 |
| `buildIntentPath()` / `buildResultPath()` | 计算状态文件路径 |
| `getLynxCheckRunResultPath()` | 获取 result 文件路径 |
| `getLynxCheckRunReportPath()` | 获取 report 文件路径 |
| `buildRequestId()` | 生成 run requestId |
| `normalizeRouteHint()` | 规范 route hint |
| `normalizeIntent()` | 校验/归一化 intent 结构 |
| `isPathWithinRoot()` | 判断路径是否越界 |
| `normalizeResultPath()` | 规范 reportPath 并防止越界 |
| `normalizeResult()` | 校验/归一化 result 结构 |
| `normalizeDeliveryAttempts()` / `normalizeDeliveryAttempt()` | 规范投递记录 |
| `writeJson()` | 写 JSON 文件 |
| `listIntentFiles()` | 枚举 intent 文件 |
| `writeIntent()` | 写 intent |
| `createLynxCheckRunIntent()` | 创建 run intent 并初始化 result |
| `readLynxCheckRunIntent()` | 读取指定 intent |
| `updateLynxCheckRunIntentStatus()` | 更新 intent 状态 |
| `markLynxCheckRunCompleted()` | 标记 run 完成 |
| `readLatestPendingLynxCheckRunIntent()` | 读取最新 pending/running run |
| `writeLynxCheckRunResult()` | 写 run result |
| `readLynxCheckRunResult()` | 读 run result |
| `delay()` | 轮询等待辅助 |
| `waitForLynxCheckRunResultSettled()` | 等待状态收敛 |

### `src/runtime/lynx-delivery-intent-store.ts`

角色：单独的投递意图存储层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `getDefaultLynxDeliveryIntentPath()` | 默认路径生成 | 放在 runtime home 下 |
| `resolveLynxDeliveryIntentPath()` | 解析实际路径 | 支持自定义与 `~` 展开 |
| `normalizeIntent()` | 规范 intent 数据 | 防止非法枚举值入库 |
| `writeLynxDeliveryIntent()` | 写投递意图 | 文件持久化 |
| `readLynxDeliveryIntent()` | 读投递意图 | 读取并归一化 |
| `clearLynxDeliveryIntent()` | 清空投递意图 | 清理旧状态 |

### `src/runtime/lynx-message-delivery.ts`

角色：报告投递主引擎。

| 函数 | 作用 |
| --- | --- |
| `isSameSession()` | 判断候选目标是否同会话 |
| `toTargetHint()` | 把 route hint 转成 target hint |
| `toCurrentTargetHint()` | 从当前 `ctx` 生成同会话候选目标 |
| `mergeCandidate()` | 合并投递候选 |
| `collectDeliveryCandidates()` | 汇总 routeHint、live targets、snapshots、session store 目标 |
| `extractFeishuLead()` | 提取飞书摘要头部 |
| `stripExistingFeishuLead()` | 去掉已有飞书摘要头 |
| `isMarkdownTableSeparator()` | 判断 markdown 表格分隔行 |
| `splitMarkdownTableRow()` | 拆表格行 |
| `flattenMarkdownTablesForFeishu()` | 把 markdown 表格压平为飞书友好文本 |
| `collapseExcessBlankLines()` | 折叠多余空行 |
| `trimAtLineBoundary()` | 按行截断文本 |
| `extractFeishuRemediationSection()` | 提取整改建议章节 |
| `shortenFeishuAuditForSafety()` | 在过长时对飞书文本做安全缩略 |
| `shapeTextForProvider()` | 针对 provider 整形文本 |
| `shapeMessageForProvider()` | 针对 provider 整形 message |
| `deliverToCandidate()` | 对单个候选尝试多种 transport |
| `deliverLynxReport()` | 投递总入口 |

### `src/runtime/lynx-webchat-delivery.ts`

角色：WebChat 专用投递适配层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `extractTextFromMessageContent()` | 从 message content 提取文本 | 兼容 string 和 block |
| `extractInjectableWebchatText()` | 提取可用于网关注入的文本 | 过滤不适合注入的结构 |
| `setLynxWebchatGatewayCallerForTests()` | 注入测试替身 | 便于 mock 网关调用 |
| `loadCallGatewayFromCli()` | 动态加载网关调用能力 | 运行时桥接 |
| `injectLynxWebchatReportViaGateway()` | 通过网关注入 WebChat 会话 | 作为 sendMessage 之外的 transport |

### `src/runtime/managed-lynx-check-authorization-store.ts`

角色：managed `/lynx-check` 预授权存储。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `getDefaultAuthorizationPath()` | 默认授权路径 |
| `resolveAuthorizationPath()` | 解析实际授权路径 |
| `writeAuthorization()` | 写授权文件 |
| `readManagedLynxCheckAuthorization()` | 读授权 |
| `grantManagedLynxCheckAuthorization()` | 授予授权 |
| `hasManagedLynxCheckAuthorization()` | 判断是否已授权 |
| `clearManagedLynxCheckAuthorization()` | 清理授权 |

### `src/runtime/message-decoration.ts`

角色：消息格式修饰层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `mergeDiscoveryReportText()` | 合并 discovery 报告文本 | 避免重复堆叠旧报告 |
| `decorateOutgoingMessage()` | 对字符串消息做统一装饰 | 预留前后缀入口 |
| `formatDiscoveryReport()` | 格式化 discovery 报告正文 | 套统一头部 |
| `appendDiscoveryReportToContent()` | 对纯文本追加报告 | 内容级操作 |
| `appendDiscoveryReportToMessage()` | 对 message 对象追加报告 | 兼容 block content |
| `decorateAssistantMessage()` | 修饰 assistant message | 供 `before_message_write` 使用 |

### `src/runtime/override-runtime.ts`

角色：override 与 pending store 的桥接层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `pruneApprovedOverrides()` | 清理过期已批准项 | 防止 override 内存泄漏 |
| `buildOperationFingerprint()` | 生成操作指纹 | 用于一次性重试放行 |
| `resolveOverrideKeys()` | 解析 session/channel 双 key | 保证不同上下文都可命中 |
| `resolveOverrideKey()` | 解析主 key | 优先 channelId |
| `savePendingOverrideFull()` | 把待确认项存到所有相关 key |
| `approvePendingOverrideFull()` | 把批准结果扩散到所有 key |
| `consumeApprovedOverrideFull()` | 消费一次性批准结果 |
| `inferBlacklistModules()` | 黑名单理由到模块名映射 |

### `src/runtime/pending-override-store.ts`

角色：短期待确认项存储。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `isExpired()` | 判断是否过期 | TTL 基础函数 |
| `pruneExpired()` | 清理过期项 | 每次读写前调用 |
| `savePendingOverride()` | 存待确认项 | 同 key 可合并模块信息 |
| `getPendingOverride()` | 只读待确认项 | 不消费 |
| `consumePendingOverride()` | 读并消费 | 确认短语场景使用 |
| `clearPendingOverride()` | 清理指定项 | 主动撤销 |
| `consumeMostRecentPendingOverride()` | 取最近一条 | fallback 场景用 |

### `src/runtime/plugin-runtime-helpers.ts`

角色：路径、字符串、上下文、报告信任判断的基础工具层。

关键函数已在 `04-runtime-delivery-state.md` 详述，这里不重复展开。

### `src/runtime/policy-runtime.ts`

角色：策略配置和文案拼装层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `normalizePolicyConfig()` | 标准化 policy 配置 | 补默认值并统一毫秒级窗口 |
| `buildApiRiskAssessment()` | 把 API 风险等级转成本地 RiskAssessment | 便于进入统一策略流 |
| `buildOverridePrompt()` | 生成确认提示 | 把阻断原因转成用户可执行动作 |
| `moduleDisplayName()` | 模块名转展示名 | 给汇总文案使用 |
| `buildParamSummary()` | 工具参数摘要 | 减少 audit log 噪音 |
| `formatWorkflowAuthSummary()` | 生成工作流授权总结 | 给 `agent_end` 发送回执 |

### `src/runtime/recent-active-delivery.ts`

角色：最近活跃投递目标快照层。

| 函数 | 作用 |
| --- | --- |
| `getDefaultRecentActiveDeliveryPath()` | 默认快照路径 |
| `resolveRecentActiveDeliveryPath()` | 解析快照路径 |
| `resolveSessionStorePaths()` | 解析 session store 路径列表 |
| `buildTargetKey()` | 生成 targetKey |
| `normalizeSnapshot()` | 归一化快照 |
| `normalizeSessionStoreSnapshot()` | 把 session store entry 转成投递快照 |
| `sortSnapshots()` | 排序快照 |
| `buildLiveTargetSender()` | 构造 live sender |
| `buildSnapshot()` / `buildSnapshotWithOptions()` | 从 ctx 生成快照 |
| `writeSnapshots()` | 写快照文件 |
| `readRecentActiveDeliverySnapshots()` | 读本地快照 |
| `readSessionStoreDeliverySnapshots()` | 读 session store 快照 |
| `readRecentActiveDeliverySnapshot()` | 读最新单条快照 |
| `rememberRecentActiveDeliveryTarget()` | 记录当前上下文 |
| `getRecentActiveDeliveryTargets()` | 获取可用 live target 列表 |
| `getRecentActiveDeliveryTarget()` | 获取最新 live target |
| `clearRecentActiveDeliveryTargetForContext()` | 删除当前上下文相关快照 |
| `shouldPreferRecentActiveDelivery()` | 判断 scheduled 是否优先 recent-active |
| `resetRecentActiveDeliveryTargets()` | 清空所有快照 |

### `src/runtime/scheduled-lynx-check.ts`

角色：cron store 幂等同步层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `resolveScheduledLynxCheckConfig()` | 标准化配置 | 合并默认值 |
| `buildScheduledLynxCheckJob()` | 生成 cron job record | 使用固定 job id |
| `reconcileScheduledLynxCheck()` | 同步 cron store | 插入、更新或移除 managed job |
| `getDefaultCronStorePath()` | 默认 cron store 路径 |
| `resolveStorePath()` | 解析实际 store 路径 |
| `loadCronStore()` | 读 jobs.json |
| `saveCronStore()` | 安全写回 jobs.json |

### `src/runtime/security-audit-runner.ts`

角色：TypeScript 到安全审计脚本的桥接层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `findScriptsDir()` | 找到 `SX-security-audit` 目录 |
| `findPython()` | 找可用 Python |
| `runSecurityAudit()` | 执行安全审计脚本 |
| `runMaliciousScriptScan()` | 执行恶意脚本扫描脚本 |
| `formatAuditSummary()` | 输出简短摘要 |

### `src/runtime/token-optimizer-runner.ts`

角色：TypeScript 到 token optimizer 脚本的桥接层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `findTokenOptimizerScriptsDir()` | 定位 token optimizer 资产目录 |
| `findPython()` | 找 Python |
| `runScript()` | 通用脚本执行器 |
| `recommendContext()` | 推荐最小上下文 |
| `recordFileAccess()` | 记录文件访问 |
| `getUsageStats()` | 获取使用统计 |
| `routeModel()` | 推荐模型档位 |
| `planHeartbeat()` | 规划 heartbeat 检查 |
| `recordHeartbeatCheck()` | 记录 heartbeat 执行 |
| `checkBudget()` | 获取预算状态 |
| `formatContextRecommendation()` | 格式化上下文建议 |
| `formatModelRouting()` | 格式化模型路由建议 |
| `formatBudgetStatus()` | 格式化预算状态 |
| `buildOptimizationHints()` | 拼出模型可读优化提示 |
| `shouldWarnForComputeAbuse()` | 判断是否存在算力滥用信号 |
| `hasHeavyContextSignals()` | 判断上下文负载是否过重 |
| `isTokenOptimizerAvailable()` | 判断脚本是否存在 |

### `src/runtime/workflow-authorization-store.ts`

角色：工作流级授权窗口存储。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `pruneExpired()` | 清理过期授权 |
| `grantWorkflowAuth()` | 开启授权窗口 |
| `getWorkflowAuth()` | 查询窗口是否覆盖当前模块 |
| `recordWorkflowOperation()` | 记录窗口期放行操作 |
| `revokeWorkflowAuth()` | 结束窗口并返回审计记录 |
| `hasAnyWorkflowAuth()` | 判断是否存在任何授权 |

## 6. Skill 与脚本目录

### `src/skills/skill-blacklist-data.ts`

角色：Skill 黑名单、内容模式和可信注册表的静态数据文件。

### `src/skills/skill-cleanup.ts`

角色：Skill 隔离与恢复层。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `getQuarantineDir()` | 获取隔离区目录 |
| `getToolsLogPath()` | 获取 `.lynx/TOOLS.md` 路径 |
| `getSkillsDir()` | 获取 Skills 根目录 |
| `quarantineSkill()` | 隔离 Skill |
| `removeSkill()` | 逻辑删除，实际优先隔离 |
| `updateOpenClawConfig()` | 清理 openclaw 配置中的相关项 |
| `logCleanupAction()` | 记录清理动作 |
| `cleanupFlaggedSkills()` | 批量处理问题 Skill |
| `listQuarantined()` | 列出已隔离 Skill |
| `restoreFromQuarantine()` | 从隔离区恢复 |

### `src/skills/skill-guard.ts`

角色：Skill 安全治理主入口。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `getBlacklistDiskPath()` | 远端黑名单磁盘缓存路径 |
| `getBlacklist()` | 获取合并黑名单 |
| `detectSkillInstall()` | 检测 Skill 安装行为 |
| `extractRepoName()` | 从 git clone 命令提取仓库名 |
| `checkMaliciousSkillBlacklist()` | 检查名字/模式/哈希是否命中 |
| `checkSkillAuthenticity()` | 校验是否为同名伪装 Skill |
| `scanSkillContent()` | 扫描 Skill 内容风险 |
| `assessSkillRisk()` | 总风险评估入口 |
| `buildRiskMessage()` | 生成可读风险消息 |
| `verifyAllInstalledSkills()` | 启动期完整性校验 |
| `quickBlacklistCheck()` | 快速静态黑名单检查 |

### `src/skills/skill-hash.ts`

角色：Skill 哈希与完整性校验底座。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `computeFileHash()` | 文件哈希 |
| `collectFiles()` | 递归收集目录文件 |
| `computeSkillHash()` | Skill 目录哈希 |
| `verifySkillIntegrity()` | 完整性校验 |

## 7. Hook、脚本与构建文件

### `hooks/lynx-guardian-sensitiveData/handler.ts`

角色：bootstrap 时注入 `SELF_IMPROVEMENT_REMINDER.md` 的 hook。

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `myHandler()` | 在 agent bootstrap 时注入虚拟提醒文件 | 把 Lynx 的安全经验沉淀机制显式带入会话 |

### `scripts/build.js`

角色：发布构建脚本。

实现步骤：

- 清理 `dist/`
- 跑 `tsup`
- 复制配置文件和 `hooks/skills`
- 改写 `dist/package.json`

### `scripts-dev/dev-sync-lib.mjs`

| 函数 | 作用 |
| --- | --- |
| `normalizeRelativePath()` | 统一相对路径格式 |
| `shouldStagePath()` | 判断某路径是否应该同步到容器 |
| `findStalePluginManagedDirectories()` | 找需清理的旧目录 |
| `resolveOpenClawHome()` | 解析 `.openclaw` 根目录 |
| `pickGatewayContainer()` | 选网关容器名 |
| `buildDevSyncPlan()` | 构造同步计划 |
| `assessGatewayLogs()` | 根据日志评估容器内插件是否 ready |

### `scripts-dev/ready-sync-lib.mjs`

| 函数 | 作用 |
| --- | --- |
| `shellQuote()` | shell 参数转义 |
| `extractContainerHealthStatus()` | 解析容器健康状态 |
| `hasGatewayReadyMarkers()` | 检测 ready markers |
| `collectGatewayReadyMarkerLines()` | 收集 ready 关键日志 |
| `buildReadySyncSuccessMessage()` | 生成 SUCCESS 文案 |
| `resolveCronStoreSyncPaths()` | 计算 cron store 路径 |
| `buildCronStoreContainsJobShellCommand()` | 生成 job 检查命令 |
| `buildCronStoreSyncShellCommand()` | 生成 cron store 复制命令 |

### `scripts-dev/sync-openclaw-dev.mjs`

| 函数 | 作用 |
| --- | --- |
| `parseArgs()` | 参数解析 |
| `printHelp()` | 打印帮助 |
| `runCommand()` | 子进程执行包装 |
| `listContainerNames()` | 读取容器列表 |
| `copyNamedDirectories()` | 同步宿主机 hooks/skills |
| `stagePlugin()` | 临时打包插件目录 |
| `logPlan()` | 打印同步计划 |
| `main()` | 执行完整 dev sync |

### `scripts-dev/sync-openclaw-dev-ready.mjs`

角色：带健康检查、ready marker、cron store 修复的 ready 版 dev sync 主流程。

关键函数包括：

- `parseArgs()`
- `parsePositiveInt()`
- `printHelp()`
- `runCommand()`
- `listContainerNames()`
- `resolveContainerName()`
- `readContainerStartedAt()`
- `readContainerStateStatus()`
- `readContainerHealthStatus()`
- `readLogsSince()`
- `runContainerShell()`
- `waitForHealth()`
- `waitForReadyMarkers()`
- `waitForGatewayReady()`
- `verifyCronStoreContainsJob()`
- `syncCronStore()`
- `restartGatewayAndWait()`
- `main()`

### `scripts-dev/verify-dev-sync.mjs`

角色：脚本库行为校验文件，没有复杂业务逻辑，主要验证 helper 输出。

## 8. 索引的使用建议

如果你准备做后续维护：

1. 改 hook 行为，先看 `index.ts` + 对应 runtime/guard 模块
2. 改 `/lynx-check`，先看 `manual-lynx-check.ts`、`lynx-check-run-store.ts`、`lynx-message-delivery.ts`
3. 改 Skill 安全，先看 `skill-guard.ts`、`skill-hash.ts`、`skill-cleanup.ts`
4. 改 Docker 验证流程，先看 `scripts-dev/*`
