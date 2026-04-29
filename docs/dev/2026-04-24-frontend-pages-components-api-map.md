# Lynx Guardian Frontend 页面、组件与 API 对照表

生成时间：2026-04-24

适用目录：`C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\frontend`

本文按当前工作区源码整理，不按 `HEAD` 旧版本推断。当前前端已经是独立的 Vite + React 项目，并通过本地控制台 backend 查询 SQLite 中的 Lynx Guardian 审计数据。

## 1. 总体架构

### 1.1 前端项目定位

`frontend/` 是 Lynx Guardian 本地日志控制台的 Webview 前端。

核心职责：

- 展示本地审计日志、工具调用、审批、检查任务、会话、Token 用量等数据。
- 只通过只读 Query API 拉取数据，不直接写 SQLite。
- 页面在开发时由 Vite 提供，在插件运行时由本地 backend 静态托管到 `/webview/`。

技术栈：

- React 19
- React Router 7
- Vite 8
- TypeScript
- 共享 DTO 包：`@lynx/local-console-shared`

入口文件：

- `frontend/src/main.tsx`
- `frontend/src/app/App.tsx`
- `frontend/src/app/router.tsx`

### 1.2 运行路径

前端页面和接口的实际链路是：

```text
浏览器 / OpenClaw Webview
  -> GET /webview/*
  -> OpenClaw gateway 插件路由
  -> local-console backend 静态资源服务
  -> frontend/dist

浏览器 fetch("/lynx/...")
  -> OpenClaw gateway 插件路由
  -> local-console backend Query API
  -> SQLite: %USERPROFILE%\.openclaw\lynx\data\lynx.db
```

写入侧链路是：

```text
Lynx Guardian plugin hooks
  -> src/runtime/local-console-hook-handlers.ts
  -> src/runtime/local-console-event-builder.ts
  -> src/runtime/local-console-client.ts
  -> POST /lynx/internal/v1/ingest/batch
  -> backend/src/services/ingest-service.ts
  -> SQLite
```

### 1.3 路径前缀

当前实现里的实际前缀：

- Webview 静态页面：`/webview/`
- Query API：`/lynx`
- Ingest API：`/lynx/internal/v1`

关键源码：

- `frontend/vite.config.ts`
  - `base: "/webview/"`
  - dev proxy: `"/lynx" -> "http://127.0.0.1:31789"`
- `shared/src/enums.ts`
  - `LOCAL_CONSOLE_API_BASE_PATH = "/lynx"`
- `frontend/src/api/client.ts`
  - 默认用 `VITE_LYNX_API_BASE_PATH ?? "/lynx"`
- `backend/src/app.ts`
  - Query routes 注册在 `/lynx`
  - Ingest routes 注册在 `/lynx/internal/v1`
- `src/runtime/local-console-gateway-routes.ts`
  - OpenClaw gateway 代理 `/webview` 和 `/lynx`

注意：旧设计文档中部分接口写作 `/api/...`，当前代码实际是 `/lynx/...`。

## 2. 前端目录结构

```text
frontend/
  index.html
  package.json
  vite.config.ts
  src/
    main.tsx
    app/
      App.tsx
      router.tsx
      nav-config.ts
    api/
      client.ts
      dashboard.ts
      events.ts
      tool-calls.ts
      approvals.ts
      lynx-checks.ts
      sessions.ts
      tokens.ts
    components/
      layout/
      cards/
      tables/
      filters/
      feedback/
      detail/
    hooks/
      useListDetailResource.ts
    pages/
      DashboardPage.tsx
      EventsPage.tsx
      ToolCallsPage.tsx
      ApprovalsPage.tsx
      LynxChecksPage.tsx
      SessionsPage.tsx
      TokensPage.tsx
      NotFoundPage.tsx
    data/
      mock-console.ts
      filter-presets.ts
    utils/
      format.ts
      status.tsx
    styles/
      reset.css
      tokens.css
      theme.css
```

## 3. 路由与页面总表

| 路由 | 页面文件 | 导航入口 | 主要 API | 页面作用 |
| --- | --- | --- | --- | --- |
| `/` | `DashboardPage.tsx` | 有 | `GET /lynx/dashboard/overview` | 安全概览大盘，展示风险等级、风险分布、趋势和最近高风险事件 |
| `/events` | `EventsPage.tsx` | 有 | `GET /lynx/events?limit=20` | 审计日志列表，展示事件类别、风险、策略动作、处置建议和发生时间 |
| `/tool-calls` | `ToolCallsPage.tsx` | 有 | `GET /lynx/tool-calls?limit=20` | 工具调用流水，展示调用数量、状态、耗时、结果摘要和高频工具 |
| `/approvals` | `ApprovalsPage.tsx` | 有 | `GET /lynx/approvals?limit=20` | 审批管理，展示待处理/已处理审批和审批摘要 |
| `/lynx-checks` | `LynxChecksPage.tsx` | 有 | `GET /lynx/lynx-checks?limit=20` | `/lynx-check` 检查任务列表，展示运行状态、投递状态和报告路径 |
| `/sessions` | `SessionsPage.tsx` | 无 | `GET /lynx/sessions?limit=20` + `GET /lynx/sessions/:sessionKey` | 会话索引与第一条会话详情 |
| `/tokens` | `TokensPage.tsx` | 有 | `GET /lynx/tokens/summary` + `GET /lynx/tokens/usage?limit=20` + `GET /lynx/tokens/trend?bucket=hour` | Token 用量、输入输出比例、趋势和 usage 明细 |
| `*` | `NotFoundPage.tsx` | 无 | 无 | 未匹配路由提示 |

定位点：

- `SessionsPage` 有完整路由和页面，但 `frontend/src/app/nav-config.ts` 当前没有 `sessions` 导航项，所以正常侧边栏进不去。
- 多个页面使用普通 `<a href="/events">`、`<a href="/tool-calls#...">` 这类绝对路径。页面部署在 `/webview/` basename 下时，这类链接可能跳到 gateway 根路径，而不是 `/webview/events`。需要改成 React Router `Link` 或拼上 basename。

## 4. 页面详细说明

### 4.1 DashboardPage

文件：`frontend/src/pages/DashboardPage.tsx`

调用：

- `getDashboardOverview()`
- 实际请求：`GET /lynx/dashboard/overview`

当前页面功能：

- 加载安全概览 DTO。
- 显示 L0-L4 五个风险等级卡片。
- 显示总事件数。
- 用 `riskDistribution` 生成环形风险分布。
- 用 `eventTrend` 生成最近 7 个点的趋势柱状图。
- 用 `recentHighRiskEvents` 生成最近安全事件表。

数据来源字段：

- `totals.eventCount`
- `riskDistribution`
- `eventTrend`
- `recentHighRiskEvents`

当前未充分使用但 backend 已返回的字段：

- `totals.highRiskEventCount`
- `totals.toolCallCount`
- `totals.approvalCount`
- `totals.lynxCheckCount`
- `totals.totalTokens`
- `enforcementDistribution`
- `tokenTrend`
- `recentToolCalls`
- `recentApprovals`

错误与 fallback：

- 开发环境接口失败时使用 `mockDashboard`。
- 生产环境接口失败时使用空 Dashboard 并显示错误。

适合定位的问题：

- Dashboard 卡片数和 DTO totals 不完全一致时，看 `DashboardPage.tsx`。
- 风险环不显示时，看 `riskDistribution` 是否为空，以及 `buildRiskRingBackground()`。
- 最近工具调用/审批没有出现在首页，不是后端没给，而是当前页面没有渲染这些字段。

### 4.2 EventsPage

文件：`frontend/src/pages/EventsPage.tsx`

调用：

- `listEvents({ limit: 20 })`
- 实际请求：`GET /lynx/events?limit=20`

当前页面功能：

- 加载最新 20 条审计事件。
- 展示 PageHeader。
- 展示一组静态筛选按钮。
- 展示事件表格。

表格字段：

- `eventId`
- `category`
- `riskLevel`
- `enforcementAction`
- `title`
- `summary`
- `occurredAtMs`

已封装但当前页面没有调用：

- `getEventDetail(eventId)`
- 实际接口：`GET /lynx/events/:eventId`

当前限制：

- 筛选按钮只是视觉控件，没有状态，也不会改变请求参数。
- 没有分页加载 `nextCursor`。
- 没有详情面板。
- “导出 CSV”“立即刷新”按钮没有真实事件处理。

适合定位的问题：

- 列表无数据：先查 `GET /lynx/events?limit=20`。
- 筛选无效：当前页面未接筛选状态，不是 backend 筛选一定失效。
- 详情打不开：详情 API 已封装，但页面没有调用。

### 4.3 ToolCallsPage

文件：`frontend/src/pages/ToolCallsPage.tsx`

调用：

- `listToolCalls({ limit: 20 })`
- 实际请求：`GET /lynx/tool-calls?limit=20`

当前页面功能：

- 加载最新 20 条工具调用。
- 顶部展示总调用数、成功率、最大耗时、异常调用数。
- 表格展示调用 ID、工具名、调用时间、状态、耗时、结果摘要。
- 统计当前列表中 Top 3 高频工具。
- 下方展示一块静态“审计系统状态”。

表格字段：

- `toolCallId`
- `toolName`
- `startedAtMs`
- `resultStatus`
- `durationMs`
- `resultExcerpt`

已封装但当前页面没有调用：

- `getToolCallDetail(toolCallId)`
- 实际接口：`GET /lynx/tool-calls/:toolCallId`

当前限制：

- “查看 JSON”是普通 hash 链接，没有拉详情。
- 搜索和筛选按钮没有真实事件处理。
- 页面文案写“平均耗时 (P50)”，但实际用的是当前列表最大 `durationMs`。

适合定位的问题：

- 工具调用有写入但页面没有：查 `GET /lynx/tool-calls?limit=20` 和 `tool_calls` 表。
- “查看 JSON”没效果：当前页面没有接 detail API。
- 耗时指标不符合预期：看 `maxDuration` 的计算方式。

### 4.4 ApprovalsPage

文件：`frontend/src/pages/ApprovalsPage.tsx`

调用：

- `listApprovals({ limit: 20 })`
- 实际请求：`GET /lynx/approvals?limit=20`

当前页面功能：

- 加载最新 20 条审批。
- 统计 pending、approved/completed、blocked/failed。
- 展示审批列表表格。
- 展示一段静态“二次确认流程机制”说明卡片。

表格字段：

- `approvalId`
- `requesterOuId`
- `riskLevel`
- `scopeType`
- `promptExcerpt`
- `resolution`

已封装但当前页面没有调用：

- `getApprovalDetail(approvalId)`
- 实际接口：`GET /lynx/approvals/:approvalId`

当前限制：

- “查看详情”是 hash 链接，没有详情抽屉或详情页。
- “导出报告”“批量处理”“待审核/历史记录/搜索”按钮没有真实后端写接口。
- 这是只读页面，不应被误认为可以真正审批或批量处理。

适合定位的问题：

- 审批记录写入后不显示：查 `GET /lynx/approvals?limit=20` 和 `approvals` 表。
- 审批动作按钮无效：当前前端和 backend 都没有 mutation 审批接口。

### 4.5 LynxChecksPage

文件：`frontend/src/pages/LynxChecksPage.tsx`

调用：

- `listLynxChecks({ limit: 20 })`
- 实际请求：`GET /lynx/lynx-checks?limit=20`

当前页面功能：

- 加载最新 20 条 `/lynx-check` 任务。
- 展示任务总量、运行中、失败率、平均耗时卡片。
- 表格展示 requestId、触发来源、处理状态、通知状态、报告路径、创建时间。
- 下方包含静态运行日志和静态安全概览。

表格字段：

- `requestId`
- `trigger`
- `status`
- `sendAttempted`
- `sendSucceeded`
- `reportPath`
- `createdAtMs`

已封装但当前页面没有调用：

- `getLynxCheckDetail(requestId)`
- 实际接口：`GET /lynx/lynx-checks/:requestId`

当前限制：

- “实时运行日志”是静态字符串，不是后端日志流。
- “安全概览”是静态展示，不等于 backend 实时健康分析。
- 平均耗时目前固定写 `formatDuration(450)`，没有从 completed/created 时间计算。

适合定位的问题：

- `/lynx-check` 执行了但页面没有：查 `GET /lynx/lynx-checks?limit=20`、`lynx_checks` 表，以及 `%USERPROFILE%\.openclaw\lynx\check-runs`。
- 任务详情缺少投递尝试：detail API 已封装但页面未调用。

### 4.6 SessionsPage

文件：`frontend/src/pages/SessionsPage.tsx`

调用：

- `listSessions({ limit: 20 })`
- 实际请求：`GET /lynx/sessions?limit=20`
- 对第一条结果继续调用 `getSessionDetail(sessionKey)`
- 实际请求：`GET /lynx/sessions/:sessionKey`

当前页面功能：

- 通过通用 hook `useListDetailResource()` 先拉列表。
- 如果列表有数据，自动拉第一条会话详情。
- 顶部显示总会话、活跃会话、群聊会话、高风险会话。
- 表格展示会话台账。
- 右侧 `DetailPanel` 展示第一条会话详情摘要。

表格字段：

- `sessionKey`
- `channelProfile`
- `eventCount`
- `highRiskEventCount`
- `lastSeenAtMs`

详情字段：

- `recentEvents.length`
- `recentToolCalls.length`
- `recentApprovals.length`
- `tokenSummary`

当前限制：

- 当前导航没有 `/sessions` 入口。
- 列表行没有点击切换详情，永远只显示第一条详情。
- 页面没有开发环境 mock fallback；接口失败直接空列表 + 错误。

适合定位的问题：

- 会话页无法访问：路由存在，导航缺失；可手动访问 `/webview/sessions`。
- 详情总是第一条：看 `useListDetailResource()` 的默认行为。
- 会话统计与列表不一致：页面统计是基于当前 20 条列表即时聚合，不是全量统计。

### 4.7 TokensPage

文件：`frontend/src/pages/TokensPage.tsx`

调用：

- `getTokenSummary()`
- 实际请求：`GET /lynx/tokens/summary`
- `getTokenUsage(20)`
- 实际请求：`GET /lynx/tokens/usage?limit=20`
- `getTokenTrend("hour")`
- 实际请求：`GET /lynx/tokens/trend?bucket=hour`

当前页面功能：

- 并行加载 summary、usage、trend。
- 展示总 Token、输入/输出占比、静态 latency 卡。
- 展示 7 个趋势横轴标签。
- 表格展示 usage 明细。

表格字段：

- `sessionKey`
- `model`
- `provider`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `isEstimated`
- `occurredAtMs`

当前限制：

- backend 提供 `/lynx/meta/capabilities`，但当前 TokensPage 没有调用它判断 `tokenUsageEnabled`。
- latency 卡和模型 legend 是静态视觉元素，不来自 backend。
- 趋势区域当前只画横轴标签，没有真正按 `trend.points` 画柱线。
- “过去 24 小时”“导出报告”按钮没有真实事件处理。

适合定位的问题：

- Token 页面有请求但无数据：查 `token_usage` 表、`/lynx/tokens/summary`、`/lynx/tokens/usage`。
- Token 能力关闭但页面仍显示：当前前端没有读取 capability。
- 趋势图不出柱状图：当前页面未实现真实趋势图。

### 4.8 NotFoundPage

文件：`frontend/src/pages/NotFoundPage.tsx`

调用：

- 无后端 API。

作用：

- 兜底未匹配路由。
- 提供返回概览页的 `Link`。

## 5. 组件功能表

### 5.1 布局组件

| 组件 | 文件 | 作用 | 当前使用位置 |
| --- | --- | --- | --- |
| `ConsoleLayout` | `components/layout/ConsoleLayout.tsx` | 全局 shell，左侧 `SidebarNav` + 右侧 `TopBar` + 内容区 | `App.tsx` |
| `SidebarNav` | `components/layout/SidebarNav.tsx` | 侧边栏品牌、导航、用户区域；图标是本地 SVG | `ConsoleLayout` |
| `TopBar` | `components/layout/TopBar.tsx` | 根据当前 pathname 从 nav-config 解析页面标题，右侧显示通知/账户按钮 | `ConsoleLayout` |
| `PageHeader` | `components/layout/PageHeader.tsx` | 页面标题、说明、eyebrow、右侧 actions 的通用头部 | Events、Approvals、Sessions、NotFound |

定位点：

- `TopBar` 依赖 `PRIMARY_NAV_ITEMS` 解析标题，`SessionsPage` 不在 nav-config 时会 fallback 到 `Lynx Guardian`。
- `SidebarNav` 的导航来自 `PRIMARY_NAV_ITEMS`，所以新增页面必须同步改 `nav-config.ts`。

### 5.2 展示组件

| 组件 | 文件 | 作用 | 当前使用位置 |
| --- | --- | --- | --- |
| `MetricCard` | `components/cards/MetricCard.tsx` | 通用指标卡，展示 label/value/note | SessionsPage |
| `TrendCard` | `components/cards/TrendCard.tsx` | 轻量柱状趋势卡 | 当前未使用 |
| `DistributionCard` | `components/cards/DistributionCard.tsx` | 横向分布条列表 | 当前未使用 |
| `DataTable` | `components/tables/DataTable.tsx` | 简单表格渲染，按 columns 和 rows 输出 | Dashboard、Events、ToolCalls、Approvals、LynxChecks、Sessions、Tokens |
| `StatusBadge` | `components/feedback/StatusBadge.tsx` | 状态徽标，支持 neutral/info/warning/danger/success | `utils/status.tsx`、SessionsPage |
| `FilterBar` | `components/filters/FilterBar.tsx` | 静态筛选 chip 容器 | SessionsPage |
| `DetailPanel` | `components/detail/DetailPanel.tsx` | 详情字段面板 | SessionsPage |

当前限制：

- `DataTable` 没有空状态、排序、分页、行点击事件。
- `FilterBar` 只渲染按钮，不管理筛选状态。
- `TrendCard` 和 `DistributionCard` 已抽出来但没有被当前页面复用。

### 5.3 Hook 与工具函数

| 模块 | 文件 | 作用 |
| --- | --- | --- |
| `useListDetailResource` | `hooks/useListDetailResource.ts` | 先加载列表，再自动加载第一条详情；用于 SessionsPage |
| `format.ts` | `utils/format.ts` | 数字、时间、日期、耗时格式化 |
| `status.tsx` | `utils/status.tsx` | action/state/channel/category/hook/tool 的中文展示，以及 badge 渲染 |
| `filter-presets.ts` | `data/filter-presets.ts` | 静态筛选 chip 文案 |
| `mock-console.ts` | `data/mock-console.ts` | 开发环境接口失败时的 mock 数据 |

## 6. 前端 API 封装

### 6.1 API client

文件：`frontend/src/api/client.ts`

职责：

- 读取 `VITE_LYNX_API_BASE_PATH`。
- 默认使用 `LOCAL_CONSOLE_API_BASE_PATH`，即 `/lynx`。
- 拼接相对 API path。
- 构造 query string。
- `fetchJson<T>()` 统一处理非 2xx 错误。

错误处理：

- 如果响应是 JSON 且有 `message`，抛出该 message。
- 否则尝试读取 text。
- 最后 fallback 到 HTTP status/statusText。

### 6.2 API 模块对照

| 前端模块 | 函数 | 实际请求 |
| --- | --- | --- |
| `api/dashboard.ts` | `getDashboardOverview(query?)` | `GET /lynx/dashboard/overview` |
| `api/events.ts` | `listEvents(query?)` | `GET /lynx/events` |
| `api/events.ts` | `getEventDetail(eventId)` | `GET /lynx/events/:eventId` |
| `api/tool-calls.ts` | `listToolCalls(query?)` | `GET /lynx/tool-calls` |
| `api/tool-calls.ts` | `getToolCallDetail(toolCallId)` | `GET /lynx/tool-calls/:toolCallId` |
| `api/approvals.ts` | `listApprovals(query?)` | `GET /lynx/approvals` |
| `api/approvals.ts` | `getApprovalDetail(approvalId)` | `GET /lynx/approvals/:approvalId` |
| `api/lynx-checks.ts` | `listLynxChecks(query?)` | `GET /lynx/lynx-checks` |
| `api/lynx-checks.ts` | `getLynxCheckDetail(requestId)` | `GET /lynx/lynx-checks/:requestId` |
| `api/sessions.ts` | `listSessions(query?)` | `GET /lynx/sessions` |
| `api/sessions.ts` | `getSessionDetail(sessionKey)` | `GET /lynx/sessions/:sessionKey` |
| `api/tokens.ts` | `getTokenSummary()` | `GET /lynx/tokens/summary` |
| `api/tokens.ts` | `getTokenUsage(limit?)` | `GET /lynx/tokens/usage?limit=...` |
| `api/tokens.ts` | `getTokenTrend(bucket?)` | `GET /lynx/tokens/trend?bucket=...` |

## 7. 后端接口与落点

### 7.1 Query API

这些接口由 `backend/src/app.ts` 注册，统一前缀是 `/lynx`。

| 接口 | route 文件 | repository | 当前前端使用 |
| --- | --- | --- | --- |
| `GET /lynx/health` | `routes/health.ts` | 无 | 未使用 |
| `GET /lynx/meta/capabilities` | `routes/meta.ts` | 无 | 未使用 |
| `GET /lynx/dashboard/overview` | `routes/dashboard.ts` | `DashboardRepository` | DashboardPage |
| `GET /lynx/events` | `routes/events.ts` | `EventsRepository` | EventsPage |
| `GET /lynx/events/:eventId` | `routes/events.ts` | `EventsRepository` | 已封装，页面未用 |
| `GET /lynx/tool-calls` | `routes/tool-calls.ts` | `ToolCallsRepository` | ToolCallsPage |
| `GET /lynx/tool-calls/:toolCallId` | `routes/tool-calls.ts` | `ToolCallsRepository` | 已封装，页面未用 |
| `GET /lynx/approvals` | `routes/approvals.ts` | `ApprovalsRepository` | ApprovalsPage |
| `GET /lynx/approvals/:approvalId` | `routes/approvals.ts` | `ApprovalsRepository` | 已封装，页面未用 |
| `GET /lynx/lynx-checks` | `routes/lynx-checks.ts` | `LynxChecksRepository` | LynxChecksPage |
| `GET /lynx/lynx-checks/:requestId` | `routes/lynx-checks.ts` | `LynxChecksRepository` | 已封装，页面未用 |
| `GET /lynx/sessions` | `routes/sessions.ts` | `SessionsRepository` | SessionsPage |
| `GET /lynx/sessions/:sessionKey` | `routes/sessions.ts` | `SessionsRepository` | SessionsPage |
| `GET /lynx/tokens/usage` | `routes/tokens.ts` | `TokensRepository` | TokensPage |
| `GET /lynx/tokens/summary` | `routes/tokens.ts` | `TokensRepository` | TokensPage |
| `GET /lynx/tokens/trend` | `routes/tokens.ts` | `TokensRepository` | TokensPage |

### 7.2 Ingest API

接口：

- `POST /lynx/internal/v1/ingest/batch`

后端落点：

- `backend/src/routes/ingest.ts`
- `backend/src/services/ingest-service.ts`
- `backend/src/repositories/ingest-repository.ts`

认证：

- 需要 `Authorization: Bearer <console token>`。
- token 来源：`LYNX_LOCAL_CONSOLE_TOKEN` 或 `console.token` 文件。

前端是否调用：

- 不调用。
- 这是插件 runtime 写入本地 SQLite 的接口。

### 7.3 静态 Webview API

接口：

- `GET /webview`
- `GET /webview/*`

后端落点：

- `backend/src/services/static-service.ts`

作用：

- 返回 `frontend/dist/index.html` 和静态资源。
- 没有文件扩展名的路径统一回退到 `index.html`，支持 SPA 刷新。

## 8. 查询参数对照

### 8.1 通用列表参数

大多数列表接口支持：

- `fromMs`
- `toMs`
- `sessionKey`
- `runId`
- `riskLevel`
- `enforcementAction`
- `limit`
- `cursor`

当前前端基本只传 `limit: 20`，没有把筛选控件接到请求参数。

### 8.2 Events

接口：`GET /lynx/events`

额外参数：

- `hookName`
- `eventType`
- `category`
- `subCategory`
- `direction`
- `primaryModule`
- `requestId`
- `toolCallId`
- `approvalId`

### 8.3 Tool Calls

接口：`GET /lynx/tool-calls`

额外参数：

- `toolName`
- `resultStatus`
- `approvalId`

### 8.4 Approvals

接口：`GET /lynx/approvals`

额外参数：

- `resolution`
- `toolName`
- `module`
- `scopeType`
- `requesterOuId`
- `riskLevel`

### 8.5 Lynx Checks

接口：`GET /lynx/lynx-checks`

额外参数：

- `source`
- `trigger`
- `status`
- `messageProvider`

### 8.6 Sessions

接口：`GET /lynx/sessions`

额外参数：

- `channelProfile`
- `channelId`
- `requesterId`
- `requesterOuId`
- `isGroup`

### 8.7 Tokens

接口：

- `GET /lynx/tokens/usage`
- `GET /lynx/tokens/summary`
- `GET /lynx/tokens/trend`

额外参数：

- `provider`
- `model`
- `agentId`，仅 usage
- `isEstimated`，仅 usage
- `bucket`，仅 trend，当前支持 `hour` / `day`

## 9. DTO 与数据库表关系

共享 DTO 定义：

- `shared/src/query-dto.ts`
- `shared/src/ingest.ts`
- `shared/src/enums.ts`

SQLite schema：

- `backend/src/db/migrations/001_init.sql`

页面与表关系：

| 页面 | 主要表 |
| --- | --- |
| DashboardPage | `audit_events`、`tool_calls`、`approvals`、`lynx_checks`、`token_usage` |
| EventsPage | `audit_events` |
| ToolCallsPage | `tool_calls` |
| ApprovalsPage | `approvals` |
| LynxChecksPage | `lynx_checks` |
| SessionsPage | `sessions`，并聚合最近 `audit_events`、`tool_calls`、`approvals`、`token_usage` |
| TokensPage | `token_usage` |

注意：

- 数据库里部分枚举是 snake_case，例如 `require_approval`、`log_only`、`single_tool`。
- 前端 DTO 使用 camelCase，例如 `requireApproval`、`logOnly`、`singleTool`。
- 转换逻辑在 backend repository / mapper 层，不应在前端重复做。

## 10. 当前最值得优先排查的问题

### 10.1 Sessions 页面没有导航入口

现象：

- `router.tsx` 注册了 `/sessions`。
- `SessionsPage.tsx` 存在且会请求后端。
- `nav-config.ts` 没有 `sessions` 项。

影响：

- 用户从侧边栏无法进入会话页。
- `TopBar` 在 `/sessions` 下也无法解析 pageTitle。

定位文件：

- `frontend/src/app/router.tsx`
- `frontend/src/app/nav-config.ts`
- `frontend/src/pages/SessionsPage.tsx`

### 10.2 Webview basename 下普通 `<a href>` 可能跳错路径

现象：

- `App.tsx` 使用 `BrowserRouter basename={import.meta.env.BASE_URL}`。
- Vite base 是 `/webview/`。
- 页面中有普通绝对链接，例如 `/events`、`/tool-calls#...`、`/approvals#...`。

影响：

- 在 `/webview/` 下点击这些链接，可能跳出 SPA basename。

定位文件：

- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/ToolCallsPage.tsx`
- `frontend/src/pages/ApprovalsPage.tsx`
- `frontend/src/pages/TokensPage.tsx`

建议方向：

- 改用 `Link` / `NavLink`。
- 或统一封装 basename-aware link。

### 10.3 筛选、导出、批量处理大多只是视觉按钮

现象：

- Events、ToolCalls、Approvals、LynxChecks、Tokens 页面都有按钮或筛选 chip。
- 当前没有 onClick、表单状态、请求参数重发或 mutation API。

影响：

- 用户会以为功能失效。

定位文件：

- 各页面 `PageHeader.actions`
- `frontend/src/components/filters/FilterBar.tsx`
- `frontend/src/data/filter-presets.ts`

建议方向：

- v1 若不做，就禁用或移除这些按钮。
- 若要做，只读筛选先接 query 参数；导出/批量处理不要在没有 backend 写接口前做成真按钮。

### 10.4 Detail API 已封装但多数页面没用

已封装：

- `getEventDetail`
- `getToolCallDetail`
- `getApprovalDetail`
- `getLynxCheckDetail`
- `getSessionDetail`

当前真正使用：

- 只有 `SessionsPage` 使用 `getSessionDetail`。

影响：

- 列表页的“查看详情/查看 JSON”没有真正加载详情数据。

建议方向：

- 抽一个可复用 detail drawer。
- DataTable 增加 row click 或 action render 回调。

### 10.5 Token 能力没有用 capabilities 控制

backend 提供：

- `GET /lynx/meta/capabilities`
- 返回 `tokenUsageEnabled`

当前前端：

- `TokensPage` 直接请求 token endpoints。
- 没有先查 capability。

影响：

- 如果 token 采集被关闭，页面可能仍显示空数据或静态视觉卡，容易误判为后端异常。

定位文件：

- `backend/src/routes/meta.ts`
- `frontend/src/pages/TokensPage.tsx`

### 10.6 Dashboard 没显示完整概览 DTO

backend 返回的 `DashboardOverviewDto` 包含：

- totals
- riskDistribution
- enforcementDistribution
- eventTrend
- tokenTrend
- recentHighRiskEvents
- recentToolCalls
- recentApprovals

当前 Dashboard 主要显示：

- riskDistribution
- eventTrend
- recentHighRiskEvents

影响：

- 工具调用、审批、Token、动作分布在首页缺失，容易以为 backend 没返回。

定位文件：

- `frontend/src/pages/DashboardPage.tsx`
- `backend/src/routes/dashboard.ts`
- `backend/src/repositories/dashboard-repository.ts`

## 11. 调试入口

### 11.1 开发启动

从 repo root：

```powershell
npm run dev:local-console
```

该脚本会同时启动：

- `backend` dev server
- `frontend` Vite dev server

也可以单独启动：

```powershell
npm --prefix backend run dev
npm --prefix frontend run dev
```

Vite 默认：

- `http://127.0.0.1:4173`
- `/lynx` 代理到 `http://127.0.0.1:31789`

### 11.2 API 探活

backend 直连：

```powershell
Invoke-RestMethod http://127.0.0.1:31789/lynx/health
Invoke-RestMethod http://127.0.0.1:31789/lynx/meta/capabilities
```

经 OpenClaw gateway：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz
```

### 11.3 页面数据为空时

建议按顺序查：

1. `frontend/src/api/*` 是否请求了正确路径。
2. `backend/src/routes/*` 是否注册了对应 GET route。
3. 对应 repository 是否查的是预期表。
4. SQLite：`%USERPROFILE%\.openclaw\lynx\data\lynx.db` 是否有数据。
5. 插件写入侧是否成功 POST 到 `/lynx/internal/v1/ingest/batch`。
6. 如果是 `/lynx-check`，再查 `%USERPROFILE%\.openclaw\lynx\check-runs`。

## 12. 建议后续修复顺序

1. 把 `sessions` 加回 `PRIMARY_NAV_ITEMS`，让已存在页面可达。
2. 把页面内普通绝对 `<a href>` 改为 React Router `Link`。
3. 给 `DataTable` 增加空状态和行点击能力。
4. 先接列表页筛选到 GET query 参数，不做写接口。
5. 接入 detail drawer，复用已有 detail API。
6. `TokensPage` 先调用 `/lynx/meta/capabilities`，再决定是否展示 token 页面主体。
7. Dashboard 恢复或补全 `enforcementDistribution`、`recentToolCalls`、`recentApprovals`、`tokenTrend` 的展示。
8. 对没有后端支撑的导出、批量处理、实时日志按钮做禁用或移除。

