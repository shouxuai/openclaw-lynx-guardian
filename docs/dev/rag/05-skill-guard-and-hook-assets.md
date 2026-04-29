# Skill Guard、Hook 资产与随插件分发内容

## 1. 这一层的职责

这一部分代码和资产解决的是“插件除了保护运行中的 Agent，还要保护 Agent 能加载什么扩展内容”。

它包含三类内容：

1. Skill 安全治理代码
   位于 `src/skills/*`
2. Hook 资产
   位于 `hooks/*`
3. 随插件分发的 Skill 目录
   位于 `skills/*`

## 2. Skill 安全治理代码

### 2.1 `skill-blacklist-data.ts`

这个文件主要不是逻辑，而是静态情报库：

| 内容 | 作用 |
| --- | --- |
| `MaliciousSkillEntry` | 恶意 Skill 黑名单条目结构 |
| `MALICIOUS_SKILL_BLACKLIST` | 已知恶意 Skill 名称、模式、哈希等 |
| `MALICIOUS_SKILL_CONTENT_PATTERNS` | 恶意内容模式，如反弹 shell、数据外传 |
| `TrustedSkillEntry` | 可信 Skill 基线结构 |
| `TRUSTED_SKILL_REGISTRY` | 可信 Skill 注册表 |

设计上它相当于“静态知识库”，供 `skill-guard.ts` 调用。

### 2.2 `skill-hash.ts`

#### 关键函数

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `computeFileHash(filePath)` | 计算单文件 SHA-256 | 作为最底层哈希原语 |
| `collectFiles(dirPath, basePath)` | 递归收集 Skill 目录文件 | 生成稳定排序，避免顺序抖动 |
| `computeSkillHash(skillPath)` | 计算整个 Skill 目录哈希 | 不只哈希内容，还把相对路径纳入签名 |
| `verifySkillIntegrity(skillPath, expectedHash)` | 判断当前 Skill 是否被篡改 | 对比计算结果和基线哈希 |

### 2.3 `skill-guard.ts`

这是 Skill 安全治理的主文件。

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `getBlacklist()` | 合并本地黑名单、磁盘缓存、远端黑名单 |
| `detectSkillInstall()` | 检测一次工具调用是否在安装 Skill |
| `checkMaliciousSkillBlacklist()` | 检查 Skill 名称/哈希是否命中黑名单 |
| `checkSkillAuthenticity()` | 校验 Skill 是否伪装成可信 Skill |
| `scanSkillContent()` | 扫描 `SKILL.md` 和相关 markdown 内容风险 |
| `assessSkillRisk()` | 对 Skill 安装行为做总评估 |
| `verifyAllInstalledSkills()` | 启动期校验已安装 Skill 完整性 |
| `quickBlacklistCheck()` | 只跑本地静态黑名单的快筛 |

#### 实现思路

Skill 风险评估不是只看名字，而是分三层：

1. 名字和已知黑名单
2. 内容扫描
3. 哈希真实性校验

这样可以同时处理：

- 已知恶意 Skill
- 同名伪装 Skill
- 内容被改写的 Skill

### 2.4 `skill-cleanup.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `quarantineSkill()` | 把 Skill 移入隔离区并写元数据 |
| `removeSkill()` | 逻辑删除，实际仍优先走隔离 |
| `updateOpenClawConfig()` | 尝试同步更新 openclaw 配置 |
| `logCleanupAction()` | 把清理动作记到 `.lynx/TOOLS.md` |
| `cleanupFlaggedSkills()` | 批量处理问题 Skill |
| `listQuarantined()` | 列出已隔离 Skill |
| `restoreFromQuarantine()` | 从隔离区恢复 Skill |

#### 实现思路

这里的核心思想不是“直接删除”，而是“先隔离，保留证据，可恢复”。这对排查误报和后续审计都更友好。

## 3. Hook 资产

### 文件：`hooks/lynx-guardian-sensitiveData/handler.ts`

这个 hook 比较小，但作用明确：在 agent bootstrap 时，向会话注入一份虚拟文件 `SELF_IMPROVEMENT_REMINDER.md`。

#### 关键点

| 项目 | 说明 |
| --- | --- |
| 触发条件 | `event.type === "agent"` 且 `event.action === "bootstrap"` |
| 注入内容 | 安全复盘提醒，指导把检测到的问题写入 `.lynx/*.md` |
| 注入方式 | 往 `event.context.bootstrapFiles` 里 push 虚拟文件 |

#### 实现思路

它不是拦截器，而是“会话引导器”，把 Lynx Guardian 的检测结果转化成可持续复盘的工作流。

## 4. 随插件分发的 Skill 资产

### 4.1 `skills/lynx-guardian-lesson/SKILL.md`

这是随插件分发的主 Lesson Skill，定位是“把安全检测事件沉淀为工作区知识”。

核心约定：

| 事件 | 目标文件 |
| --- | --- |
| `Sensitive data detected` | `.lynx/SENSITIVE.md` |
| `Input risk detected` | `.lynx/CONTENT.md` |
| `Output risk detected` | `.lynx/CONTENT.md` |
| `Blacklist hit` | `.lynx/TOOLS.md` |

它把 Lynx Guardian 从“阻断插件”进一步推向“安全经验沉淀器”。

### 4.2 `skills/lynx-guardian-lesson/assets/*`

这些文档是 lesson skill 的配套资产：

| 文件 | 作用 |
| --- | --- |
| `assets/SENSITIVE.md` | 敏感数据事件记录模板 |
| `assets/CONTENT.md` | 输入/输出风险记录模板 |
| `assets/TOOLS.md` | 黑名单命中记录模板 |

### 4.3 `skills/lynx-guardian-lesson/SX-*`

这个目录下包含多个安全与优化能力包，例如：

- `SX-security-audit`
- `SX-openclaw-discovery`
- `SX-openclaw-token-optimizer`
- `SX-self-safety-guard`

这些目录的作用不是被 TypeScript 直接 import，而是：

1. 作为随插件分发的技能资产
2. 为 Python 脚本 runner 提供脚本和参考资料
3. 让运行期能力与分发内容保持一致

## 5. 代码与资产之间的联动

最关键的桥接函数是 `ensureResources()`，定义在 `src/utils.ts`。

它做了两件事：

1. 确保 `~/.openclaw/hooks` 和 `~/.openclaw/skills` 存在
2. 把当前仓库内的 `hooks/` 和 `skills/` 同步过去

因此，`hooks/*` 和 `skills/*` 虽然看起来像静态资源，实际上是运行期部署的一部分。

## 6. 测试覆盖

与这一层最直接相关的测试：

| 测试文件 | 关注点 |
| --- | --- |
| `test/skill-guard.test.ts` | Skill 哈希、安装检测、黑名单、真实性校验 |
| `test/plugin.test.ts` | `before_tool_call` 里的 Skill guard 协作 |
| `test/registration.test.ts` | `ensureResources()` 同级的基础设施函数虽然不直接测 Hook/Skill，但影响部署链 |

## 7. 当前实现的优缺点

### 优点

- Skill 风险治理从安装、内容、完整性、恢复四个阶段都覆盖到了
- Hook 资产和 Skill 资产能跟着插件一起分发，部署简单
- lesson skill 提供了“安全经验沉淀”的闭环，不只是单次阻断

### 问题

- TypeScript 代码、Skill 文档资产、Python 脚本资产都混在同一仓库里，容易漂移
- `ensureResources()` 采用目录整体复制，粒度比较粗
- Hook/Skill 的运行态版本和仓库版本之间，仍需要依赖 dev sync 流确保一致
