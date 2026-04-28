# backend

Lynx 正式后端的 Go + Gin 版本，已替代原 `backend/src/` Fastify 实现。

## 为什么是 Go

- `modernc.org/sqlite` 是**纯 Go** 的 SQLite（无 CGO），和 Node 侧的 `better-sqlite3` 最大区别就是没有 native .node 文件，**跨平台交叉编译零成本**。
- `gin-gonic/gin` 负责 HTTP 路由、中间件和 JSON 响应，内部 repo/service/db 层不依赖具体 Web 框架。
- `go build` 产物是单文件静态二进制，目标机器无需任何运行时。
- 机器码发布 + `-ldflags "-s -w"` + `garble` 混淆可以把反编译门槛抬得远比 JS 高。

## 目录

```
backend/
├── cmd/lynx-server/main.go          // <- backend/src/main.ts
├── internal/
│   ├── app/app.go                    // <- backend/src/app.ts
│   ├── config/config.go              // <- backend/src/config/env.ts
│   ├── db/
│   │   ├── sqlite.go                 // <- backend/src/db/sqlite.ts + pragmas.ts
│   │   ├── migrate.go                // <- backend/src/db/migrate.ts
│   │   └── migrations/001_init.sql   // <- Local Console SQLite schema
│   ├── middleware/
│   │   ├── loopback.go               // <- middleware/localhost-only.ts
│   │   └── ingestauth.go             // <- middleware/ingest-auth.ts
│   ├── httpserver/
│   │   ├── responder.go              // JSON / 错误响应
│   │   └── queryparams.go            // <- routes/query-helpers.ts
│   ├── ingest/
│   │   └── service.go                // <- backend/src/services/ingest-service.ts
│   ├── service/
│   │   ├── cursor.go                 // <- services/cursor-service.ts
│   │   └── static.go                 // <- services/static-service.ts
│   ├── repo/
│   │   ├── queryutils.go             // <- repositories/query-utils.ts
│   │   ├── approvals.go              // 完整示例，已按 TS 版 1:1 翻译
│   │   ├── events.go / toolcalls.go / sessions.go / lynxchecks.go
│   │   ├── tokens.go / dashboard.go / ingest.go
│   │   └── repositories.go           // repository 构造函数
│   ├── routes/
│   │   ├── health.go                 // <- routes/health.ts
│   │   ├── meta.go                   // <- routes/meta.ts
│   │   ├── approvals.go              // 完整示例
│   │   └── query.go                  // 其余查询路由 + ingest 路由
│   └── api/dto.go                    // <- shared/src/query-dto.ts（仅接入面用到的类型）
└── go.mod
```

## 开发

```powershell
# 拉依赖
go mod tidy

# 把远程依赖下载到本地 vendor（本仓库已忽略 vendor，不提交）
go mod vendor

# 本地跑
go run -mod=vendor ./cmd/lynx-server
```

## 打包（单文件、跨平台）

```powershell
# Windows x64
$env:GOOS="windows"; $env:GOARCH="amd64"; $env:CGO_ENABLED="0"
go build -mod=vendor -trimpath -ldflags "-s -w" -o dist/lynx-server-win32-x64.exe ./cmd/lynx-server

# macOS arm64
$env:GOOS="darwin"; $env:GOARCH="arm64"; $env:CGO_ENABLED="0"
go build -mod=vendor -trimpath -ldflags "-s -w" -o dist/lynx-server-darwin-arm64 ./cmd/lynx-server

# Linux x64 (glibc 无关，纯静态)
$env:GOOS="linux"; $env:GOARCH="amd64"; $env:CGO_ENABLED="0"
go build -mod=vendor -trimpath -ldflags "-s -w" -o dist/lynx-server-linux-x64 ./cmd/lynx-server
```

想再加一层源码保护：

```powershell
go install mvdan.cc/garble@latest
garble -literals -tiny build -o dist/lynx-server.exe ./cmd/lynx-server
```

## 迁移进度

| 模块 | 状态 |
|---|---|
| config / app 装配 | done |
| SQLite 打开 + pragma + 迁移 | done |
| Gin 路由装配 | done |
| loopback / ingest-auth Gin 中间件 | done |
| cursor / query 工具 | done |
| approvals repo + route | done |
| health / meta | done |
| events / tool-calls / sessions / lynx-checks / tokens / dashboard | done |
| ingest 批量校验 + 入库 | done |
| static webview | done（简版） |
