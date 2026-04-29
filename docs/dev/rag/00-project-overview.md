# Lynx Guardian 项目总览

## 1. 项目定位

Lynx Guardian 是一个挂在 OpenClaw 生命周期上的安全治理插件，目标不是替代模型，而是在模型开始执行前、调用工具时、输出落盘前、消息发出前，为整个 Agent 工作流补上一层“可解释、可追踪、可阻断”的安全控制面。

当前代码实际覆盖了 6 条主能力线：

1. AI 自我安全防护
   入口集中在 `src/guard/*`，覆盖输入提示注入、系统提示泄露、越权代理、凭据窃取、恶意代码请求、输出泄漏等风险。
2. 工具与路径黑名单
   入口在 `src/blacklist.ts`，为 `exec/write/edit` 提供高确定性拦截。
3. `/lynx-check` 手动与定时审计
   入口跨 `src/discovery/*`、`src/runtime/*` 和 `index.ts`，负责预计算报告、落盘、回传、失败兜底。
4. Skill 安全治理
   入口在 `src/skills/*`，覆盖安装检测、黑名单、完整性校验、隔离恢复。
5. 启动期安全审计与 Token 优化
   入口在 `src/runtime/security-audit-runner.ts` 和 `src/runtime/token-optimizer-runner.ts`，本质是 TypeScript 对 Python 脚本能力的封装。
6. Docker 开发同步与验证
   入口在 `scripts-dev/*`，负责把本地插件同步到真实 OpenClaw Docker 网关环境中验证。

## 2. 仓库结构速览

| 路径 | 角色 | 说明 |
| --- | --- | --- |
| `index.ts` | 总调度入口 | 注册所有 OpenClaw hook，并把各功能模块串起来 |
| `openclaw.plugin.json` | 插件声明与配置 schema | 决定外部可配置能力边界 |
| `src/guard/*` | 安全防线 | 输入、输出、工具、结果持久化拦截 |
| `src/discovery/*` | `/lynx-check` 与服务发现 | 触发分类、扫描、报告生成 |
| `src/runtime/*` | 运行期中间层 | 状态存储、投递、调度、授权、脚本封装 |
| `src/skills/*` | Skill 治理 | 安装检测、黑名单、完整性校验、隔离恢复 |
| `src/api.ts` | 远端安全中心 API 客户端 | 注册、内容检查、工具检查、黑名单拉取 |
| `src/utils.ts` | 跨模块基础工具 | 用户 ID、资源同步、上下文读取、网络探测 |
| `hooks/*` | 会话注入 Hook 资产 | 在 bootstrap 时注入安全提醒 |
| `skills/*` | 随插件分发的 Skill 资产 | 主要是 lesson 与安全审计/优化类能力 |
| `scripts-dev/*` | 本地开发辅助 | Docker dev sync、ready 校验、cron store 修复 |
| `test/*` | 回归测试 | 以行为为中心覆盖主链路 |

## 3. 启动期流程

`setup(api)` 的启动期逻辑可以拆成 4 段：

1. 解析配置和运行环境
   读取 `selfSafetyGuard`、`securityAudit`、`skillGuard`、`tokenOptimizer`、`scheduledLynxCheck`、`managedLynxCheckAuthorization`、`openclawDiscovery`。
2. 建立本地运行基础设施
   通过 `ensureUserRegistered()` 生成或读取用户 ID，调用 `registerUser()` 注册远端身份，通过 `ensureResources()` 同步 `hooks/` 和 `skills/` 到 `~/.openclaw`。
3. 启动异步后台能力
   触发 `reconcileScheduledLynxCheck()`、`runSecurityAudit()`、`runMaliciousScriptScan()`、`verifyAllInstalledSkills()`、`checkBudget()`、`planHeartbeat()`。
4. 注册 hook
   把消息接收、Agent 启动、工具调用、消息发送、会话开始/结束等事件接入安全治理链。

## 4. 运行时主链路

### 4.1 普通消息链路

1. `message_received`
   做敏感数据快筛、输入风控、确认短语识别、自然语言 discovery 触发识别。
2. `before_agent_start`
   做公网暴露检查、输入预警注入、Token 优化建议、API 内容风控。
3. `agent_end`
   做输出泄露检查、API 输出风控、工作流授权回收。
4. `before_message_write` / `message_sending`
   做最终文本修饰、Feishu 特殊整形、消息发送前输出拦截。

### 4.2 `/lynx-check` 链路

1. `message_received` 只识别触发，不直接生成结果。
2. `before_agent_start` 创建 run intent，预计算完整报告并落盘。
3. 运行结果通过 prompt 注入给模型，要求模型直接回传完整中文报告。
4. `agent_end` 根据 inline 是否成功、routeHint 是否存在、最近活跃投递目标是否可用，决定是否 fanout 或 fallback-send。

### 4.3 工具调用链路

1. `before_tool_call` 先跑 `guardToolCall()`。
2. 再做 Skill 安装检测与 Skill 风险评估。
3. 再做命令/路径黑名单匹配。
4. 对命中的高风险操作结合远端 `checkTool()` 做补充判定。
5. 需要用户确认时，会走 pending override + workflow auth 两阶段放行机制。

## 5. 配置面

对外暴露的配置主要定义在 `openclaw.plugin.json` 与 `src/types.ts`：

| 配置块 | 作用 |
| --- | --- |
| `selfSafetyGuard` | 输入、输出、工具、结果持久化四类安全拦截 |
| `selfSafetyGuard.policy` | 一次性确认短语、可放行等级、授权窗口等策略 |
| `securityAudit` | 启动期 Python 安全审计脚本配置 |
| `skillGuard` | Skill 黑名单、完整性校验、自动隔离 |
| `tokenOptimizer` | 上下文裁剪、模型路由、心跳优化、预算追踪 |
| `scheduledLynxCheck` | 原生 cron 作业的创建与同步 |
| `managedLynxCheckAuthorization` | `/lynx-check` 的插件侧预授权 |
| `openclawDiscovery` | 服务发现目标、端口、并发度、置信阈值 |

## 6. 关键运行时产物

| 产物路径 | 用途 |
| --- | --- |
| `~/.openclaw/lynx/check-runs/*.intent.json` | `/lynx-check` 运行意图 |
| `~/.openclaw/lynx/check-runs/*.result.json` | `/lynx-check` 投递结果 |
| `~/.openclaw/lynx/check-runs/*.report.md` | 审计报告正文 |
| `~/.openclaw/lynx/recent-active-delivery.json` | 最近活跃投递目标快照 |
| `~/.openclaw/lynx/hook-probe.log` | 生命周期探针 |
| `~/.openclaw/cron/jobs.json` | OpenClaw cron store |
| `~/.openclaw/docker-state/cron/jobs.json` | Docker runtime cron store |
| `~/.openclaw/.lynx-pending-discovery*` | 旧版 discovery 文件中转状态 |

## 7. 测试布局

当前测试不是按“目录”组织，而是按“行为能力”组织，这对回归判断很有帮助：

| 测试文件 | 关注点 |
| --- | --- |
| `test/plugin.test.ts` | 主链路集成测试，覆盖 hook 协作 |
| `test/safety-guard.test.ts` | 输入/输出/工具防护 |
| `test/blacklist.test.ts` | 命令和路径黑名单 |
| `test/manual-lynx-check.test.ts` | 手动 `/lynx-check` 报告 |
| `test/scheduled-lynx-check.test.ts` | 定时任务与 cron store |
| `test/lynx-check-run-store.test.ts` | run store 状态流 |
| `test/skill-guard.test.ts` | Skill 安全治理 |
| `test/token-optimizer.test.ts` | token optimizer runner |
| `test/hook-helpers.test.ts` | message decoration / guard helper |

## 8. 当前架构特征

### 优点

- 以 hook 为中心，安全切点完整。
- 对 `/lynx-check` 做了从“异步技能编排”向“启动前预计算报告”的收敛，运行可控性更高。
- 测试覆盖主链路较全，尤其是 `plugin.test.ts` 对集成回归很有价值。
- Skill 安全、工具黑名单、输出拦截是三条相对独立的治理线，模块边界基本清楚。

### 问题

- `index.ts` 过大，已经同时承担初始化、编排、策略拼装、日志、投递、状态协调等职责。
- `runtime/*` 里有不少“本地 store 模板代码”和“路径/状态归一化代码”重复。
- `/lynx-check` 既有新的 run-store 流，也保留了旧的 pending-discovery 文件流，双轨并存。
- 本地 guard、黑名单、远端 API 风控三套判定逻辑存在重叠，长期会增加维护心智负担。

## 9. 建议阅读顺序

1. 先看 `01-plugin-lifecycle-and-index.md`
2. 再看 `02-guard-system.md`
3. 然后看 `03-lynx-check-and-discovery.md`
4. 如果要处理投递/状态问题，再看 `04-runtime-delivery-state.md`
5. 如果要处理 Skill、Hook、Docker 开发验证，再看 `05` 和 `06`
6. 需要定位函数时，回到 `07-file-function-index.md`
7. 准备重构时，看 `08-duplication-and-legacy-assessment.md`
