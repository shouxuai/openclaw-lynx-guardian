# Lynx Guardian 源码地图

> 一句话版：这个插件像一支全天值班的小型安保队。`index.ts` 是总指挥，`guard/` 是门卫和审讯官，`discovery/` 是侦察兵，`skills/` 是缉私队，`runtime/` 是勤务与后勤，`utils.ts` 则像杂务中枢。

## 阅读范围

这份文档聚焦运行时代码与入口配置：

- `index.ts`
- `openclaw.plugin.json`
- `src/**/*.ts`

测试文件我在最后附了“测试职责速览”，帮助你知道每组测试在守哪道门，但不逐条展开每个 `it(...)`。

---

## 总体分工图

### 1. 指挥中心

- `index.ts`
  负责注册 OpenClaw 生命周期 hook，把所有能力串起来。

### 2. 情报与侦察

- `src/discovery/*`
  负责识别 `/lynx-check`，扫描 IP/端口，拼装服务发现报告。

### 3. 安全防线

- `src/guard/*`
  负责识别提示词注入、系统提示泄露、越权修改、凭证窃取、恶意代码请求。

### 4. 运行时后勤

- `src/runtime/*`
  负责消息装饰、上下文归一化、调用 Python 审计脚本、调用 token 优化脚本。

### 5. Skill 缉私队

- `src/skills/*`
  负责 Skill 安装检测、黑名单、内容扫描、完整性校验、隔离与恢复。

### 6. 公共工具与协议

- `src/api.ts`
- `src/blacklist.ts`
- `src/config.ts`
- `src/types.ts`
- `src/utils.ts`

这些文件提供公共 API、规则匹配、基础配置、类型协议、磁盘和网络工具能力。

---

## 入口层

## `openclaw.plugin.json`

### 文件作用

这是插件的“身份证 + 说明书 + 配置菜单”。OpenClaw 会先看它，知道这个插件叫什么、版本多少、有哪些配置项。

### 重点内容

- `id` / `name` / `version`
  标识插件身份。
- `description`
  用自然语言说明插件主打什么安全能力。
- `configSchema`
  告诉 OpenClaw 前端和运行时：这个插件有哪些可配置项、类型是什么、默认值是什么。

### 你可以把它想成

像商场门口的总导览牌。人还没进场，先知道里面有哪些区域、每个区域开不开门、能调哪些开关。

---

## `index.ts`

### 文件作用

整个插件的“总控室”。它不自己做复杂检测，而是把各个模块在正确的生命周期里接起来。

### 核心职责

- 初始化用户 ID、资源同步、运行时配置。
- 启动安全审计、Skill 完整性检查、Token Optimizer。
- 注册 OpenClaw 的各类 hook。
- 在合适的时机阻断、警告、补充报告、修饰消息。

### 方法说明

#### `setup(api)`

这是唯一导出的入口函数，也是整座楼的值班总指挥。

它做的事可以拆成几层：

- 初始化层
  - 创建日志对象。
  - 创建 `SensitiveDataBlocker`。
  - 读取 `selfSafetyGuard`、`securityAudit`、`skillGuard`、`tokenOptimizer`、discovery 运行时配置。
  - 准备 discovery 报告暂存文件路径。

- 启动自检层
  - `ensureUserRegistered()`：保证本机有用户 ID。
  - `registerUser()`：把用户 ID 注册到后端。
  - `ensureResources()`：把插件自带的 `hooks/`、`skills/` 同步到 `~/.openclaw/`。
  - `loadDiscoveryRuntimeConfig()`：读 discovery 配置，必要时生成默认配置。

- 启动异步任务层
  - `runSecurityAudit()`：跑安全审计。
  - `runMaliciousScriptScan()`：扫 Skills 里的恶意脚本。
  - `verifyAllInstalledSkills()`：校验所有已安装 Skill 的哈希完整性。
  - `checkBudget()` / `planHeartbeat()`：启动 token 优化相关检查。

- 生命周期注册层
  - `gateway_start`
    网关重启时再次同步资源，确保插件内的 hook/skill 可以自动复制到 OpenClaw 环境。
  - `message_received`
    在用户消息刚进来时，做敏感数据检测和输入安全检测。
  - `before_agent_start`
    在模型正式开始工作前，补充风险提示、触发 `/lynx-check`、拼接 token 优化建议、调用后端内容风控。
  - `agent_end`
    在模型输出结束后，做输出泄露检测、后端输出风控，以及 discovery 报告兜底发送。
  - `before_message_write`
    在消息落库或落会话前，给 assistant 消息做最终修饰，把 discovery 报告拼到原始输出里。
  - `before_tool_call`
    在工具调用前，做工具安全拦截、Skill 安装安全检测、黑名单与后端风控。

### 你可以把它想成

像一位总控台调度员，自己不扛枪冲前线，但所有门卫、巡逻兵、扫描器、广播员，都是它按时派出去的。

---

## 公共基础层

## `src/config.ts`

### 文件作用

插件的“小配置常量仓库”。

### 内容说明

- `CONFIG.API_BASE_URL`
  后端安全服务地址。
- `CONFIG.CACHE_DIR`
  插件缓存目录。
- `CONFIG.ID_FILE`
  用户 ID 的保存文件名。

### 你可以把它想成

像办公室抽屉里的便签纸，写着“后端在哪儿”“缓存放哪儿”“工牌放哪儿”。

---

## `src/types.ts`

### 文件作用

整个插件的“共同语言手册”。定义插件和 OpenClaw 之间传什么数据、每个 hook 长什么样。

### 主要类型说明

- `Logger`
  插件日志接口。
- `PluginConfig`
  插件可读到的配置结构。
- `ContentBlock` / `Message`
  消息块和消息结构。
- `EventContext`
  hook 上下文，包含 `sessionKey`、`sendMessage` 等能力。
- `ToolCallEvent` / `MessageReceivedEvent` / `AgentStartEvent` / `AgentEndEvent` / `GatewayStartEvent`
  各类生命周期事件结构。
- `MessageSendingEvent` / `BeforeMessageWriteEvent`
  发送前和写入前事件结构。
- `MessageSendingResult` / `BeforeMessageWriteResult`
  对应 hook 的返回结构。
- `PatternRule`
  正则规则对象，供敏感词/模式检测复用。
- `HookApi` / `OpenClawPluginApi`
  插件运行时 API 协议。

### 你可以把它想成

像片场通告单。谁什么时候上场、说什么台词、道具长什么样，都先在这里约定好。

---

## `src/api.ts`

### 文件作用

这是插件通往远端安全服务的“外交官”。它本身不做安全判断，而是把本地收集到的信息发给后端。

### 方法说明

#### `safeFetch(url, options)`

内部通用请求器。

- 负责统一超时控制。
- 负责检查 HTTP 状态码。
- 负责解析 JSON。

它像前台总机，把所有出站请求都走同一个规范，不让某个接口自己乱来。

#### `registerUser(id)`

向后端登记当前用户 ID。

作用：让后端知道“这台插件实例是谁”。

#### `checkContent(id, content, contentType)`

把文本内容送给后端做内容风险检查。

- `contentType = 1`
  输入内容。
- `contentType = 2`
  输出内容。

#### `checkTool(id, content)`

把工具调用描述送给后端做工具风险评估。

用途：当本地黑名单已经觉得有点危险时，再让后端来做第二道裁决。

#### `pushRecord(id, content, riskLevel)`

把本地发现的风险事件上报到后端。

作用：相当于“记案底”。

#### `checkPublicAccess(id, publicIP, port)`

让后端判断某个 IP:端口 是否暴露在公网。

用于 `/lynx-check` 里的公网暴露检测。

#### `fetchMaliciousSkillBlacklist()`

从后端拉远端 Skill 黑名单。

作用：让本地黑名单不是死表，而是能补充新情报。

#### `checkSkill(id, skillName, skillHash)`

把某个 Skill 的名称和哈希送给后端检查。

作用：把本地 Skill 安全判断再交给远端安全服务复核。

---

## `src/blacklist.ts`

### 文件作用

这是插件的“硬规则警棍”。不靠模型、不靠后端，只靠正则规则做快速高确定性的危险命令/路径识别。

### 规则区说明

- `CRITICAL_EXEC`
  致命命令规则，比如删系统盘、反向 shell、下载执行。
- `CRITICAL_PATH`
  致命写路径规则，比如写 `/etc/passwd`。
- `WARNING_EXEC`
  风险但未必必死的命令规则，比如 `sudo`、`chmod 777`。
- `WARNING_PATH`
  风险路径规则，比如写 `/etc/`。
- `SAFE_EXEC`
  白名单规则，比如 `git status`、`npm run build`。

### 方法说明

#### `isQuotedOrCommented(text, matchIndex)`

内部小法官。

作用：判断命中的危险片段，是不是只是出现在引号里或注释里，避免误报。

#### `matchRules(text, rules, level)`

内部匹配器。

作用：按顺序检查一组规则，命中就返回对应风险信息。

#### `splitCommand(cmd)`

内部分段器。

作用：把 `&&`、`||`、`;`、`|` 分隔的命令拆开，但不误拆引号里的内容。

#### `checkExecBlacklist(command)`

对 `exec` 命令做黑名单检测。

它分两阶段：

- 先检查整条命令
  用于识别 `curl | bash` 这种跨分段攻击。
- 再拆段检查
  逐段对照 critical / warning / safe 规则。

#### `checkPathBlacklist(filePath)`

对写入或编辑路径做黑名单检测。

主要防止模型直接往系统敏感路径写东西。

### 你可以把它想成

像一个脾气很直的老门卫：看见 `rm -rf /` 这种动作，根本不谈判，先把门关上。

---

## `src/utils.ts`

### 文件作用

这是全项目的“工具箱 + 保洁间 + 电工箱”。很多不属于某个单一业务模块的能力都在这里。

### 方法说明

#### `getCacheDir()`

返回插件缓存目录。

#### `getUserIdFile()`

返回用户 ID 文件完整路径。

#### `generateUserId()`

生成 Lynx 用户 ID。

格式是固定前缀 + 日期 + 随机数，方便识别和追踪。

#### `ensureUserRegistered()`

确保本地已有用户 ID。

- 有就直接读。
- 没有就生成并写入磁盘。

#### `resolveSessionsDir()`

内部函数。

作用：定位 OpenClaw session 日志目录，用于后续提取上下文。

#### `readRecentContext(_sessionKey?)`

读取最近 session 里的用户消息摘要。

用途：在工具风控时，把最近上下文拼给后端，帮助判断这次工具调用是不是危险。

#### `copyFolderRecursiveSync(source, target)`

递归复制目录。

#### `syncNamedDirectories(sourceRoot, targetRoot)`

同步某个根目录下的所有子目录。

当前主要用于把插件自带的 `hooks/`、`skills/` 子目录同步到 OpenClaw 用户目录。

#### `ensureResources()`

这是资源同步总入口。

作用：

- 确保 `~/.openclaw/hooks` 和 `~/.openclaw/skills` 存在。
- 自动寻找插件根目录。
- 将插件内置 `hooks/`、`skills/` 同步过去。

这就是你前面提到“网关重启自动 cp 同步 hook”的关键实现点。

#### `getOpenClawPort()`

读取 `~/.openclaw/openclaw.json` 里的 gateway 端口。

读不到就默认 `18789`。

#### `isPrivateIp(ip)`

判断一个 IPv4 是否属于内网地址。

#### `ipv4ToNumber(ip)`

把 IPv4 转成数字，便于网段计算。

#### `numberToIpv4(value)`

把数字还原成 IPv4。

#### `netmaskToPrefix(netmask)`

把子网掩码转换成 CIDR 前缀长度。

#### `buildIpv4Cidr(address, netmask)`

根据 IP + 子网掩码计算网段 CIDR。

#### `listLocalSubnetCidrs()`

枚举本机所有内网 IPv4 网段。

用途：给 discovery 模块自动补扫描目标。

#### `hasCommand(command)`

判断系统里有没有某个命令。

#### `requestTextByCurl(url, timeout, useProxy)`

优先使用 `curl` 拉文本。

#### `requestTextByHttp(url, timeout)`

如果没有 `curl`，退回 Node 内置 http/https 请求。

#### `requestText(url, timeout, useProxy)`

统一请求入口，先 `curl`，不行再 http。

#### `getPublicIpFromService()`

依次询问多个公共 IP 服务，拿到公网 IP。

#### `isProcessRunning(processName)`

检查某个进程是否正在运行。

#### `resolveHostIp(host)`

做 DNS 解析，拿到主机 IPv4。

#### `extractHost(urlOrHost)`

从 URL 或主机字符串里提取 host。

#### `detectNgrok()`

检测本机是否在跑 ngrok，并尽可能拿到公开域名和 IP。

#### `detectFrp()`

检测本机是否在跑 frp，并尝试解析配置中的 server 地址。

#### `getLocalIpFromInterfaces()`

从系统网卡列表里找一个本机可用 IPv4。

#### `getLocalIpByIpconfig(interfaceName)`

在 macOS 上用 `ipconfig getifaddr` 取网卡 IP。

#### `getLocalIp()`

综合获取本机局域网 IP。

#### `getIpAdress()`

综合判断“对外该用哪个地址”：

- 优先 ngrok
- 再看 frp
- 再查公网 IP
- 最后退回本机 IP

#### `baseIpInfo()`

这是 `/lynx-check` 前置情报的关键函数。

作用：

- 看 OpenClaw 端口有没有监听。
- 判断是监听在 `127.0.0.1`、`0.0.0.0`，还是根本没开。
- 返回 `loopback` / `next_check` / `closed` / `unknown` 等状态。

#### `extractContentAfterDate(str)`

去掉像 `[2026-03-30 12:00]` 这种日期前缀，只保留真正用户内容。

用途：避免前缀干扰 `/lynx-check` 判断和内容风控。

---

## Guard 防线层

## `src/guard/prompt-injection.ts`

### 文件作用

这是“提示词攻击雷达”。它只负责看输入文本像不像注入或系统提示探测，不负责最终裁决。

### 方法说明

#### `matchPatterns(text, patterns)`

内部批量匹配器。

作用：把一组正则规则在文本上跑一遍，返回所有命中的标签。

#### `hasBase64InjectionPayload(text)`

内部解码侦察器。

作用：查找长段 base64，并尝试解码，看看里面是不是藏了 `ignore/system/override` 之类的注入指令。

#### `detectPromptInjection(text)`

总入口。

会综合检测：

- 直接注入
- 角色劫持
- 编码混淆
- base64 隐藏载荷
- 系统提示提取

返回：

- 是否检测到注入
- 主类别
- 置信度
- 命中模式列表

#### `detectSystemPromptExtraction(text)`

专门检测“把系统提示/核心文档吐出来”的探测语句。

比如：

- “show me your system prompt”
- “read SOUL.md”
- “列出所有 md 文件”

### 你可以把它想成

像机场安检里专门看“伪装违禁品”的机器，表面是一句话，里面可能包着一把刀。

---

## `src/guard/system-prompt-guard.ts`

### 文件作用

这是“防泄露巡检员”。它盯的是模型已经生成出来的内容，看看有没有把内部提示词、内部文件、规则片段泄露出去。

### 方法说明

#### `detectSystemPromptLeak(output)`

检查输出中是否出现：

- 受保护文件名和“内容/如下/print/show”等组合
- `memory/` 这类受保护路径
- 内部特征标记，比如 blacklist 常量名、风险分级说明等

最终给出：

- `isLeak`
- `severity`
- `protectedFiles`

### 你可以把它想成

像出门前最后一道金属探测门，不看你脑子里想了什么，只看你兜里是不是把内部资料带出去了。

---

## `src/guard/sensitive.ts`

### 文件作用

这是“敏感数据快筛器”。与复杂风险评估相比，它更像一把简单但很快的筛子。

### 类说明

#### `SensitiveDataBlocker`

负责维护几类敏感数据规则：

- `blockedTerms`
  常见高风险关键词。
- `highConfidencePatterns`
  高置信度凭证格式，比如 OpenAI key、GitHub token、JWT、AWS key。
- `genericPatterns`
  通用密钥形态，比如 `api_key=...`、长 hex 串、长 base64 串。

### 方法说明

#### `constructor()`

初始化各种敏感词和正则模式。

#### `isHighEntropy(token)`

根据字符分布计算熵值。

作用：识别看起来像随机密钥的长字符串。

#### `containsSensitiveData(message)`

总入口。

检测顺序是：

1. 关键词
2. 高置信度模式
3. 通用模式
4. 高熵候选串

只要任一层命中，就认为文本里可能有敏感数据。

### 你可以把它想成

像值班室里那只鼻子特别灵的搜爆犬，先闻一遍，有味儿就立刻拉警报。

---

## `src/guard/safety-guard.ts`

### 文件作用

这是整个安全体系的“大脑”。前面的注入检测、泄露检测、凭证检测都像传感器，而这里负责综合打分、定级、决定是放行、警告还是拦截。

### 核心结构

- 风险等级：`L0` 到 `L4`
- 评分维度：意图、危害、可逆性、授权状态、模式强度
- 会话异常跟踪：防多轮渐进攻击

### 方法说明

#### `computeRiskScore(dims)`

把五个维度相加，得到基础风险分。

#### `scoreToLevel(score)`

把分数映射到 `L0-L4`。

#### `levelToAction(level)`

把风险等级映射成动作：

- `allow`
- `log`
- `warn`
- `block`
- `deny`

#### `levelRank(level)`

给风险等级排序，便于比较高低。

#### `maxLevel(current, next)`

在两个等级中取更高的那个。

#### `minScoreForLevel(level)`

返回某个等级对应的最低分。

#### `applyMinimumLevel(score, minLevel)`

如果某个模块要求“至少 L3/L4”，就把分数抬到对应下限。

#### `evictStaleSessions()`

清理过期会话状态，避免内存越积越多。

#### `getSessionState(sessionKey)`

获取或初始化某个会话的异常跟踪状态。

#### `computeAnomalyAdjustment(sessionKey, baseScore, triggeredModules)`

根据会话历史做附加加分。

它会关注：

- 是否连续三轮风险升级
- 是否一次命中多个模块
- 是否多次试探同一被拒主题

#### `detectIdentityClaims(text)`

检测“我是管理员/我是主人/我是开发者”等身份宣称。

#### `detectProtectedFileAccess(text, toolName?)`

检测是否在尝试读取或修改：

- `SOUL.md`
- `AGENTS.md`
- `MEMORY.md`
- `openclaw.json`
- `openclaw.plugin.json`

并区分是 `read` 还是 `write`。

#### `detectCredentialTheft(text)`

检测是否在查 `.env`、SSH 密钥、AWS 凭证、密码字样等。

#### `detectOverAgency(text)`

检测是否要求模型：

- 改自己的安全配置
- 关停安全模块
- 提权
- 修改核心提示文件

#### `detectMaliciousCodeRequest(text)`

检测是否在请求病毒、木马、勒索、phishing、exploit、botnet 等恶意代码。

#### `hasLegalSecurityContext(text)`

识别“这是授权测试/CTF/安全研究”的上下文，为双用途请求降一点级。

#### `checkFatalTriangle(toolName, params, _inputText?)`

检查著名“致命三角”：

- 访问敏感数据
- 从不可信来源输入
- 向外部输出

三者撞在一起时，风险会骤升。

#### `guardInput(text, sessionKey?, context?)`

输入安全总入口。

综合 M0/M1/M2/M3/M5/M6 各类模块结果，再结合 session 异常和 owner 验证状态，给出最终决策。

这是 `message_received` 和 `before_agent_start` 最核心的裁决器。

#### `guardOutput(output)`

输出安全总入口。

主要看系统提示或核心配置是否泄露。

#### `guardToolCall(toolName, params, sessionKey?, context?)`

工具调用安全总入口。

重点盯：

- 核心文件访问
- 凭证窃取
- 过度代理
- 致命三角

#### `buildDescription(modules, level)`

把内部模块名翻译成人类可读的风险说明。

#### `clearSessionState(sessionKey)`

清除某个会话的异常状态。

主要用于测试或重置。

### 你可以把它想成

像安保中心的总分析台。前方摄像头、红外、门磁、巡逻报告都来了，它来决定“只是记一笔”还是“立刻拉闸”。

---

## Discovery 侦察层

## `src/discovery/discovery-runtime-config.ts`

### 文件作用

这个文件负责“给 discovery 模块找配置、补默认配置”。

### 方法说明

#### `findPluginRoot()`

内部定位器。

作用：向上查找，找到包含 `openclaw.plugin.json` 的插件根目录。

#### `getDiscoveryRuntimeConfigPath()`

返回 discovery 运行时配置文件路径，也就是插件根目录下的 `lynx-discovery.config.json`。

#### `readJsonFile(filePath)`

安全读取 JSON，失败返回 `null`。

#### `writeDefaultConfig(filePath)`

写入默认 discovery 配置。

#### `loadDiscoveryRuntimeConfig()`

总入口。

职责：

- 若配置文件不存在，尝试自动生成默认文件。
- 若文件存在，读取并与默认值合并。
- 若文件损坏，记录 warning 并回退默认配置。

### 你可以把它想成

像侦察队出发前的装备管理员，先检查“地图带没带、坏没坏、没有就现场补一张”。

---

## `src/discovery/discovery-hook-utils.ts`

### 文件作用

它是 discovery 和 hook 系统之间的“接线员”。本身不深度扫描网络，而是负责识别用户意图、补出目标列表、调用扫描器。

### 方法说明

#### `hasKeyword(text, keywords)`

内部函数。

作用：判断文本是否包含一组关键词中的任意一个。

#### `isManualDiscoveryRequest(text)`

判断用户是不是在触发手动服务检测。

支持：

- `/lynx-check`
- `/check`
- `openclaw-check`
- 中文语义组合，如“检测 OpenClaw 服务 IP 端口”

#### `resolveDiscoveryTargets(config)`

组装要扫描的目标。

来源包括：

- 配置里显式写的 targets
- `127.0.0.1:port`
- `localhost:port`
- 当前检测到的本机/公网 IP
- 本地子网 CIDR

#### `runDiscoveryAndNotify(log, _ctx, discoveryConfig, discoveryRuntimePath)`

手动触发 discovery 的总入口。

职责：

- 算出目标列表
- 打日志说明扫描模式
- 调 `discoverOpenClaw()`
- 把结果格式化成摘要文本返回

### 你可以把它想成

像通讯兵，先听懂“要不要出警”，再把巡逻目标发给真正的侦察队。

---

## `src/discovery/openclaw-discovery.ts`

### 文件作用

这是 discovery 系统里的“野外侦察兵主力”。它真的去扫 IP、端口、HTTP 响应、WebSocket、特征头和路径。

### 方法说明

#### `getConfidenceLabel(score)`

把指纹分数转换成“确认 / 高度疑似 / 疑似 / 可能 / 未知”等描述。

#### `uniquePorts(ports?)`

清洗端口列表，去掉重复和非法端口。

#### `clamp(value, fallback, min, max)`

把配置值夹在合法范围内，防止超界。

#### `isIpv4(value)`

判断字符串是不是合法 IPv4。

#### `ipToNumber(ip)`

IPv4 转数字。

#### `numberToIp(value)`

数字转 IPv4。

#### `expandIpv4Cidr(target, maxHosts)`

把 CIDR 网段展开成主机列表。

如果主机太多，会返回空数组来避免把扫描炸穿。

#### `parseHostTarget(rawTarget, maxHosts, warnings)`

把用户输入目标解析成内部 `HostTarget`：

- CIDR
- URL
- host:port
- 普通 host

#### `asyncPool(items, maxConcurrency, worker)`

并发控制器。

作用：限制同时扫描的主机数和端口数，别把自己先扫崩。

#### `normalizeHeaders(headers)`

把 HTTP 响应头整理成统一小写对象。

#### `performRequest(scheme, host, port, path, timeoutMs, headers?)`

最底层 HTTP/HTTPS 请求执行器。

支持：

- 普通 GET
- 超时控制
- 升级响应处理

#### `httpGet(host, port, path, timeoutMs, preferredScheme?)`

高级 GET 封装。

会按 `http/https` 顺序尝试，拿到能通的响应。

#### `checkWebSocket(host, port, timeoutMs, preferredScheme?)`

检查目标是否支持 WebSocket 升级。

#### `checkTcpPort(host, port, timeoutMs)`

纯 TCP 探活。

作用：先确认端口开没开，再决定要不要做更贵的 HTTP 指纹识别。

#### `tcpScanPorts(host, ports, timeoutMs, maxConcurrency)`

批量扫描一组端口。

#### `buildFullPortList()`

生成 `1..65535` 全端口列表。

用于 full scan 模式。

#### `fingerprintOpenClaw(target, port, timeoutMs)`

这是真正的“指纹识别器”。

它会：

- 请求根路径
- 看 body 里有没有 `openclaw`
- 看 header 里有没有相关特征
- 探测若干健康检查路径
- 探测 WebSocket
- 计算总分与置信等级

#### `scanTarget(target, config)`

扫描单个目标：

- 如果目标带显式端口，就直接指纹识别。
- 否则先做端口探活，再逐端口指纹识别。

#### `sortHits(hits)`

按分数、主机、端口排序结果。

#### `normalizeHitHost(host)`

把 `localhost` / `::1` 这类回环地址统一成 `127.0.0.1`。

#### `dedupeHits(hits)`

按主机 + 端口 + 协议去重，保留更优命中，并合并特征。

#### `discoverOpenClaw(config = {})`

整个 discovery 的总入口。

负责：

- 规范化配置
- 展开目标
- 并发扫描
- 去重与排序
- 返回最终报告

#### `formatDiscoverySummary(report)`

把扫描结果变成可读文本摘要。

会输出：

- 扫描目标数
- 命中数
- 已确认服务
- 高度疑似服务
- 低置信度候选
- warnings

### 你可以把它想成

像一支夜巡小队，先敲门看有没有人，再掀窗帘看室内布局，最后根据门牌、口音、家具判断“这家是不是 OpenClaw”。

---

## `src/discovery/manual-lynx-check.ts`

### 文件作用

这是 `/lynx-check` 专属“报告编辑部”。它不亲自做所有检测，而是把公网暴露、恶意脚本、Skill 完整性、服务发现这些结果排版成 WebChat 友好的总报告。

### 方法说明

#### `stateBadge(state)`

把 `PASS/WARN/FAIL` 转成带视觉感的徽章文字。

#### `renderSection(section)`

把单个报告章节渲染成 Markdown 文本。

#### `formatPublicAccessSection(ipInfo, publicAccessResult)`

把公网暴露检查结果变成一个章节。

会根据：

- `next_check`
- `loopback`
- `closed`
- `unknown`

输出不同文案。

#### `formatMaliciousScriptSection()`

调用恶意脚本扫描，并把结果变成报告章节。

#### `formatSkillIntegritySection()`

调用 Skill 完整性校验，并把结果变成报告章节。

#### `extractDiscoveryTargets(discoverySummary)`

从 discovery 摘要文本里把 `IP:端口` 提取出来。

#### `formatDiscoverySection(discoverySummary)`

把服务发现结果渲染成报告章节，并把原始 discovery 文本附在后面。

#### `renderOverview(sections)`

把所有章节先压缩成一个总览清单。

#### `buildManualLynxCheckReport(options)`

总入口。

职责：

- 必要时补做公网暴露检查
- 分别生成四类章节
  - 公网暴露
  - 恶意脚本扫描
  - Skill 完整性
  - 服务发现 IP/端口
- 输出一份适合 WebChat 阅读的综合 Markdown 报告

### 你可以把它想成

像新闻编辑部的总编，把前线记者传回来的碎片信息，排成一篇真正能看的头版专题。

---

## Runtime 运行时层

## `src/runtime/plugin-runtime-helpers.ts`

### 文件作用

这是一组“细小但关键的运行时胶水函数”。

### 方法说明

#### `canonicalizePath(raw)`

把用户传进来的路径标准化：

- 展开 `~/`
- 绝对化
- 归一化

主要防止路径黑名单绕过。

#### `normalizeString(value)`

把未知值整理成干净字符串。

#### `normalizeStringList(value)`

把未知值整理成干净字符串数组。

#### `buildGuardContext(config, event, ctx)`

把配置、事件、上下文里的身份信息整理成 `GuardContext`。

重点是算出：

- `requesterId`
- `channel`
- `verifiedOwner`

#### `redactAgentOutput(event, replacement)`

尽力原地改写 agent 输出内容。

用于检测到输出泄露时，把原输出替换成安全占位文案。

### 你可以把它想成

像后台场务，虽然不露脸，但演员每次上场前的麦克风、名牌、走位，都是它悄悄整理好的。

---

## `src/runtime/message-decoration.ts`

### 文件作用

这是“消息妆造师”。负责给 assistant 文本加前后缀、拼接 discovery 报告、避免重复堆叠。

### 常量说明

- `OUTBOUND_MESSAGE_PREFIX`
  assistant 输出前缀，现在为空。
- `OUTBOUND_MESSAGE_SUFFIX`
  assistant 输出后缀，现在为空。
- `DISCOVERY_REPORT_HEADER`
  discovery 报告头部模板。

### 方法说明

#### `mergeDiscoveryReportText(content, report)`

内部合并器。

作用：

- 如果报告已经存在，不重复叠加。
- 如果已有旧报告，替换掉旧报告。
- 否则追加到末尾。

#### `decorateOutgoingMessage(content)`

对普通字符串输出加前后缀。

#### `formatDiscoveryReport(content)`

给 discovery 原文套上统一报告头。

#### `appendDiscoveryReportToMessage(message, report)`

把 discovery 报告拼接进 assistant 消息。

兼容：

- `message.content` 是字符串
- `message.content` 是 block 数组

#### `decorateAssistantMessage(message)`

给 assistant 消息整体做前后缀修饰。

若是 block 数组，会给第一个文本块加前缀、最后一个文本块加后缀。

### 你可以把它想成

像演出结束前负责谢幕字幕的人，台词不改剧情，但会让最后呈现出来的样子更完整、也更像一份正式答卷。

---

## `src/runtime/security-audit-runner.ts`

### 文件作用

这是 TypeScript 到 Python 安全审计脚本之间的“翻译官”。

### 方法说明

#### `findScriptsDir()`

寻找 `SX-security-audit` 技能脚本目录。

#### `findPython()`

寻找可用 Python 解释器。

#### `runSecurityAudit(checks?, severity?)`

调用 `security_audit.py`，执行完整安全审计。

输出会被解析成结构化 `AuditReport`。

#### `runMaliciousScriptScan()`

调用 `malicious_script_scanner.py`，扫描 Skills 目录中的恶意脚本风险。

并把原始文本结果解析为结构化 `ScanFinding[]`。

#### `formatAuditSummary(report)`

把审计报告转成适合日志或展示的摘要字符串。

### 你可以把它想成

像前线特勤和总控室之间的对讲机。真正搜楼的是 Python 小队，这个文件负责把搜楼结果清晰地带回来。

---

## `src/runtime/token-optimizer-runner.ts`

### 文件作用

这是 TypeScript 到 token 优化脚本之间的“节流指挥官”。

它负责四件事：

- 上下文裁剪建议
- 模型路由建议
- 心跳检查计划
- 预算监控

### 方法说明

#### `findTokenOptimizerScriptsDir()`

寻找 `SX-openclaw-token-optimizer` 技能脚本目录。

#### `findPython()`

寻找 Python 解释器。

#### `runScript(scriptName, args, timeoutMs = 30000)`

内部统一脚本执行器。

负责：

- 找脚本
- 找 Python
- 执行
- 解析 JSON 结果

#### `recommendContext(prompt, currentFiles?)`

给某个 prompt 生成“该加载哪些上下文文件”的建议。

#### `recordFileAccess(filePath)`

记录某文件被访问过，用于后续上下文热度统计。

#### `getUsageStats()`

读取上下文文件使用统计。

#### `routeModel(prompt, currentModel?, forceTier?, provider?)`

根据任务复杂度建议使用更省钱或更合适的模型档位。

#### `planHeartbeat(checks?)`

生成心跳检查计划，决定哪些检查现在跑、哪些可以延后。

#### `recordHeartbeatCheck(checkType)`

记录某次心跳检查已执行。

#### `checkBudget()`

读取当日 token 预算使用情况。

#### `formatContextRecommendation(rec)`

把上下文建议格式化成简洁日志。

#### `formatModelRouting(routing)`

把模型路由建议格式化成简洁日志。

#### `formatBudgetStatus(budget)`

把预算状态格式化成简洁日志。

#### `buildOptimizationHints(context?, routing?, budget?)`

把多种优化建议拼成可直接注入到 agent context 的提示串。

#### `isTokenOptimizerAvailable()`

检查 token optimizer 脚本是否存在。

### 你可以把它想成

像财务总监兼调度员：这个任务值不值得上大模型？要不要少带几份上下文？今天钱花得太快没？

---

## Skills 安全层

## `src/skills/skill-blacklist-data.ts`

### 文件作用

这是 Skill 安全模块的“情报档案库”。

### 内容说明

- `MaliciousSkillEntry`
  恶意 Skill 条目结构。
- `MALICIOUS_SKILL_BLACKLIST`
  名称、命名模式、已知恶意标识。
- `ContentPattern`
  Skill 内容扫描规则结构。
- `MALICIOUS_SKILL_CONTENT_PATTERNS`
  `SKILL.md` 或其他 markdown 中的恶意内容模式。
- `TrustedSkillEntry`
  可信 Skill 基线结构。
- `TRUSTED_SKILL_REGISTRY`
  可信 Skill 名单与哈希基线。

### 你可以把它想成

像缉私科的黑名单册子，谁是假证、谁爱改名、谁有前科，都先记在案。

---

## `src/skills/skill-hash.ts`

### 文件作用

这是 Skill 完整性校验的“指纹实验室”。

### 方法说明

#### `computeFileHash(filePath)`

计算单个文件的 SHA-256。

#### `collectFiles(dirPath, basePath)`

递归收集 Skill 目录下所有文件的相对路径，并按稳定顺序排序。

#### `computeSkillHash(skillPath)`

计算整个 Skill 目录的 SHA-256。

它不仅哈希内容，还把相对路径也喂进去，因此重命名也能被识别。

#### `verifySkillIntegrity(skillPath, expectedHash)`

对比当前哈希与期望哈希，判断 Skill 是否被改动。

### 你可以把它想成

像法医做指纹比对。看起来是同一个人，不代表真的没动过手脚。

---

## `src/skills/skill-guard.ts`

### 文件作用

这是 Skill 安全体系的“海关总署”。

它负责：

- 识别是不是在安装 Skill
- 判断 Skill 名字和内容是否危险
- 校验 Skill 是否被篡改或冒名顶替
- 给出最终风险结论

### 方法说明

#### `getBlacklistDiskPath()`

返回本地磁盘缓存的 Skill 黑名单文件路径。

#### `getBlacklist(fetchRemote?)`

获取合并后的黑名单：

- 内置本地黑名单
- 内存缓存
- 磁盘缓存
- 可选远端黑名单

#### `detectSkillInstall(toolName, params)`

判断一次工具调用是不是在安装 Skill。

支持识别：

- `openclaw install ...`
- `cp/rsync` 复制到 `~/.openclaw/skills`
- `git clone` 到 skills 目录
- 直接 `write/edit` 到 skills 目录

#### `extractRepoName(command)`

从 `git clone` 命令里提取仓库名。

#### `checkMaliciousSkillBlacklist(name, blacklist, hash?)`

根据名称、名称正则或哈希，检查 Skill 是否命中黑名单。

#### `checkSkillAuthenticity(name, hash, registry?)`

检查某个 Skill 是否与可信注册表中的基线哈希一致。

用途：识别“同名伪装”或“被篡改版本”。

#### `scanSkillContent(skillPath)`

扫描 Skill 目录里的 `SKILL.md` 和其他 markdown 文件，看里面是否包含恶意内容模式。

#### `assessSkillRisk(attempt, fetchRemoteBlacklist?)`

Skill 风险总评估入口。

综合：

- 黑名单
- 内容扫描
- 哈希真实性校验

最后返回：

- 风险等级
- 原因列表
- 是否阻断
- 人类可读消息

#### `buildRiskMessage(attempt, level, reasons)`

把内部风险评估结果排成人类可读警告文案。

#### `verifyAllInstalledSkills(registry?)`

启动时对 `~/.openclaw/skills` 下所有 Skill 做完整性检查。

#### `quickBlacklistCheck(skillName)`

同步快速预筛。

只看本地静态黑名单，速度最快，用于早期拦截。

### 你可以把它想成

像机场海关里最老练的那位检查官：先看护照名册，再看随身物品，最后还要验指纹。

---

## `src/skills/skill-cleanup.ts`

### 文件作用

这是 Skill 安全体系里的“隔离病房 + 证物室”。

不是直接粗暴删除，而是优先隔离、留证、可恢复。

### 方法说明

#### `getQuarantineDir()`

返回隔离区目录。

#### `getToolsLogPath()`

返回清理日志文件路径。

#### `getSkillsDir()`

返回 OpenClaw Skills 目录路径。

#### `quarantineSkill(skillPath, reason)`

把 Skill 移入隔离区，并写入 `quarantine-info.json` 元数据。

#### `removeSkill(skillPath, reason)`

逻辑上叫 remove，但实现上仍然是“先隔离后移除”。

这样做能保留取证材料。

#### `updateOpenClawConfig(skillName)`

尝试把某个 Skill / 插件从 `openclaw.json` 中删除。

#### `logCleanupAction(action)`

把隔离、删除、恢复等动作记到 `.lynx/TOOLS.md`。

#### `cleanupFlaggedSkills(flagged, action)`

批量处理一组被标记的 Skill。

#### `listQuarantined()`

列出所有已隔离 Skill 及其元信息。

#### `restoreFromQuarantine(skillName)`

把最近一次隔离的某个 Skill 恢复回技能目录。

### 你可以把它想成

像医院里的传染病隔离区。先把人隔开、贴上病历、登记时间，必要时还能转回来，不是一上来就“人间蒸发”。

---

## 报告与测试补充

## `test/` 测试职责速览

这些文件不是运行时代码，但它们像每道安全门背后的“演习脚本”：

- `test/api.test.ts`
  测 API 客户端调用路径、超时和非 200 处理。
- `test/blacklist.test.ts`
  测危险命令/路径匹配、白名单放行。
- `test/hook-helpers.test.ts`
  测消息装饰、discovery 报告拼接、guard context 构造、输出脱敏。
- `test/manual-lynx-check.test.ts`
  测 `/lynx-check` 综合报告排版。
- `test/plugin.test.ts`
  测 `index.ts` 注册的 hook 是否按预期协作。
- `test/registration.test.ts`
  测用户 ID 生成与落盘。
- `test/regression.test.ts`
  测一批历史 bug 修复点，防止回归。
- `test/safety-guard.test.ts`
  测提示词注入、系统提示探测、输出泄露、工具调用防护。
- `test/skill-guard.test.ts`
  测 Skill 哈希、安装检测、黑名单、内容扫描、真实性校验。
- `test/token-optimizer.test.ts`
  测 token optimizer 的格式化和提示拼接逻辑。

---

## 最后给你的“记忆钩子”

如果你想快速把这套代码记住，可以用一句顺口溜：

- `index.ts` 负责“发号施令”
- `utils.ts` 负责“搬箱子、找端口、抄近路”
- `blacklist.ts` 负责“硬拦”
- `guard/` 负责“看意图、判风险、拉警报”
- `discovery/` 负责“找服务、做报告”
- `runtime/` 负责“接脚本、修消息、补上下文”
- `skills/` 负责“查安装、验真伪、做隔离”

如果把插件想成一栋楼：

- `index.ts` 是总控室
- `guard/` 是安保部
- `discovery/` 是侦察科
- `runtime/` 是后勤处
- `skills/` 是海关缉私组
- `utils.ts` 是杂务总台

这样你以后看任意一个函数名，基本都能先猜到它住在哪层楼、归谁管。
