# 重复实现、老旧逻辑与重构建议

## 1. 结论先说

这个项目已经从“一个安全插件”逐渐长成了“安全平台 + 审计平台 + Docker 开发同步工具箱”。功能能力并不弱，但实现层已经出现明显的重复和老旧痕迹。

最值得关注的不是单个 bug，而是下面 5 类结构性问题：

1. `index.ts` 超大编排文件
2. 本地 state store 模板重复
3. `/lynx-check` 新旧状态流并存
4. 风险判定链路重叠
5. 开发同步脚本重复

## 2. 最明显的重复点

### 2.1 store 模板重复

以下文件都在做相似的事：

- `src/runtime/lynx-check-run-store.ts`
- `src/runtime/lynx-delivery-intent-store.ts`
- `src/runtime/managed-lynx-check-authorization-store.ts`
- `src/runtime/recent-active-delivery.ts`

重复模式包括：

- `resolveRootDir()` / `resolveXxxPath()`
- `ensureParentDirectory()`
- `normalizeIntent()` / `normalizeSnapshot()` / `normalizeResult()`
- JSON 读写与容错

### 判断

这是典型“随着功能增长逐个复制 store 模板”的结果。短期快，长期维护成本高。

### 2.2 Python runner 重复

以下两个文件结构非常像：

- `src/runtime/security-audit-runner.ts`
- `src/runtime/token-optimizer-runner.ts`

重复点：

- `findPython()`
- 脚本目录定位
- 子进程执行
- 错误处理
- 输出格式转换

### 判断

可以抽成一个通用 `python-skill-runner.ts`，把脚本目录、入口脚本名、解析策略作为参数。

### 2.3 路由目标归一化重复

以下位置都在做“从上下文提取 session/channel/provider/sender 组合”的工作：

- `index.ts`
- `src/runtime/recent-active-delivery.ts`
- `src/runtime/lynx-message-delivery.ts`

### 判断

这是 `/lynx-check` 投递链逐步补丁式演化的痕迹。建议收敛成统一的 `delivery-target.ts`。

### 2.4 stale 目录检测重复

`findStalePluginManagedDirectories()` 同时存在于：

- `scripts-dev/dev-sync-lib.mjs`
- `src/utils.ts`

### 判断

一个用于 dev sync，一个用于运行时资源同步，说明宿主机资源同步和开发同步已经出现了“相似问题、两份实现”。

### 2.5 过期/TTL 逻辑重复

以下文件都在自己维护 TTL 过期清理：

- `pending-override-store.ts`
- `workflow-authorization-store.ts`
- `override-runtime.ts`

### 判断

可以抽成通用的 in-memory expiring store，减少未来新增授权类状态时的重复。

## 3. 明显的老旧或双轨逻辑

### 3.1 `/lynx-check` 新旧双轨状态并存

新链路：

- `lynx-check-run-store.ts`
- `buildManualLynxCheckReport()`
- `lynx-check-prompt.ts`
- `deliverLynxReport()`

旧链路残留：

- `DISCOVERY_RESULT_PATH`
- `DISCOVERY_RESULT_CONSUMED_PATH`
- `DISCOVERY_REQUEST_PATH`
- `pending-discovery-store.ts`

### 判断

当前 `agent_end` 同时兼容“run-store 驱动的 `/lynx-check`”和“旧版 discovery 文件中转”。这会让排障时很难快速判断究竟哪条链在生效。

### 3.2 `index.ts` 中的大量特例判断

典型特征：

- managed `/lynx-check` 专属白名单
- Feishu 专属 message shaping
- discovery pending 专属发送兜底
- workflow auth 总结回传

### 判断

这些都是真实需求，但放在一个大文件里后，很难区分“通用平台逻辑”和“单一业务特例”。

### 3.3 本地风险判断三层叠加

一次工具调用可能同时经过：

1. `guardToolCall()`
2. `checkExecBlacklist()` / `checkPathBlacklist()`
3. `checkTool()` 远端风控

### 判断

这不是错误，但容易造成：

- 模块命名不一致
- 风险等级语义不一致
- override 入口分散

长期应该明确三层边界：

- guard：语义型风险
- blacklist：硬规则型风险
- API：策略与情报补充

## 4. 代码气味

### 4.1 `index.ts` 中存在多处“return 后还有 return”

例如 `message_received` 中的确认短语和 discovery 分支，存在先 `return`，后面仍保留旧式 `{ block: true }` 返回对象的痕迹。

### 判断

这说明该文件经历过接口形态演化，但旧分支没有完全收干净。虽然不一定影响功能，但会增加阅读噪音。

### 4.2 文案和策略串硬编码分散

问题位置包括：

- `index.ts`
- `policy-runtime.ts`
- `lynx-check-prompt.ts`
- `manual-lynx-check.ts`
- `lynx-message-delivery.ts`

### 判断

对于一个需要长期维护的安全插件来说，文案、提示、渠道适配文本最好有一层集中管理，否则后续多语言或渠道扩展会很痛苦。

### 4.3 资产与代码耦合过深

仓库里同时维护：

- TypeScript 运行代码
- Python 审计脚本引用
- Skill Markdown 资产
- Hook Markdown/handler 资产
- Docker dev sync 脚本

### 判断

这使仓库非常“全能”，但也让改动半径越来越大。

## 5. 推荐重构顺序

### 第一优先级

1. 把 `index.ts` 拆成独立 hook handler 模块
2. 为 delivery target 和各类 store 抽公共底层
3. 明确 `/lynx-check` 新旧状态链，逐步淘汰 pending-discovery 文件流

### 第二优先级

1. 抽统一 Python runner
2. 统一风险模块命名与 override 策略入口
3. 收敛 Feishu/WebChat 渠道适配层

### 第三优先级

1. 把脚本层做成更清晰的命令体系
2. 给 Skill 资产与运行代码建立更明确的版本同步约束
3. 把常量文案抽离

## 6. 适合继续保留的设计

虽然有重复和老旧逻辑，但有几块设计值得保留：

1. `/lynx-check` 预计算 + inline 优先 + fallback-send 的总体思路
2. workflow auth 窗口机制
3. recent-active delivery 与 session store 恢复的双层投递策略
4. Skill 安装检测 + 内容扫描 + 完整性校验的三层治理

## 7. 建议的中期目标

一个更健康的架构应当是：

- `index.ts` 只负责注册
- `hooks/*` 负责单一生命周期处理
- `runtime/store/*` 统一管理本地状态
- `runtime/delivery/*` 统一管理投递与 provider adapter
- `guard/*` 继续保持统一风险结构
- `/lynx-check` 只保留一条状态主链

做到这一步后，这个项目会从“功能能跑”进入“长期可维护”的状态。
