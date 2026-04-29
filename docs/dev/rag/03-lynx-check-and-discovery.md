# `/lynx-check` 与 Discovery 主链路

## 1. 功能边界

当前 `/lynx-check` 不再只是“扫端口”或“简单发一条检查结果”，而是一个完整的托管审计流程：

1. 识别触发
2. 区分手动与定时来源
3. 预计算报告
4. 落 intent / result / report 三类运行状态
5. 要求模型直接内联输出完整中文报告
6. 在失败时按 route hint、recent-active、session store 做 fallback 回传

同一条能力线还顺带承接了 OpenClaw 服务发现。

## 2. 相关文件

| 文件 | 角色 |
| --- | --- |
| `src/discovery/lynx-check-trigger.ts` | 触发分类 |
| `src/discovery/discovery-hook-utils.ts` | hook 侧 discovery 辅助逻辑 |
| `src/discovery/discovery-runtime-config.ts` | discovery 配置读取与归一化 |
| `src/discovery/openclaw-discovery.ts` | 真正的服务探测引擎 |
| `src/discovery/manual-lynx-check.ts` | 手动 `/lynx-check` 报告编排 |
| `src/discovery/lynx-check-report-template.ts` | 报告 Markdown 模板 |
| `src/discovery/pending-discovery-store.ts` | 旧版 discovery 状态文件 |
| `src/runtime/lynx-check-prompt.ts` | prompt 注入模板 |
| `src/runtime/lynx-check-run-store.ts` | 运行 intent/result/report 存储 |
| `src/runtime/scheduled-lynx-check.ts` | cron job 同步 |
| `src/runtime/managed-lynx-check-authorization-store.ts` | `/lynx-check` 预授权 |

## 3. 触发识别：`lynx-check-trigger.ts`

### 关键函数

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `normalizeRawInput()` | 输入预清洗 | 去空白、统一基础格式 |
| `escapeRegExp()` | 生成安全正则片段 | 为关键字匹配服务 |
| `hasEnglishKeyword()` / `hasCjkKeyword()` | 识别英文/中文关键字 | 支持中英混合触发 |
| `isLikelySenderPrefix()` | 判断是否只是消息前缀 | 避免把“用户名前缀”误判为命令 |
| `normalizeInput()` | 进一步标准化输入 | 兼容 slash command 与自然语言 |
| `hasSlashCommand()` | 判断是否为命令格式 | 优先识别 `/lynx-check` |
| `isKeywordDiscoveryPrompt()` | 识别 discovery 自然语言请求 | 支持“检测 openclaw 端口”等表达 |
| `classifyLynxCheckTrigger()` | 总分类入口 | 返回 `native_passthrough`、`lynx_command`、`keyword_request` 等结果 |

### 设计特点

- 不抢占原生 `/check`
- 对 `/lynx-check` 和自然语言 discovery 都支持
- 尽量避免误伤带前缀、带包装的普通消息

## 4. discovery 配置与运行

### 4.1 `discovery-runtime-config.ts`

核心函数：

| 函数 | 作用 |
| --- | --- |
| `loadDiscoveryRuntimeConfig()` | 把 `openclawDiscovery` 配置与默认值合并 |

它的角色很轻，但非常关键，因为后面的扫描引擎默认值都由这里统一确定。

### 4.2 `discovery-hook-utils.ts`

核心函数：

| 函数 | 作用 | 实现思路 |
| --- | --- | --- |
| `isManualCompositeLynxCheckRequest()` | 判断请求是否是手动复合审计 | 支持自然语言包装的 `/lynx-check` |
| `isManualDiscoveryRequest()` | 判断是否是单纯 discovery 请求 | 区分“服务发现”和“完整审计” |
| `resolveDiscoveryTargets()` | 计算要扫描的目标 | 结合显式目标与自动扩展 |
| `runDiscoveryAndNotify()` | 执行扫描并按需通知 | 调用 discovery 引擎并返回格式化摘要 |

### 4.3 `openclaw-discovery.ts`

这是 discovery 最核心的实现文件，负责端口探活和 OpenClaw 指纹识别。

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `parseHostTarget()` | 解析 host / host:port / URL / CIDR |
| `expandIpv4Cidr()` | 展开 CIDR 到 host 列表 |
| `asyncPool()` | 并发池执行器 |
| `performRequest()` | 通用 HTTP 请求执行 |
| `httpGet()` | HTTP/HTTPS GET 探测 |
| `checkWebSocket()` | 检测是否支持 WebSocket 升级 |
| `checkTcpPort()` | TCP 端口探活 |
| `tcpScanPorts()` | 批量端口扫描 |
| `buildFullPortList()` | 生成全端口扫描列表 |
| `fingerprintOpenClaw()` | 根据响应体、header、健康检查路径、WebSocket 等判断是否像 OpenClaw |
| `scanTarget()` | 扫描单个目标 |
| `dedupeHits()` | 结果去重 |
| `discoverOpenClaw()` | discovery 总入口 |
| `formatDiscoverySummary()` | 把结果格式化成摘要文本 |

#### 实现思路

- 先做低成本的端口探活
- 再做较贵的 HTTP / WebSocket 指纹识别
- 最后用 score 和 confidence 组合出命中结论

也就是说，它不是“只要端口开着就算”，而是做了一层面向 OpenClaw 的协议特征识别。

## 5. 手动 `/lynx-check` 报告生成

### 5.1 `manual-lynx-check.ts`

这个文件负责把多类审计结果整合成一份完整中文报告。

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `formatTimestamp()` | 生成固定时区的报告时间 |
| `extractDiscoveryTargets()` | 从 discovery 摘要里提取 `IP:port` |
| `filterAuditFindings()` | 从安全审计结果中按关键字筛 findings |
| `deriveOverallRating()` | 计算总评级 |
| `buildConfigSection()` | 构造配置安全章节 |
| `buildGatewaySection()` | 构造网关与执行面章节 |
| `buildChannelSection()` | 构造通道与回传链路章节 |
| `buildSkillSection()` | 构造 Skill 与插件代码风险章节 |
| `buildDependencySection()` | 构造依赖供应链章节 |
| `buildPermissionSection()` | 构造权限与敏感路径章节 |
| `buildNextActions()` | 生成整改建议 |
| `buildManualLynxCheckReport()` | 报告总入口 |

#### 组合的数据源

`buildManualLynxCheckReport()` 实际上会同时调用：

- `checkPublicAccess()`
- `runDiscoveryAndNotify()`
- `runSecurityAudit()`
- `runMaliciousScriptScan()`
- `verifyAllInstalledSkills()`

所以它不是纯模板渲染器，而是一个“聚合编排器 + 模板准备器”。

### 5.2 `lynx-check-report-template.ts`

核心函数：

| 函数 | 作用 |
| --- | --- |
| `renderDetailedLynxAuditReport()` | 把各 section 渲染为最终 Markdown |

这个模板层把报告结构固定下来，让 `manual-lynx-check.ts` 可以只关心“准备什么章节”，不用关心具体 Markdown 排版。

## 6. prompt 注入与模型职责

### 文件：`src/runtime/lynx-check-prompt.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `buildSharedInstructions()` | 生成 manual/scheduled 共用约束 |
| `buildChannelInstructions()` | 生成 WebChat/Feishu 渠道差异说明 |
| `buildManualLynxCheckPrompt()` | 手动 `/lynx-check` 注入 prompt |
| `buildScheduledLynxCheckPrompt()` | 定时 `/lynx-check` 注入 prompt |
| `buildLynxCheckFallbackFailureNotice()` | fallback 失败时的提示 |

### 实现思路

现在的设计不是让模型“自己去跑审计”，而是：

1. 插件先完成确定性审计
2. 把完整报告和回传要求注入给模型
3. 模型只负责按约定渠道把完整报告吐出来

这大幅减少了“技能编排延迟”和“模型自由发挥导致报告不完整”的问题。

## 7. 运行状态落盘

### 文件：`src/runtime/lynx-check-run-store.ts`

这个文件定义了 `/lynx-check` 的三类状态：

- intent：为什么要跑、谁触发的、投递偏好是什么
- result：是否成功回传、用了什么 transport
- report：真正的 Markdown 报告正文

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `createLynxCheckRunIntent()` | 创建新 run intent，并写入初始 result |
| `readLynxCheckRunIntent()` | 读取指定 intent |
| `updateLynxCheckRunIntentStatus()` | 更新 intent 状态 |
| `markLynxCheckRunCompleted()` | 标记完成 |
| `readLatestPendingLynxCheckRunIntent()` | 找某会话最新 pending/running run |
| `writeLynxCheckRunResult()` | 写回投递结果 |
| `readLynxCheckRunResult()` | 读取投递结果 |
| `waitForLynxCheckRunResultSettled()` | 轮询等待结果收敛 |
| `getLynxCheckRunReportPath()` | 计算报告路径 |

### 实现思路

- 通过文件系统让 hook 之间共享状态
- 允许模型内联成功，也允许插件 fallback-send
- 对路径做 rootDir 约束，防止越界 reportPath

## 8. 定时 `/lynx-check`

### 文件：`src/runtime/scheduled-lynx-check.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `resolveScheduledLynxCheckConfig()` | 归一化 cron 配置 |
| `buildScheduledLynxCheckJob()` | 构建 cron job record |
| `reconcileScheduledLynxCheck()` | 把目标 job 同步到 cron store |

### 实现思路

- 通过固定 `job id` 保证幂等
- 每次启动和 `gateway_start` 都做一次 reconcile
- 可选择 `announce` 或 `recent-active` 两种投递模式

## 9. `/lynx-check` 预授权

### 文件：`src/runtime/managed-lynx-check-authorization-store.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `grantManagedLynxCheckAuthorization()` | 授予手动/定时 `/lynx-check` 预授权 |
| `hasManagedLynxCheckAuthorization()` | 判断当前是否预授权 |
| `clearManagedLynxCheckAuthorization()` | 清理授权 |

### 设计目的

避免 `/lynx-check` 在读取自身必要配置、生成自身报告时，被通用 self-safety guard 误阻断。

## 10. 旧 discovery 文件流

### 文件：`src/discovery/pending-discovery-store.ts`

#### 关键函数

| 函数 | 作用 |
| --- | --- |
| `ensureParentDirectory()` | 确保父目录存在 |
| `writePendingDiscoveryRequest()` | 写入 pending discovery 请求 |
| `readPendingDiscoveryRequest()` | 读取请求 |
| `clearPendingDiscoveryRequest()` | 清理请求 |
| `shouldAttachPendingDiscoveryReport()` | 判断当前会话是否应附加旧版 discovery 报告 |

### 现状判断

这条链路更像旧版 discovery 方案的遗留状态层。现在 `/lynx-check` 已经主要依赖 run store，但 `agent_end` 里仍然保留了 `DISCOVERY_RESULT_PATH` 和 pending request 的发送兜底逻辑。

## 11. 整体调用链总结

手动 `/lynx-check`：

1. `message_received` 识别命令
2. `before_agent_start` 创建 intent
3. `buildManualLynxCheckReport()` 预计算报告
4. 写入 `.report.md` + `.result.json`
5. 注入 prompt 给模型
6. `agent_end` 检查是否 inline 成功，否则 fallback-send

定时 `/lynx-check`：

1. `scheduled-lynx-check.ts` 维护 cron 作业
2. cron 触发隔离 session
3. `before_agent_start` 同样预计算报告
4. `agent_end` 优先 fanout 到 recent-active target

## 12. 当前链路的优点和问题

### 优点

- 审计工作前置，模型职责收缩
- manual/scheduled 共享同一条报告生成主链
- 有 route hint、recent-active、session-store 三层投递兜底

### 问题

- 新 run store 与旧 pending-discovery 文件状态并存
- 手动、定时、discovery、fanout 的条件分支分散在多个文件和 `index.ts`
- 报告生成逻辑虽然已拆出，但入口仍深度依赖 `index.ts` 的编排
