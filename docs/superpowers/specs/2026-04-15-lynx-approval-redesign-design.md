# Lynx Guardian 审批与链式放权重构设计

日期：2026-04-15

状态：已完成设计，待评审

作者：Codex

## 1. 背景

当前 Lynx Guardian 的二次确认链路存在以下问题：

- 工具拦截后混用了多套确认入口，既有配置化确认短语，也有硬编码的“回复同意后重试”。
- 旧确认流程基于 `message_received` 消费自由文本，容易和 OpenClaw 原生 `/approve`、按钮审批、Control UI 审批冲突。
- 旧 `workflow_auth` 放权窗口过宽，存在 `scopeAll=true` 的整窗放行风险。
- 旧 pending override 在共享群会话中容易被错误消费，尤其是 fallback 的“最近一条 pending”逻辑。
- 飞书群环境中存在多个真实用户，审批人和请求人需要区分，且审批窗口不能被其他用户消息串扰。

本设计的目标是在不改变 OpenClaw 默认群通道行为、不重写 Lynx 原有风险识别能力的前提下，重构审批与放权层。

## 2. 设计目标

### 2.1 目标

- 工具审批统一迁移到 OpenClaw 原生插件审批能力。
- 被拦截的工具调用在审批通过后直接续跑，不再要求“同意后重试”。
- 支持多种审批回复格式，但后端只保留一条真实审批链。
- 审批权限只授予 `owner/approver`。
- 审批结果和链式放权只绑定原始 `runId`，不绑定整个群会话。
- 链式放权仅允许“同模块、同级或更低风险”自动续跑。
- 群里其他用户消息不消费当前审批，也不借用当前放权。
- 非工具类高风险请求不做审批，直接拒绝并要求用户改写请求。
- 不影响 Lynx 原有证据收集、风险识别、评分、策略映射能力。

### 2.2 非目标

- 不修改 OpenClaw 默认群会话划分策略。
- 不将飞书群默认切换为 `group_sender` 或其他 per-user session 模式。
- 不改变 OpenClaw 原生 `/approve` 命令协议。
- 不重写 Lynx 的 `safety-guard`、`policy-engine`、`evidence-scorer`。
- 不在本阶段处理非工具审批的恢复续跑问题。
- 不在本阶段持久化 `allow-always` 的永久信任语义，先按临时批准对待。

## 3. 核心结论

### 3.1 识别层与处置层分离

本次改造只重构“审批与放权处置层”，不重构“风险识别层”。

保留不变的能力：

- 证据收集
- 维度评分
- 模块命中
- L0-L4 风险分级
- 黑名单识别
- 攻击链判断
- 审计记录产出

替换的能力：

- 文本确认短语
- pending override 消费方式
- 宽范围 `workflow_auth`
- tool 审批文案与恢复方式

### 3.2 工具与非工具分流

- `tool` 风险：走原生审批。
- 非 `tool` 风险：不审批，直接拒绝或要求改写。

### 3.3 一个审批内核，多种回复格式

审批后端只保留一个统一审批内核；前端可以存在多种交互形态：

- OpenClaw 原生审批按钮 / Control UI / webchat 原生审批
- 聊天内 `/approve <id> ...`
- 飞书审批卡片

以上三者最终都归一为同一个审批动作：

- `approvalId`
- `decision`
- `actor identity`
- `transport`

## 4. 当前问题复盘

### 4.1 确认入口冲突

当前代码中同时存在：

- 配置型确认短语，默认语义为“确认放行本次操作”
- 工具拦截文案中的“回复同意后重试”

这导致：

- 用户体验不一致
- `/approve` 与自由文本确认冲突
- 群聊场景下无法安全区分“哪次确认对应哪次操作”

### 4.2 旧授权窗口过宽

当前 `workflow_auth` 支持 `scopeAll=true`，会在时间窗内放宽整类操作，风险过高。

### 4.3 群会话串扰

共享群 session 下，当前 pending override 的 lookup 逻辑使用：

- 主 key 命中
- 最近 pending fallback

这会在多用户群中产生误消费风险。

### 4.4 Hook 职责错位

`before_message_write` 是同步热路径，不适合作为审批入口。原来把需要交互的逻辑放在消息生命周期末端，本质上不稳定。

## 5. 新架构概览

### 5.1 两层结构

- 风险识别层
  现有 `guard` / `policy` / `runtime policy bridge`
- 审批处置层
  新的 approval runtime、grant runtime、transport adapters

### 5.2 执行平面

本方案存在两个执行平面：

- 审批判定平面
  Lynx 根据风险结果决定“拒绝 / 审批 / grant 命中 / 允许”
- 审批交互平面
  OpenClaw 原生审批系统负责等待审批与恢复工具调用

### 5.3 设计原则

- 不让工具审批依赖自由文本确认
- 不让群成员共享同一份审批上下文
- 不让审批结果泄漏为整个 session 的宽授权
- 不让审批交互依赖 `before_message_write`

## 6. Hook 责任重排

### 6.1 `before_dispatch`

职责：

- 提取并固化请求人身份
- 建立请求人与会话的绑定信息
- 为后续 run 提供身份来源

记录字段：

- `requesterId`
- `requesterOuId`
- `accountId`
- `conversationId`
- `threadId`
- `sessionKey`
- `timestamp`
- `isGroup`

设计说明：

- 飞书下 `senderId` 可视为 `ou_xxx`
- 此处只记录，不审批，不放权

### 6.2 `before_agent_start`

职责：

- 异步输入预审主入口
- 处理非工具高风险请求
- 为模型添加安全上下文
- 建立 run 级 requester provenance

处理原则：

- 非工具高风险命中：直接拒绝
- 可注入弱告警：补安全上下文
- 不在此处发起工具审批

设计说明：

- 这是异步且被 `await` 的安全入口
- 后续应将更多预审从 `before_message_write` 前移到这里

### 6.3 `before_tool_call`

职责：

- tool 风险判断后的审批执行点
- 检查链式 grant
- 创建原生审批请求
- 审批通过后恢复当前 tool 调用

处理顺序：

1. 风险识别层给出模块与风险级别
2. 检查是否存在匹配 grant
3. 若匹配 grant，则直接放行
4. 若不匹配 grant 且为 L2/L3，则触发原生审批
5. 若审批通过，则恢复当前 tool 并激活/提升 grant
6. 若 L4，则直接拒绝

### 6.4 `before_message_write`

职责：

- 输出侧最后一道同步防线
- 硬拦截
- 脱敏改写

禁止事项：

- 不在此处发起审批
- 不在此处等待用户响应
- 不在此处创建需要异步恢复的 pending state

## 7. 审批模型

### 7.1 ApprovalRequest

建议结构：

```ts
type ApprovalRequest = {
  approvalId: string;
  pluginId: string;
  runId: string;
  toolCallId: string;
  agentId?: string;
  sessionKey?: string;
  requesterOuId?: string;
  requesterAccountId?: string;
  requesterConversationId?: string;
  requesterThreadId?: string | number;
  module: string;
  riskLevel: "L2" | "L3";
  title: string;
  description: string;
  severity: "warning" | "critical";
  createdAt: number;
  expiresAt: number;
  transportMask: Array<"native_ui" | "chat_approve" | "feishu_card">;
};
```

说明：

- `approvalId` 以 OpenClaw 生成的真实 approval id 为准
- `requesterOuId` 是 Lynx 本地的权限与隔离核心字段
- `module` 只允许单模块审批，不支持多模块共享审批

### 7.2 ApprovalAction

```ts
type ApprovalAction = {
  approvalId: string;
  decision: "allow-once" | "allow-always" | "deny";
  actorId?: string;
  actorOuId?: string;
  transport: "native_ui" | "chat_approve" | "feishu_card";
  channel?: string;
  accountId?: string;
  conversationId?: string;
  actedAt: number;
};
```

### 7.3 ApprovalGrant

```ts
type ApprovalGrant = {
  grantId: string;
  runId: string;
  sessionKey?: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: "L2" | "L3";
  createdAt: number;
  expiresAt: number;
  sourceApprovalId: string;
};
```

### 7.4 核心约束

grant 只在同时满足以下条件时生效：

- `runId` 相同
- `requesterOuId` 相同
- `module` 相同
- 后续 tool 风险级别 `<= maxRiskLevel`
- 当前时间未超过 `expiresAt`

任何一条不满足，都必须重新审批。

## 8. 风险与审批映射

### 8.1 风险级别

- `L0`
  直接允许
- `L1`
  允许或警告，不走审批
- `L2`
  允许审批；审批通过后可建立 `L2` grant
- `L3`
  允许审批；审批通过后可建立 `L3` grant，但仅限同模块
- `L4`
  直接拒绝，不允许审批，不允许 grant

### 8.2 grant 提升规则

- `L2` 批准后：建立 `module=L2 ceiling`
- `L3` 批准后：建立 `module=L3 ceiling`
- `L2 grant` 遇到 `L3`：重新审批
- `L3 grant` 遇到 `L2`：可自动放行
- 任意 grant 遇到不同模块：重新审批
- 任意 grant 遇到 `L4`：直接拒绝

## 9. 工具链恢复与链式续跑

### 9.1 单个 tool 恢复

原生插件审批暂停的是当前工具调用本身。审批通过后直接恢复该 tool 调用，无需用户重新提示模型。

### 9.2 多 tool 链恢复

同一 run 内，一个 tool 审批通过后，run 继续向后执行。

后续 tool 的处理规则：

- 命中 grant：直接继续
- 未命中 grant：再次审批
- 命中更高风险或不同模块：再次审批
- 命中 L4：直接拒绝

### 9.3 不支持的恢复类型

本阶段不支持以下“非 tool 审批后恢复”：

- `before_agent_start` 被拒绝的输入意图恢复
- `before_message_write` 阶段的输出恢复
- 自由文本确认后重放整条会话

这类场景全部改为“拒绝并要求改写”。

## 10. 多种审批回复格式

### 10.1 总原则

允许多种用户交互格式，但只保留一种后端审批语义。

所有格式最终都要归一为：

- `approvalId`
- `decision`
- `actor identity`
- `transport`

### 10.2 正式支持格式

#### A. 原生 UI 审批

来源：

- OpenClaw 原生审批 UI
- Control UI
- webchat 原生审批

特点：

- 最优先
- 与当前被拦工具调用的恢复链路天然兼容

#### B. 标准聊天命令审批

唯一标准语法：

```text
/approve <id> allow-once|allow-always|deny
```

特点：

- 所有聊天通道通用
- 文本可审计
- 不依赖图形界面

#### C. 飞书审批卡片

特点：

- 飞书内的按钮式审批
- 不打开 web 页面
- 属于聊天内原生交互

设计要求：

- 卡片点击最终直接转为统一审批动作
- 不再视为自由文本消息审批

### 10.3 可选支持格式

可配置别名：

- `批准 <id>`
- `拒绝 <id>`

说明：

- 默认关闭
- 若启用，也必须携带 `id`
- 只作为 `/approve` 的本地化包装

### 10.4 禁止格式

以下输入不再被视为审批：

- `同意`
- `批准`
- `确认放行本次操作`
- 任意不带 `approvalId` 的自由文本

## 11. 飞书设计

### 11.1 身份

飞书审批权限使用 `ou_id` 归一化后判断。

审批权限要求：

- 只有配置的 `owner/approver` 可审批
- 请求人本身默认不可审批，除非其也是 approver

### 11.2 卡片动作

飞书卡片需携带：

- `approvalId`
- `expectedApproverOuId`
- `expectedChatId`
- `expiresAt`
- `sessionKey`

卡片点击校验：

- 是否为预期用户
- 是否在预期会话 / 群
- 是否未过期

### 11.3 飞书卡片处理建议

建议将飞书卡片从“合成普通会话命令”升级为“直接调用审批 resolve”。

原因：

- 减少审批与普通消息通道混用
- 避免审批动作受普通 group session 排队影响
- 审批平面与对话平面分离

### 11.4 无图形页面时的审批路径

飞书无法拿到 webchat / Control UI 时，仍可使用：

- `/approve`
- 飞书卡片

这两者均属于聊天内审批，不需要外部页面。

## 12. 群聊与共享 session 问题

### 12.1 安全上能解决什么

本方案能保证：

- 其他群成员不能消费本次审批
- 其他群成员不能借用本次 grant
- 审批结果只对原 `runId` 生效
- grant 只对原 `runId + requesterOuId + module` 生效

### 12.2 吞吐上不能解决什么

在不改变 OpenClaw 默认 `group` session 的前提下，审批等待期间：

- 原 run 仍占据当前 group session 的执行 lane
- 其他发给 bot 的群消息会排队
- 无法做到“同群其他 bot 请求完全不受影响”

### 12.3 设计结论

共享群 session 下，系统目标是：

- 不串单
- 不抢批
- 不借权
- 不因 Lynx 主动拒绝其他消息

但不保证：

- 审批等待期间 bot 对同群其他触发消息实时回复

### 12.4 缓解策略

- 审批动作尽量走控制平面，不走普通会话平面
- 群里只提示一次短说明
- 审批消息优先发给 owner/approver 的 DM 或显式审批目标
- 审批超时后快速结束当前 run，释放 lane

## 13. 审批窗口与超时

### 13.1 两种窗口

#### A. 审批等待窗口

定义：

- 审批请求从创建到失效的时间

建议值：

- 默认 120 秒
- 可配置 60-300 秒

#### B. grant 窗口

定义：

- 审批通过后，同模块链式续跑可自动放行的时间窗

建议值：

- 默认 120 秒
- 可配置 60-180 秒

### 13.2 超时行为

- 审批等待超时：当前审批失效，tool 调用失败
- grant 超时：后续 tool 不再自动放行，重新审批

## 14. 文案统一

### 14.1 请求人文案

建议文案：

`该工具调用已暂停，等待 owner/approver 审批，120 秒内有效。审批通过后将继续当前操作。`

### 14.2 审批人文案

标准文案：

`/approve <id> allow-once|allow-always|deny`

### 14.3 群里其他成员文案

建议文案：

`当前有待审批高风险操作，相关机器人回复可能稍后返回。`

### 14.4 删除文案

以下旧文案需全部移除：

- `回复"同意"后重试`
- `确认放行本次操作`

## 15. 对现有识别能力的影响

### 15.1 明确保留

以下能力必须保持行为一致：

- 风险证据收集
- 维度评分
- 模块命中
- L0-L4 级别判断
- 黑名单和规则拦截
- 攻击链推断
- 审计记录生成

### 15.2 可允许的变化

允许变化的只有处置输出：

- `L2/L3` 不再返回自由文本确认，而是发起原生审批
- 审批通过后的放权改为 run-bound grant
- 旧 `workflow_auth(scopeAll=true)` 不再使用

## 16. 数据存储建议

### 16.1 RequesterProvenanceStore

用途：

- 记录入站请求人与会话关系
- 为 run 建立 requester provenance

键：

- `sessionKey`
- 可选辅助键：`conversationId + timestamp bucket`

### 16.2 RunApprovalContextStore

用途：

- 从 run 角度绑定 requester、session、approval

键：

- `runId`

### 16.3 ApprovalGrantStore

用途：

- 记录当前 run 的有效链式 grant

键：

- `runId`

### 16.4 审计记录

应记录：

- 谁发起了请求
- 哪个模块触发了审批
- 由谁批准或拒绝
- 使用了何种 transport
- grant 是否命中
- grant 是否超时

注：

当前 OpenClaw `onResolution` 对插件仅回调决策，不回传 `resolvedBy`。若要在 Lynx 内完整记录审批人身份，后续可能需要扩展桥接能力。

## 17. 迁移策略

### 第一阶段

- 移除工具自由文本确认入口
- 在 `before_tool_call` 切换为 `requireApproval`
- 保留原有识别逻辑

### 第二阶段

- 引入 run-bound `ApprovalGrantStore`
- 替换旧 `workflow_auth`
- 移除 `scopeAll=true`

### 第三阶段

- 飞书卡片改为直接 resolve
- 增加 requester provenance 与 run context 绑定

### 第四阶段

- 清理旧 pending override fallback
- 删除自由文本确认遗留配置和文案

## 18. 回归测试建议

### 18.1 工具审批

- tool 命中 L2 时触发审批
- 审批通过后恢复当前 tool
- 审批拒绝后 tool 失败
- 审批超时后 tool 失败

### 18.2 grant

- 同模块、同级别后续 tool 自动放行
- 同模块、更低级别后续 tool 自动放行
- 同模块、更高级别重新审批
- 不同模块重新审批
- grant 超时后重新审批

### 18.3 群聊隔离

- A 用户发起危险 tool，B 用户不能 `/approve` 成功
- A 用户发起危险 tool，B 用户后续消息不能命中 grant
- A 用户审批通过后，仅 A 对应 run 可用 grant

### 18.4 飞书

- approver 可通过 `/approve` 成功审批
- 非 approver `/approve` 被拒绝
- 卡片点击用户不匹配时拒绝
- 卡片点击群不匹配时拒绝
- 卡片过期时拒绝

### 18.5 非工具请求

- `before_agent_start` 命中高风险输入时直接拒绝
- `before_message_write` 命中输出风险时直接阻断或脱敏
- 非 tool 场景不出现审批入口

## 19. 最终决策摘要

本方案最终确定如下：

- 风险识别层保持不变
- 工具审批统一迁移到 OpenClaw 原生插件审批
- 审批后直接恢复当前工具调用
- 链式放权仅限同模块、同级或更低风险
- 非工具高风险请求不审批，直接拒绝并要求改写
- 飞书支持聊天内 `/approve` 与审批卡片
- 禁止自由文本“同意”式确认
- 群聊下保证“不串单、不抢批、不借权”，但不保证审批等待期间同群其他 bot 请求零排队

## 20. 开放问题

- Lynx 是否需要在审计中完整记录 `resolvedBy`，若需要则需扩展 OpenClaw 桥接字段。
- 飞书审批卡片是否在本阶段直接改成 `resolve` 调用，还是先保留“合成命令”过渡。
- 本地化命令别名是否需要启用；默认建议关闭。
