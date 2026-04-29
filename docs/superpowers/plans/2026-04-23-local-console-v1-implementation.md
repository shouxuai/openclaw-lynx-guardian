# Local Console V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `openclaw-lynx-guardian` 中落地一个可运行的本地日志控制台 v1，让插件现有 hook 事件通过本地 ingest 写入 SQLite，并由独立本地 backend + frontend 提供查询与展示。

**Architecture:** 保持 `index.ts` 只做 hook 编排，把 local-console 分成三层：共享契约层、插件端 runtime client/supervisor、本地 backend + frontend。写入侧严格遵循 `lynx-console.ingest.v1`，读侧严格遵循 query DTO spec；SQLite schema 以 `2026-04-22-local-console-logging-001_init.sql` 为唯一基线，`gateway_auth_logs` 继续留在 v1 范围外。

**Tech Stack:** TypeScript ESM, existing plugin runtime, Fastify, Zod, React + Vite, SQLite (`better-sqlite3`), focused Vitest, existing OpenClaw dev-sync scripts

---

## Repo Reality Lock

- `backend/` 和 `frontend/` 目前是空目录，本计划按 greenfield 子项目处理，不假设已有 scaffold 可复用。
- 根包当前只通过 `scripts/build.js` + `tsup.config.ts` 打包 `index.ts`；不要在 local-console 还没跑通前就把根构建链路改成复杂 monorepo 发布流。
- 插件运行时配置默认值来自 `openclaw.plugin.json`，并由 `src/runtime/plugin-runtime-config.ts` 读出；`localConsole` 配置必须走同一条路径。
- 当前 `index.ts` 已注册的 hook 是：`gateway_start`、`before_dispatch`、`message_received`、`before_agent_start`、`agent_end`、`before_message_write`、`tool_result_persist`、`message_sending`、`before_tool_call`、`after_tool_call`、`session_start`、`session_end`。
- spec 里包含 `llm_output -> tokenUsage`，但当前 repo 的 `HookApi` typing 和 `index.ts` 还没有接这条 hook；`token_usage` 必须按“能力门控的后续任务”处理，不能阻塞核心 console 首次落地。
- 这套插件实际运行在 Docker 里的 Linux gateway 容器，而开发机是 Windows。任何 host 侧构建出来的 `backend/node_modules` 都不能被当成容器 runtime 依赖，尤其是 `better-sqlite3` 这类 native 模块。

## Scope Lock

- 以以下四份 spec 为准：
  - `docs/superpowers/specs/2026-04-22-local-console-logging-design.md`
  - `docs/superpowers/specs/2026-04-22-local-console-logging-001_init.sql`
  - `docs/superpowers/specs/2026-04-22-local-console-ingest-contract-design.md`
  - `docs/superpowers/specs/2026-04-22-local-console-query-api-dto-design.md`
  - `docs/superpowers/specs/2026-04-23-local-console-frontend-screen-alignment-design.md`
- v1 必做：
  - `sessions / audit_events / tool_calls / approvals / lynx_checks / token_usage / ingest_cursors / schema_migrations`
  - `POST /api/internal/v1/ingest/batch`
  - query spec 里的全部 `GET` 接口
  - 插件端对现有 12 个 hook 的 ingest 接入
  - 本地 frontend 页面：`Dashboard / Events / Tool Calls / Approvals / Lynx Checks / Sessions / Tokens`
- v1 不做：
  - `gateway_auth_logs`
  - 复杂布尔查询 DSL
  - 前端自定义列配置持久化
  - 磁盘级强持久化消息队列
  - 对 `D:\all-works\openclaw` 做任何代码改动

## Delivery Strategy

1. 先冻结共享 DTO、配置面和运行目录约定。
2. 先把 backend + migration + ingest 跑起来，并用 fixture/seed 支撑后续查询 API 与前端。
3. 再补插件 supervisor/client 与 hook 映射，让真实 OpenClaw 事件流进库。
4. 再接 read API 与 frontend，而不是一开始就先做 UI 外观。
5. 最后处理 `llm_output` 能力门控、容器 runtime 依赖安装和整体验证。

## Frontend Lock

- `frontend/` 的视觉和页面骨架以 `docs/superpowers/specs/2026-04-23-local-console-frontend-screen-alignment-design.md` 为准。
- `Lynx Checks` 页面沿用 Stitch 里的 `Check Tasks` 视觉参考，但路由与文案保持本项目命名。
- `Sessions` 页面没有现成 Stitch 参考屏，按同一 enterprise console 视觉语言本地补设计，不额外发明新接口。
- 先抽共享 shell 和基础组件，再按页面映射逐页接 DTO；不要把参考图里的导出、批量处理、实时流日志当作 v1 必做功能。

## File Map

- Modify: `openclaw.plugin.json`
- Modify: `src/types.ts`
- Modify: `src/runtime/plugin-runtime-config.ts`
- Modify: `index.ts`
- Modify: `scripts/dev-sync-lib.mjs`
- Modify: `scripts/sync-openclaw-dev.mjs`
- Modify: `scripts/sync-openclaw-dev-ready.ps1`
- Modify: `.gitignore`
- Modify: `scripts/build.js` only in the last packaging task if runtime proof is already green
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/enums.ts`
- Create: `shared/src/ingest.ts`
- Create: `shared/src/query-dto.ts`
- Create: `shared/src/cursor.ts`
- Create: `shared/src/index.ts`
- Create: `src/runtime/local-console-config.ts`
- Create: `src/runtime/local-console-auth.ts`
- Create: `src/runtime/local-console-client.ts`
- Create: `src/runtime/local-console-launch.ts`
- Create: `src/runtime/local-console-supervisor.ts`
- Create: `src/runtime/local-console-event-builder.ts`
- Create: `src/runtime/local-console-hook-handlers.ts`
- Create: `src/runtime/local-console-token-hook.ts`
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/tsup.config.ts`
- Create: `backend/src/main.ts`
- Create: `backend/src/app.ts`
- Create: `backend/src/config/env.ts`
- Create: `backend/src/db/sqlite.ts`
- Create: `backend/src/db/pragmas.ts`
- Create: `backend/src/db/migrate.ts`
- Create: `backend/src/db/migrations/001_init.sql`
- Create: `backend/src/middleware/localhost-only.ts`
- Create: `backend/src/middleware/ingest-auth.ts`
- Create: `backend/src/routes/health.ts`
- Create: `backend/src/routes/meta.ts`
- Create: `backend/src/routes/ingest.ts`
- Create: `backend/src/routes/dashboard.ts`
- Create: `backend/src/routes/events.ts`
- Create: `backend/src/routes/tool-calls.ts`
- Create: `backend/src/routes/approvals.ts`
- Create: `backend/src/routes/lynx-checks.ts`
- Create: `backend/src/routes/sessions.ts`
- Create: `backend/src/routes/tokens.ts`
- Create: `backend/src/repositories/ingest-repository.ts`
- Create: `backend/src/repositories/dashboard-repository.ts`
- Create: `backend/src/repositories/events-repository.ts`
- Create: `backend/src/repositories/tool-calls-repository.ts`
- Create: `backend/src/repositories/approvals-repository.ts`
- Create: `backend/src/repositories/lynx-checks-repository.ts`
- Create: `backend/src/repositories/sessions-repository.ts`
- Create: `backend/src/repositories/tokens-repository.ts`
- Create: `backend/src/services/ingest-service.ts`
- Create: `backend/src/services/cursor-service.ts`
- Create: `backend/src/services/static-service.ts`
- Create: `backend/test/health.test.ts`
- Create: `backend/test/migrate.test.ts`
- Create: `backend/test/ingest.test.ts`
- Create: `backend/test/query-events.test.ts`
- Create: `backend/test/query-pages.test.ts`
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/app/App.tsx`
- Create: `frontend/src/app/router.tsx`
- Create: `frontend/src/styles/reset.css`
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/theme.css`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/dashboard.ts`
- Create: `frontend/src/api/events.ts`
- Create: `frontend/src/api/tool-calls.ts`
- Create: `frontend/src/api/approvals.ts`
- Create: `frontend/src/api/lynx-checks.ts`
- Create: `frontend/src/api/sessions.ts`
- Create: `frontend/src/api/tokens.ts`
- Create: `frontend/src/components/layout/ConsoleLayout.tsx`
- Create: `frontend/src/components/layout/SidebarNav.tsx`
- Create: `frontend/src/components/layout/PageHeader.tsx`
- Create: `frontend/src/components/cards/MetricCard.tsx`
- Create: `frontend/src/components/cards/TrendCard.tsx`
- Create: `frontend/src/components/cards/DistributionCard.tsx`
- Create: `frontend/src/components/tables/DataTable.tsx`
- Create: `frontend/src/components/filters/FilterBar.tsx`
- Create: `frontend/src/components/feedback/StatusBadge.tsx`
- Create: `frontend/src/components/detail/DetailPanel.tsx`
- Create: `frontend/src/pages/DashboardPage.tsx`
- Create: `frontend/src/pages/EventsPage.tsx`
- Create: `frontend/src/pages/ToolCallsPage.tsx`
- Create: `frontend/src/pages/ApprovalsPage.tsx`
- Create: `frontend/src/pages/LynxChecksPage.tsx`
- Create: `frontend/src/pages/SessionsPage.tsx`
- Create: `frontend/src/pages/TokensPage.tsx`
- Create: `frontend/src/pages/NotFoundPage.tsx`
- Create: `scripts/build-local-console.mjs`
- Create: `scripts/start-local-console-dev.mjs`
- Create: `scripts/verify-local-console.mjs`
- Create: `scripts/seed-local-console-fixture.mjs`
- Create: `scripts/install-local-console-runtime-deps.mjs`
- Create: `test/local-console-config.test.ts`
- Create: `test/local-console-client.test.ts`
- Create: `test/local-console-event-builder.test.ts`
- Create: `test/local-console-hook-handlers.test.ts`
- Create: `test/local-console-token-hook.test.ts`

### Task 1: Freeze Shared Contracts And Runtime Config Surface

**Files:**
- Modify: `openclaw.plugin.json`
- Modify: `src/types.ts`
- Modify: `src/runtime/plugin-runtime-config.ts`
- Modify: `package.json`
- Modify: `test/plugin-runtime-config.test.ts`
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/enums.ts`
- Create: `shared/src/ingest.ts`
- Create: `shared/src/query-dto.ts`
- Create: `shared/src/cursor.ts`
- Create: `shared/src/index.ts`

- [ ] **Step 1: Add a minimal but complete `localConsole` config block to the plugin manifest**

需要落在 `openclaw.plugin.json` 的字段至少包括：

```json
{
  "localConsole": {
    "enabled": true,
    "autoStart": true,
    "host": "127.0.0.1",
    "port": 18790,
    "dataDir": "%USERPROFILE%\\.openclaw\\lynx\\data",
    "requestTimeoutMs": 1500,
    "flushIntervalMs": 1000,
    "maxBatchItems": 50,
    "maxQueueItems": 500
  }
}
```

要求：默认值必须足够支撑“不开额外配置即可在本地起 backend + 写入 DB”的最小链路。

- [ ] **Step 2: Mirror the manifest schema into runtime types and config resolution**

把同一套字段补到 `src/types.ts` 的 `PluginConfig`，并让 `src/runtime/plugin-runtime-config.ts` 按现有默认值合并逻辑读出它们；不要引入第二套 local-console 配置源。

- [ ] **Step 3: Freeze all ingest/query DTOs in `shared/` directly from the four specs**

要求：

- `shared/src/ingest.ts` 精确编码 `IngestBatchRequestV1`、`IngestBatchResponseV1`、六类 write intent
- `shared/src/query-dto.ts` 精确编码全部 list/detail DTO、bucket DTO、dashboard DTO
- `shared/src/enums.ts` 统一收口 `riskLevel`、`enforcementAction`、`scopeType`、`IngestItemKind`
- `shared/src/cursor.ts` 只定义 cursor encode/decode 约定，不掺杂 SQL

- [ ] **Step 4: Add root helper scripts, but do not touch the release build yet**

在根 `package.json` 先增加：

```json
{
  "scripts": {
    "build:local-console": "node scripts/build-local-console.mjs",
    "dev:local-console": "node scripts/start-local-console-dev.mjs",
    "verify:local-console": "node scripts/verify-local-console.mjs"
  }
}
```

这一阶段不要改 `scripts/build.js`，避免在 runtime proof 前把发布打包链路搅乱。

- [ ] **Step 5: Lock the config behavior with focused tests**

Run:

```powershell
npx vitest run test/plugin-runtime-config.test.ts
npm --prefix shared run build
```

Expected:

- `localConsole` 默认值和 override 行为被测试锁住
- `shared` 可以单独编译，未出现 DTO 命名漂移

### Task 2: Stand Up The Backend Shell, Migration Baseline, And Fixture Flow

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/tsup.config.ts`
- Create: `backend/src/main.ts`
- Create: `backend/src/app.ts`
- Create: `backend/src/config/env.ts`
- Create: `backend/src/db/sqlite.ts`
- Create: `backend/src/db/pragmas.ts`
- Create: `backend/src/db/migrate.ts`
- Create: `backend/src/db/migrations/001_init.sql`
- Create: `backend/src/middleware/localhost-only.ts`
- Create: `backend/src/middleware/ingest-auth.ts`
- Create: `backend/src/routes/health.ts`
- Create: `backend/src/routes/meta.ts`
- Create: `backend/src/routes/ingest.ts`
- Create: `backend/src/services/ingest-service.ts`
- Create: `backend/src/repositories/ingest-repository.ts`
- Create: `backend/test/health.test.ts`
- Create: `backend/test/migrate.test.ts`
- Create: `backend/test/ingest.test.ts`
- Create: `scripts/seed-local-console-fixture.mjs`

- [ ] **Step 1: Scaffold the backend as a separate buildable subproject**

要求：

- `backend` 使用独立 `package.json`
- build 产物输出到 `backend/dist`
- `better-sqlite3` 保持 external runtime dependency，不要尝试把 native binding 硬打进 bundle

- [ ] **Step 2: Copy the SQL spec into runtime migration code without redesigning it**

把 `docs/superpowers/specs/2026-04-22-local-console-logging-001_init.sql` 原样落到 `backend/src/db/migrations/001_init.sql`，`migrate.ts` 只负责：

- 确保数据目录存在
- 执行 `001_init.sql`
- 写入 `schema_migrations`

不要在这个任务里二次发明 schema。

- [ ] **Step 3: Land the minimum backend routes first: `health`, `meta`, `ingest`**

要求：

- `GET /api/health` 返回 `ok/serverTimeMs/schemaVersion`
- `GET /api/meta/capabilities` 先返回静态能力位，后续再接 `tokenUsageEnabled`
- `POST /api/internal/v1/ingest/batch` 完成结构校验、事务写入、duplicate/rejected 统计

- [ ] **Step 4: Enforce the transport boundary from the start**

要求：

- `localhost-only` 中间件只允许 loopback 访问
- ingest 路由必须检查 `Authorization: Bearer <token>`
- token 来源先读 `console.token` 路径或 supervisor 传入的 env path，不要把 token 硬编码进 repo

- [ ] **Step 5: Create a fixture seed path so query/UI work is not blocked on hook wiring**

`scripts/seed-local-console-fixture.mjs` 需要发送一批覆盖以下六类 item 的样本：

- `sessionUpsert`
- `auditEvent`
- `toolCallUpsert`
- `approvalUpsert`
- `lynxCheckUpsert`
- `tokenUsage`

这样 Task 5 和 Task 6 可以先基于稳定样本推进，而不是等待真实 OpenClaw 行为全部接完。

- [ ] **Step 6: Verify the backend shell locally before touching plugin integration**

Run:

```powershell
npm --prefix backend install
npm --prefix backend run build
npm --prefix backend test
```

Then start the backend and run:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18790/api/health
node scripts/seed-local-console-fixture.mjs
```

Expected:

- `api/health` 返回 200
- `seed` 能成功写入至少一批样本数据

### Task 3: Make The Runtime Build And Dev Sync Container-Safe

**Files:**
- Modify: `scripts/dev-sync-lib.mjs`
- Modify: `scripts/sync-openclaw-dev.mjs`
- Modify: `scripts/sync-openclaw-dev-ready.ps1`
- Modify: `.gitignore`
- Create: `scripts/install-local-console-runtime-deps.mjs`

- [ ] **Step 1: Stop staging host-built nested `node_modules` into the Linux container**

更新 `scripts/dev-sync-lib.mjs` 的过滤规则，至少排除：

- 任意层级的 `node_modules`
- 任意层级的 `.vite`
- 任意层级的 test cache / coverage

目标：sync 只带 source、静态构建产物和 lockfile，不带 Windows native binaries。

- [ ] **Step 2: Add a dedicated container-side dependency install step for `backend`**

新增脚本或 sync 子步骤，在容器内执行类似命令：

```sh
cd /app/extensions/openclaw-lynx-guardian/backend && npm ci --omit=dev
```

目的：让 `better-sqlite3` 在 Linux 容器里拿到正确的 runtime binary。

- [ ] **Step 3: Wire the ready-sync flow so backend deps can be installed as part of the normal dev cycle**

优先方案：

- `sync-openclaw-dev.mjs` 完成 copy 之后触发容器内依赖安装
- `sync-openclaw-dev-ready.ps1` 继续负责 restart 和 health/log 验证

不要让执行者每次手工想“还要不要再进容器 npm install 一遍”。

- [ ] **Step 4: Ignore local subproject artifacts explicitly**

在 `.gitignore` 增加：

```gitignore
backend/node_modules/
backend/dist/
frontend/node_modules/
frontend/dist/
frontend/.vite/
shared/node_modules/
shared/dist/
```

- [ ] **Step 5: Verify the container dependency path before writing any plugin launch code**

Run:

```powershell
node scripts/verify-dev-sync.mjs
node scripts/sync-openclaw-dev.mjs --dry-run
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
```

Then verify inside the container that `better-sqlite3` is usable from the staged backend path.

Expected:

- sync 不再携带 host `backend/node_modules`
- 容器内 backend 依赖能成功安装
- gateway 重启后没有新的 local-console 依赖错误

### Task 4: Build The Plugin-Side Config, Auth, Client, And Supervisor

**Files:**
- Create: `src/runtime/local-console-config.ts`
- Create: `src/runtime/local-console-auth.ts`
- Create: `src/runtime/local-console-client.ts`
- Create: `src/runtime/local-console-launch.ts`
- Create: `src/runtime/local-console-supervisor.ts`
- Modify: `index.ts`
- Create: `test/local-console-config.test.ts`
- Create: `test/local-console-client.test.ts`

- [ ] **Step 1: Resolve all runtime file paths under `%USERPROFILE%\\.openclaw\\lynx\\data`**

必须统一管理的路径：

- `lynx.db`
- `console.pid`
- `console.log`
- `console.token`

不要在多个模块里重复拼接这些路径。

- [ ] **Step 2: Implement token-file based auth sharing between plugin and backend**

要求：

- token 在首次启动时生成并写入 `console.token`
- 后续 plugin client 和 backend 都从同一路径读它
- token 逻辑独立在 `local-console-auth.ts`，不要散落到 `index.ts`

- [ ] **Step 3: Implement an async ingest client with bounded queueing**

要求：

- 支持按 `maxBatchItems` 切 batch
- 支持 `flushIntervalMs`
- 支持 retry/backoff
- 支持 Bearer header
- 队列满时给出明确日志，不要静默丢数据

- [ ] **Step 4: Implement the backend launch/supervisor path**

要求：

- supervisor 只负责“探活 / 启动 / 记录 pid / 观察日志”
- backend 启动命令和环境变量组装放在 `local-console-launch.ts`
- `index.ts` 只在插件启动时创建 runtime，不内联 child-process 细节

- [ ] **Step 5: Verify the client path before wiring real hooks**

Run:

```powershell
npx vitest run test/local-console-config.test.ts test/local-console-client.test.ts
```

然后用一个 synthetic batch 直接走 client 写入本地 backend。

Expected:

- config 路径解析正确
- token 和 header 生效
- queue flush / retry 行为有测试约束

### Task 5: Map The Existing 12 Hooks To Write Intents

**Files:**
- Create: `src/runtime/local-console-event-builder.ts`
- Create: `src/runtime/local-console-hook-handlers.ts`
- Modify: `index.ts`
- Create: `test/local-console-event-builder.test.ts`
- Create: `test/local-console-hook-handlers.test.ts`

- [ ] **Step 1: Encode the hook-to-intent mapping exactly as the ingest spec says**

必须覆盖：

- `session_start` -> `sessionUpsert` (+ optional lifecycle `auditEvent`)
- `session_end` -> `sessionUpsert` + `auditEvent`
- `message_received` -> `auditEvent`
- `before_agent_start` -> `auditEvent` (+ `lynxCheckUpsert` when applicable)
- `agent_end` -> `auditEvent`
- `gateway_start` -> `auditEvent`
- `before_message_write` -> `auditEvent`
- `tool_result_persist` -> `auditEvent`
- `message_sending` -> `auditEvent` (+ `lynxCheckUpsert` when applicable)
- `before_tool_call` -> `auditEvent` + `toolCallUpsert` (+ `approvalUpsert` when applicable)
- `after_tool_call` -> `auditEvent` + `toolCallUpsert`

- [ ] **Step 2: Keep `before_dispatch` selective**

只记录：

- 本地审批回复命中
- 指令消费
- 特殊路由分支

不要把所有普通分发流量无差别写入 `audit_events`。

- [ ] **Step 3: Reuse existing policy/runtime helpers instead of recomputing risk data**

`local-console-event-builder.ts` 只能做归一化，不要复制以下现有逻辑：

- 风险评估
- 审批判定
- `/lynx-check` 递送判断
- requester / approval / workflow stores

这些数据应该消费现有 helper 的结果，再映射成 DTO。

- [ ] **Step 4: Keep `index.ts` thin while wiring the new handlers**

策略：

- `index.ts` 只负责把已存在的 `api.on(...)` 分支接到 local-console handler
- 所有 DTO 拼装、批量写入、错误日志都移到 `src/runtime/local-console-*.ts`

- [ ] **Step 5: Verify with focused tests and one real OpenClaw path**

Run:

```powershell
npx vitest run test/local-console-event-builder.test.ts test/local-console-hook-handlers.test.ts
node scripts/verify-dev-sync.mjs
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
```

然后触发一个会经过 `message_received -> before_tool_call -> after_tool_call` 的真实 OpenClaw 路径，再用 read API 确认已经能看到：

- `/api/events`
- `/api/tool-calls`
- `/api/approvals`
- `/api/lynx-checks`

### Task 6: Implement The Read API And Cursor Pagination

**Files:**
- Create: `backend/src/routes/dashboard.ts`
- Create: `backend/src/routes/events.ts`
- Create: `backend/src/routes/tool-calls.ts`
- Create: `backend/src/routes/approvals.ts`
- Create: `backend/src/routes/lynx-checks.ts`
- Create: `backend/src/routes/sessions.ts`
- Create: `backend/src/routes/tokens.ts`
- Create: `backend/src/repositories/dashboard-repository.ts`
- Create: `backend/src/repositories/events-repository.ts`
- Create: `backend/src/repositories/tool-calls-repository.ts`
- Create: `backend/src/repositories/approvals-repository.ts`
- Create: `backend/src/repositories/lynx-checks-repository.ts`
- Create: `backend/src/repositories/sessions-repository.ts`
- Create: `backend/src/repositories/tokens-repository.ts`
- Create: `backend/src/services/cursor-service.ts`
- Create: `backend/src/services/static-service.ts`
- Create: `backend/test/query-events.test.ts`
- Create: `backend/test/query-pages.test.ts`

- [ ] **Step 1: Implement cursor logic once and reuse it across list endpoints**

约束：

- 默认排序全部是“最新在前”
- cursor 只服务 list endpoints
- 不引入 offset-based fallback

- [ ] **Step 2: Land the endpoints in execution order, not all at once**

推荐顺序：

1. `GET /api/events`
2. `GET /api/events/:eventId`
3. `GET /api/tool-calls`
4. `GET /api/tool-calls/:toolCallId`
5. `GET /api/approvals`
6. `GET /api/approvals/:approvalId`
7. `GET /api/lynx-checks`
8. `GET /api/lynx-checks/:requestId`
9. `GET /api/sessions`
10. `GET /api/sessions/:sessionKey`
11. `GET /api/dashboard/overview`
12. `GET /api/tokens/usage`
13. `GET /api/tokens/summary`
14. `GET /api/tokens/trend`

- [ ] **Step 3: Keep snake_case to camelCase mapping out of route handlers**

要求：

- route 只做参数解析和 response 发送
- repository / mapper 层负责字段转换
- 不允许在多个 route 里复制字段 rename 逻辑

- [ ] **Step 4: Support only the filters declared in the query spec**

允许：

- 时间范围
- 风险等级
- 执行动作
- 会话 / run / request / tool / approval 关联 ID

不允许：

- 自定义布尔 DSL
- 任意列的临时 where 拼装

- [ ] **Step 5: Verify list/detail/filter behavior against fixture and real data**

Run:

```powershell
npm --prefix backend test
Invoke-RestMethod http://127.0.0.1:18790/api/events?limit=5
Invoke-RestMethod http://127.0.0.1:18790/api/dashboard/overview
```

Expected:

- cursor 可以翻页
- detail DTO 只在详情接口返回重字段
- fixture 和真实 hook 数据都能被查询到

### Task 7: Build The Frontend Console Against The Read API

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/app/App.tsx`
- Create: `frontend/src/app/router.tsx`
- Create: `frontend/src/styles/reset.css`
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/theme.css`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/dashboard.ts`
- Create: `frontend/src/api/events.ts`
- Create: `frontend/src/api/tool-calls.ts`
- Create: `frontend/src/api/approvals.ts`
- Create: `frontend/src/api/lynx-checks.ts`
- Create: `frontend/src/api/sessions.ts`
- Create: `frontend/src/api/tokens.ts`
- Create: `frontend/src/components/layout/ConsoleLayout.tsx`
- Create: `frontend/src/components/layout/SidebarNav.tsx`
- Create: `frontend/src/components/layout/PageHeader.tsx`
- Create: `frontend/src/components/cards/MetricCard.tsx`
- Create: `frontend/src/components/cards/TrendCard.tsx`
- Create: `frontend/src/components/cards/DistributionCard.tsx`
- Create: `frontend/src/components/tables/DataTable.tsx`
- Create: `frontend/src/components/filters/FilterBar.tsx`
- Create: `frontend/src/components/feedback/StatusBadge.tsx`
- Create: `frontend/src/components/detail/DetailPanel.tsx`
- Create: `frontend/src/pages/DashboardPage.tsx`
- Create: `frontend/src/pages/EventsPage.tsx`
- Create: `frontend/src/pages/ToolCallsPage.tsx`
- Create: `frontend/src/pages/ApprovalsPage.tsx`
- Create: `frontend/src/pages/LynxChecksPage.tsx`
- Create: `frontend/src/pages/SessionsPage.tsx`
- Create: `frontend/src/pages/TokensPage.tsx`
- Create: `frontend/src/pages/NotFoundPage.tsx`

- [ ] **Step 1: Build a minimal Vite/React shell served by backend static hosting**

要求：

- frontend 最终由 backend 同源托管
- 不直接读 SQLite
- 先跑通路由、基础布局和 API client，再补页面细节
- 共享壳子优先落 `ConsoleLayout / SidebarNav / PageHeader`
- 基础卡片和细节容器优先落 `MetricCard / TrendCard / DistributionCard / StatusBadge / DetailPanel`

- [ ] **Step 2: Avoid dependency hunting in v1**

具体约束：

- 图表优先用 CSS/SVG/轻量组件表达，不引入大型 chart 库
- 状态管理优先用 React 自身能力，不先上全局 store
- 页面按 DTO spec 的“列表 / 详情”拆分，不额外创造新接口

- [ ] **Step 3: Implement pages in business order**

顺序固定为：

1. `Dashboard`
2. `Events`
3. `Tool Calls`
4. `Approvals`
5. `Lynx Checks`
6. `Tokens`
7. `Sessions`

说明：

- `Lynx Checks` 使用 `Check Tasks` 的视觉骨架，但字段与筛选完全服从 query DTO
- `Sessions` 是唯一没有 Stitch 成品图的页面，最后实现，直接复用统一 shell、表格和详情面板语言

前六页先基于 fixture 和真实数据双验，`Tokens` 页在 `tokenUsageEnabled=false` 时允许展示空态或能力未开启提示。

- [ ] **Step 4: Delay heavy detail payloads until the user opens a detail view**

要求：

- 列表页只打 list endpoint
- detail drawer / detail panel 才打 detail endpoint
- 不在列表首屏预拉 `payloadJson` / `metadataJson`

- [ ] **Step 5: Verify the frontend with build + real backend smoke**

Run:

```powershell
npm --prefix frontend install
npm --prefix frontend run build
```

然后在本地 backend 上打开页面，确认：

- Dashboard 能渲染聚合卡片
- Events / Tool Calls / Approvals / Lynx Checks / Sessions 能正确筛选和查看详情
- Tokens 页在无数据时也不崩溃

### Task 8: Add `llm_output` Token Usage Ingestion Behind A Capability Gate

**Files:**
- Create: `src/runtime/local-console-token-hook.ts`
- Modify: `src/types.ts`
- Modify: `src/runtime/hook-capabilities.ts`
- Modify: `backend/src/routes/meta.ts`
- Modify: `backend/src/repositories/tokens-repository.ts`
- Create: `test/local-console-token-hook.test.ts`

- [ ] **Step 1: Add a narrow registration path for `llm_output` instead of widening all hook typings**

要求：

- 优先做单独 helper 或窄接口适配
- 不要为了一个新 hook 把整个 `HookApi` typing 改成松散 `string` 事件总线

- [ ] **Step 2: Emit `tokenUsage` as the primary record and `auditEvent` only for high-signal exceptions**

符合 spec 的行为：

- 正常 token 流量 -> `tokenUsage`
- 预算超阈值、明显异常 usage、compute-abuse 相关高信号 -> 额外 `auditEvent`

- [ ] **Step 3: Keep the system useful when the hook is unavailable**

当 runtime 不支持 `llm_output` 或当前 OpenClaw 版本没有暴露该 hook 时：

- `token_usage` 表仍然保留
- token 查询接口仍然可用
- `GET /api/meta/capabilities` 返回 `tokenUsageEnabled=false`

- [ ] **Step 4: Verify only against a runtime that actually exposes the hook**

Run focused tests first:

```powershell
npx vitest run test/local-console-token-hook.test.ts test/hook-capabilities.test.ts
```

若当前 runtime 没有 `llm_output`，把它记录为“能力门控未满足”，不要把整个 local-console v1 判定为失败。

### Task 9: Package, Sync, And Prove The End-To-End Runtime

**Files:**
- Create: `scripts/build-local-console.mjs`
- Create: `scripts/start-local-console-dev.mjs`
- Create: `scripts/verify-local-console.mjs`
- Modify: `scripts/build.js` only if local packaging into root `dist/` is still required after the runtime path is green

- [ ] **Step 1: Build the subprojects in the correct order**

顺序：

1. `shared`
2. `backend`
3. `frontend`

要求：

- backend bundle 进 `backend/dist`
- frontend 产物进 `frontend/dist`
- 不依赖 `backend/node_modules` 被同步过去；容器 runtime 依赖通过 Task 3 解决

- [ ] **Step 2: Add local-console verification scripts for daily use**

至少需要：

- `scripts/build-local-console.mjs`
- `scripts/start-local-console-dev.mjs`
- `scripts/verify-local-console.mjs`

目标：后续执行者不需要手工敲一串零散命令才能确认 local-console 是否可用。

- [ ] **Step 3: Run the non-runtime verification gate**

Run:

```powershell
npx vitest run test/plugin-runtime-config.test.ts test/local-console-config.test.ts test/local-console-client.test.ts test/local-console-event-builder.test.ts test/local-console-hook-handlers.test.ts
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend run build
npx tsc --noEmit
```

Expected:

- 共享契约、插件 runtime、backend、frontend 均通过本地静态验证

- [ ] **Step 4: Run the real OpenClaw runtime proof**

Run:

```powershell
node scripts/verify-dev-sync.mjs
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18790/api/health
```

然后走一个真实 OpenClaw 路径，触发至少一条新的 hook 数据，再验证：

```powershell
Invoke-RestMethod http://127.0.0.1:18790/api/events?limit=5
Invoke-RestMethod http://127.0.0.1:18790/api/tool-calls?limit=5
Invoke-RestMethod http://127.0.0.1:18790/api/sessions?limit=5
```

- [ ] **Step 5: Inspect the persisted runtime artifacts before claiming completion**

至少确认：

- `%USERPROFILE%\.openclaw\lynx\data\lynx.db` 已生成并持续更新
- `%USERPROFILE%\.openclaw\lynx\data\console.log` 有 backend 启动与 ingest 记录
- read API 能读到真实刚写入的新数据

不要只凭 build/test 绿灯就宣称“本地控制台已经可用”。

## Decision Gates

- `better-sqlite3` 容器内安装如果跑不通，这是一级阻塞项，必须先处理，再继续 plugin supervisor 或 frontend。
- `llm_output` 不可用不是一级阻塞项；它只阻塞 token 实时写入，不阻塞核心 console v1。
- `before_dispatch` 的采集范围必须保持收敛；如果开始无差别记录所有流量，需要立即回退设计。
- 任何 runtime 行为结论都要同时满足：sync 成功、gateway 健康、console backend 健康、read API 读到真实数据。

## Self-Review Checklist

- [ ] 四份 spec 的必做项都能在任务里找到对应落点，没有遗漏 `6 + 2` 表、ingest、全部 query API 和前端页面
- [ ] 计划已经显式处理 Windows 开发机 -> Linux 容器的 native dependency 风险，没有默认把 host `node_modules` 当作 runtime 方案
- [ ] `llm_output` 被能力门控隔离，没有把它错误地塞进核心路径
- [ ] `index.ts` 仍然是 orchestration-only，没有把 SQL、HTTP、DTO 拼装塞回入口文件
- [ ] 所有验证步骤都区分了“本地静态验证”和“真实 OpenClaw runtime proof”
