# Local Console Frontend Screen Alignment Design

## Scope

本文用于把 `local-console-v1` 的前端静态页设计与 Stitch 参考屏对齐，作为后续 `frontend/` 落地时的视觉和页面骨架基线。

适用范围：

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\frontend`
- `docs/superpowers/specs/2026-04-22-local-console-logging-design.md`
- `docs/superpowers/specs/2026-04-22-local-console-query-api-dto-design.md`
- `docs/superpowers/plans/2026-04-23-local-console-v1-implementation.md`

本文不做：

- 不改 backend API / DTO 设计
- 不新增未在 query spec 中定义的写接口
- 不把 Stitch 参考图里的所有按钮都照搬成真实功能
- 不宣称当前 `frontend/` 已有可复用 scaffold

## Source Of Truth

### 已验证的 Stitch 项目

- Project ID: `15606216198597645842`

### 当前用于对齐的 6 个参考 screen

1. `安全概览 (Security Overview) - 统一重构版`
   - `projects/15606216198597645842/screens/8bbd6823d7314c0988591569460845b8`
2. `安全审计日志 (Audit Logs) - 统一重构版`
   - `projects/15606216198597645842/screens/91513a2401e14e18b73f1420e064bdf3`
3. `检查任务 (Check Tasks) - 统一重构版`
   - `projects/15606216198597645842/screens/49005aa67cd94c778764bbe846a9481a`
4. `Token 统计 (Token Stats) - 统一重构版`
   - `projects/15606216198597645842/screens/0d476329d64c4efc9ecdd5f894cabad9`
5. `工具调用审计 (Tool Calls) - 统一重构版`
   - `projects/15606216198597645842/screens/31c7fd668e724ac294d84afc60b62c54`
6. `审批管理 (Approvals) - 统一重构版`
   - `projects/15606216198597645842/screens/0282e6839fa446b691603fedd1e2bc45`

### 当前明确不存在的参考 screen

通过重新读取 Stitch 项目当前 screen 列表，未发现可直接复用的：

- `Sessions / 会话`
- `Lynx Checks` 命名 screen

其中 `Lynx Checks` 采用 `Check Tasks` screen 作为等价视觉参考；`Sessions` 页面需要按同一视觉语言本地补设计，不能假装 Stitch 已给出成品。

## Shared Visual Language

6 个参考 screen 的共同骨架已经足够稳定，前端应统一采用：

- 左侧固定导航栏，桌面端常驻
- 主内容区为浅灰背景上的白色卡片
- 卡片圆角使用 `22px` 主圆角
- 主体为企业审计控制台气质，不做消费级炫技
- 颜色以冷白、浅灰、黑字、少量蓝色强调为主
- 页面 header 采用“标题 + 一句解释 + 右侧状态/操作区”
- 列表页普遍采用“顶部 KPI 卡 + 筛选条 + 数据表 + 详情上下文”

结合 `DESIGN.md` 与屏幕实测 HTML，可收敛为以下实现原则：

- 背景色以 `#f9f9fd` 一类浅冷灰为主
- 卡片面使用白色，边框使用冷灰 `#d9d9dd` 或 `#e5e7eb`
- 交互强调色使用蓝色，而不是大面积品牌色块
- 标题可保留 serif/sans 的层级感，但组件默认仍以清晰可读为第一优先

## Global Shell

### 侧边导航

静态页 v1 的主导航应统一为：

1. `Dashboard`
2. `Events`
3. `Tool Calls`
4. `Approvals`
5. `Lynx Checks`
6. `Sessions`
7. `Tokens`

注意：

- Stitch 参考图里没有 `Sessions`
- 参考图里把 `Lynx Checks` 命名为 `Check Tasks`

因此本地实现时导航文案要服从 query spec 与本项目领域命名，而不是盲目照抄参考图标题。

### 全局共用组件

前端静态页应优先抽成以下可复用组件，而不是每页重复拼：

- `ConsoleLayout`
- `SidebarNav`
- `PageHeader`
- `MetricCard`
- `FilterBar`
- `DataTable`
- `StatusBadge`
- `TrendCard`
- `DistributionCard`
- `DetailPanel` 或 `DetailDrawer`

## Page Mapping

### 1. `DashboardPage`

参考来源：

- `Security Overview`
- DTO: `GET /api/dashboard/overview`

推荐页面骨架：

- 顶部 5 到 6 张总览卡
- 风险分布卡
- 动作分布卡
- 趋势区
- 最近高风险事件表
- 最近工具调用与最近审批的紧凑列表

与 DTO 的真实对齐方式：

- 不照抄参考图里的 `L0/L1/L2/L3/L4` 五段 KPI
- 顶部卡片应优先使用真实 `DashboardOverviewDto.totals`
  - `eventCount`
  - `highRiskEventCount`
  - `toolCallCount`
  - `approvalCount`
  - `lynxCheckCount`
  - `totalTokens`，仅在 `tokenUsageEnabled=true` 时显示
- 风险分布使用 `riskDistribution`
- 动作分布使用 `enforcementDistribution`
- 趋势至少包含 `eventTrend`
- `tokenTrend` 作为第二张趋势卡，若 token 能力关闭则隐藏整块

实现结论：

- Dashboard 只借 `Security Overview` 的“控制台总览页”视觉结构
- 具体数据项必须服从 DTO，而不是服从参考图里的虚构指标名

### 2. `EventsPage`

参考来源：

- `Audit Logs`
- DTO: `GET /api/events` / `GET /api/events/:eventId`

推荐页面骨架：

- 页面标题与解释文案
- 一行筛选区
- 主数据表
- 详情面板

筛选区只能使用 spec 中已存在的字段：

- `fromMs`
- `toMs`
- `riskLevel`
- `enforcementAction`
- `hookName`
- `eventType`
- `category`
- `subCategory`
- `direction`
- `primaryModule`
- `requestId`
- `toolCallId`
- `approvalId`

明确不要做：

- 不做参考图里的通用全文搜索 DSL
- 不做“导出 CSV”真实功能，除非 backend 后续补接口

主表列建议：

- `eventId`
- `category`
- `title`
- `riskLevel`
- `enforcementAction`
- `policyDecision`
- `occurredAtMs`

行内次级信息可展示：

- `summary`
- `hookName`
- `primaryModule`

详情面板读取：

- `payloadJson`
- `modules`
- `recommendation`
- `contentExcerpt`

### 3. `ToolCallsPage`

参考来源：

- `Tool Calls`
- DTO: `GET /api/tool-calls` / `GET /api/tool-calls/:toolCallId`

推荐页面骨架：

- 顶部 3 到 4 张工具审计 KPI 卡
- 筛选条
- 调用流水表
- 高频工具或健康状态的次级卡片

筛选条使用：

- `fromMs`
- `toMs`
- `riskLevel`
- `enforcementAction`
- `toolName`
- `resultStatus`
- `approvalId`

主表列建议：

- `toolCallId`
- `toolName`
- `startedAtMs`
- `resultStatus`
- `durationMs`
- `riskLevel`
- `resultExcerpt`

详情面板读取：

- `paramSummary`
- `triggeredModules`
- `errorText`
- `metadataJson`

### 4. `ApprovalsPage`

参考来源：

- `Approvals`
- DTO: `GET /api/approvals` / `GET /api/approvals/:approvalId`

推荐页面骨架：

- 顶部治理类 KPI 卡
- 分段标签或状态切换
- 审批列表表格
- 详情抽屉

允许实现的筛选条件：

- `fromMs`
- `toMs`
- `riskLevel`
- `enforcementAction`
- `resolution`
- `toolName`
- `module`
- `scopeType`
- `requesterOuId`

主表列建议：

- `approvalId`
- `requesterOuId`
- `module`
- `riskLevel`
- `scopeType`
- `promptExcerpt`
- `resolution`
- `requestedAtMs`

详情面板读取：

- `channelProfile`
- `channelId`
- `accountId`
- `conversationId`
- `approverOuIds`
- `resolvedApproverOuId`
- `requestFingerprintHash`
- `auditSummaryJson`

明确不要做：

- 不做参考图里的真实“批量处理”
- 不做任何 mutation 审批动作按钮，除非后续新增写接口

### 5. `LynxChecksPage`

参考来源：

- `Check Tasks`
- DTO: `GET /api/lynx-checks` / `GET /api/lynx-checks/:requestId`

命名转换：

- 视觉来源仍然是 `Check Tasks`
- 本地路由和页面标题统一使用 `Lynx Checks`

推荐页面骨架：

- 顶部任务运行 KPI
- 任务执行列表
- 详情面板

筛选条件使用：

- `fromMs`
- `toMs`
- `source`
- `trigger`
- `status`
- `messageProvider`

主表列建议：

- `requestId`
- `source`
- `trigger`
- `status`
- `messageProvider`
- `createdAtMs`
- `completedAtMs`

详情面板读取：

- `preferredTargetKind`
- `sessionKey`
- `targetKey`
- `channelId`
- `deliveryAttemptsJson`

明确不要做：

- 不承诺参考图里的“实时流式日志”能力
- v1 若没有单独日志流接口，就把底部日志区改为详情面板里的最近投递尝试或运行摘要

### 6. `TokensPage`

参考来源：

- `Token Stats`
- DTO: `GET /api/tokens/usage`
- DTO: `GET /api/tokens/summary`
- DTO: `GET /api/tokens/trend`

推荐页面骨架：

- 顶部用量总览卡
- 输入/输出占比卡
- 趋势图
- usage 明细表

卡片优先使用：

- `totalTokens`
- `inputTokens`
- `outputTokens`
- `cacheReadTokens`
- `cacheWriteTokens`
- `estimatedCount`

主表列建议：

- `sessionKey`
- `model`
- `provider`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `isEstimated`
- `occurredAtMs`

明确不要做：

- 不照抄参考图里的模型品牌列表
- 只展示 query spec 当前真实可返回的 provider/model 统计

### 7. `SessionsPage`

参考来源：

- 无直接 Stitch screen
- 视觉语言继承 `Audit Logs`、`Tool Calls`、`Token Stats`
- DTO: `GET /api/sessions` / `GET /api/sessions/:sessionKey`

这是本次设计里唯一需要本地补设计的页面。

推荐页面骨架：

- 顶部 4 张轻量 KPI 卡
- 会话列表表格
- 右侧详情面板或详情页

KPI 卡建议按当前列表结果即时聚合，不要求额外接口：

- `Total Sessions`
- `Active Sessions`
- `Group Sessions`
- `High-Risk Sessions`

主表列建议：

- `sessionKey`
- `channelProfile`
- `requesterOuId` 或 `requesterId`
- `isGroup`
- `firstSeenAtMs`
- `lastSeenAtMs`
- `eventCount`
- `highRiskEventCount`
- `toolCallCount`

详情面板读取：

- `metadataJson`
- `recentEvents`
- `recentToolCalls`
- `recentApprovals`
- `tokenSummary`

设计结论：

- `SessionsPage` 不需要额外 Stitch 页面后才能开工
- 直接复用统一 shell、表格和详情面板语法即可

## Controls To Drop Or Defer

以下控件在参考图中出现，但不应在 v1 中直接做成真实功能：

- `导出 CSV`
- `导出报告`
- `批量处理`
- `立即刷新` 之外的复杂任务控制
- `实时流式日志`
- 全文搜索 DSL

处理方式：

- 若视觉上需要保留，可先隐藏
- 或保留为 disabled 状态并显式标注“v1 not available”
- 不要做成可点击但无后端支撑的假功能

## Implementation Implications

为了减少“先做出来再拆”的返工，前端实现顺序应按参考充分度推进：

1. `ConsoleLayout` + 设计 token + 基础卡片/表格/筛选组件
2. `DashboardPage`
3. `EventsPage`
4. `ToolCallsPage`
5. `ApprovalsPage`
6. `LynxChecksPage`
7. `TokensPage`
8. `SessionsPage`

排序原则：

- 先做有直接 Stitch 参考的页面
- 最后做唯一需要局部补设计的 `SessionsPage`

## Final Decision

前端静态页 v1 不应试图“完全复刻” Stitch 图稿，而应采用：

- 共用的企业控制台 shell
- 与 query DTO 严格对齐的页面信息架构
- 对 6 个 Stitch screen 的一一映射复用
- 对 `SessionsPage` 的同风格本地补设计

这条路的好处是：

- 视觉不会漂
- 数据字段不会编
- 不会因为参考图里多出若干按钮，就把 backend 带向未批准的范围
