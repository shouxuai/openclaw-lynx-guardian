# backend-go

Lynx Local Console 后端的 Go + Gin 骨架版本，目录结构 1:1 对齐现有 `backend/src/`。

## 为什么是 Go

- `modernc.org/sqlite` 是**纯 Go** 的 SQLite（无 CGO），和 Node 侧的 `better-sqlite3` 最大区别就是没有 native .node 文件，**跨平台交叉编译零成本**。
- `gin-gonic/gin` 负责 HTTP 路由、中间件和 JSON 响应，内部 repo/service/db 层不依赖具体 Web 框架。
- `go build` 产物是单文件静态二进制，目标机器无需任何运行时。
- 机器码发布 + `-ldflags "-s -w"` + `garble` 混淆可以把反编译门槛抬得远比 JS 高。

## 目录

```
backend-go/
├── cmd/lynx-console/main.go          // <- backend/src/main.ts
├── internal/
│   ├── app/app.go                    // <- backend/src/app.ts
│   ├── config/config.go              // <- backend/src/config/env.ts
│   ├── db/
│   │   ├── sqlite.go                 // <- backend/src/db/sqlite.ts + pragmas.ts
│   │   ├── migrate.go                // <- backend/src/db/migrate.ts
│   │   └── migrations/001_init.sql   // <- 同名 SQL 文件（需要从 backend/src/db/migrations 拷过来）
│   ├── middleware/
│   │   ├── loopback.go               // <- middleware/localhost-only.ts
│   │   └── ingestauth.go             // <- middleware/ingest-auth.ts
│   ├── httpserver/
│   │   ├── responder.go              // JSON / 错误响应
│   │   └── queryparams.go            // <- routes/query-helpers.ts
│   ├── service/
│   │   ├── cursor.go                 // <- services/cursor-service.ts
│   │   ├── ingest.go                 // <- services/ingest-service.ts (TODO)
│   │   └── static.go                 // <- services/static-service.ts
│   ├── repo/
│   │   ├── queryutils.go             // <- repositories/query-utils.ts
│   │   ├── approvals.go              // 完整示例，已按 TS 版 1:1 翻译
│   │   └── stubs.go                  // 其余 repo 的桩（TODO: 按 approvals.go 照搬）
│   ├── routes/
│   │   ├── health.go                 // <- routes/health.ts
│   │   ├── meta.go                   // <- routes/meta.ts
│   │   ├── approvals.go              // 完整示例
│   │   └── stubs.go                  // 其余路由的桩（返回 501，留 TODO）
│   └── api/dto.go                    // <- shared/src/query-dto.ts（仅接入面用到的类型）
└── go.mod
```

## 开发

```powershell
# 拷贝迁移 SQL（一次性）
Copy-Item ..\backend\src\db\migrations\001_init.sql `
          .\internal\db\migrations\001_init.sql

# 拉依赖
go mod tidy

# 把锁定后的依赖源码带进仓库
go mod vendor

# 本地跑
go run -mod=vendor ./cmd/lynx-console
```

## 打包（单文件、跨平台）

```powershell
# Windows x64
$env:GOOS="windows"; $env:GOARCH="amd64"
go build -mod=vendor -trimpath -ldflags "-s -w" -o dist/lynx-console.exe ./cmd/lynx-console

# macOS arm64
$env:GOOS="darwin"; $env:GOARCH="arm64"
go build -mod=vendor -trimpath -ldflags "-s -w" -o dist/lynx-console-darwin-arm64 ./cmd/lynx-console

# Linux x64 (glibc 无关，纯静态)
$env:GOOS="linux"; $env:GOARCH="amd64"; $env:CGO_ENABLED="0"
go build -mod=vendor -trimpath -ldflags "-s -w" -o dist/lynx-console-linux-amd64 ./cmd/lynx-console
```

想再加一层源码保护：

```powershell
go install mvdan.cc/garble@latest
garble -literals -tiny build -o dist/lynx-console.exe ./cmd/lynx-console
```

## 迁移进度

| 模块 | 状态 |
|---|---|
| config / app 装配 | done |
| SQLite 打开 + pragma + 迁移 | done |
| Gin 路由装配 | done |
| loopback / ingest-auth Gin 中间件 | done |
| cursor / query 工具 | done |
| approvals repo + route | done（示范） |
| health / meta | done |
| events / tool-calls / sessions / lynx-checks / tokens / dashboard | **TODO** 参考 `repo/approvals.go` + `routes/approvals.go` 照搬 |
| ingest 批量校验 + 入库 | **TODO** 复杂，建议单独一轮 |
| static webview | done（简版） |
