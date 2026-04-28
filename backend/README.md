# backend

这是 Lynx Guardian 的正式 Go 后端，使用 Go + Gin 实现，已经替代原先的 `backend/src/` Fastify 后端。

## 为什么是 Go

- `modernc.org/sqlite` 是纯 Go SQLite 驱动，不需要 CGO，也不需要额外的 native `.node` 文件。
- `gin-gonic/gin` 负责 HTTP 路由、中间件和 JSON 响应；内部 `repo`、`service`、`db` 层尽量不依赖具体 Web 框架。
- `go build` 产物是单文件二进制，目标机器不需要 Node.js 或 Go 运行时。
- 发布时配合 `-ldflags "-s -w"` 和 `garble`，源码保护效果比直接发布 JavaScript 更好。

## 目录

```text
backend/
|-- cmd/lynx-server/main.go        # 进程入口
|-- internal/
|   |-- app/app.go                 # Gin 装配入口
|   |-- api/dto.go                 # HTTP DTO 类型
|   |-- config/config.go           # 环境变量配置
|   |-- db/                        # SQLite 打开、pragma、迁移
|   |-- httpserver/                # 响应和 query 参数工具
|   |-- ingest/                    # 批量 ingest 服务
|   |-- middleware/                # loopback 和 ingest token 中间件
|   |-- openapi/                   # OpenAPI 源文件、embed 文件、oapi-codegen 生成代码
|   |-- repo/                      # SQLite 查询和写入
|   |-- routes/                    # Gin 路由
|   `-- service/                   # cursor、静态资源等服务
|-- oapi-codegen.yaml              # oapi-codegen 配置
|-- go.mod
`-- go.sum
```

## OpenAPI

接口契约源头是：

```text
backend/internal/openapi/openapi.yaml
```

生成 Gin 接口和类型：

```powershell
go tool oapi-codegen -config oapi-codegen.yaml internal/openapi/openapi.yaml
```

运行后会更新：

```text
backend/internal/openapi/openapi.gen.go
```

服务启动后可以打开：

```text
http://127.0.0.1:31789/openapi.yaml
http://127.0.0.1:31789/docs
```

当前阶段生成代码用于固定接口契约、参数类型和后续实现边界；现有业务 handler 仍由 `internal/routes/` 中的 Gin 路由承载，避免一次性大迁移带来回归风险。

## 开发

```powershell
# 下载远程依赖到本地 module cache
go mod download

# 可选：同步本地 vendor。vendor 已被 .gitignore 忽略，不提交。
go mod vendor

# 本地运行
go run -mod=vendor ./cmd/lynx-server
```

如果没有保留 `vendor/`，也可以直接：

```powershell
go run ./cmd/lynx-server
```

## 测试

```powershell
go test -mod=vendor ./...
```

如果本地 `vendor/` 临时不同步，可以先运行：

```powershell
go mod vendor
```

## 打包

```powershell
# Windows x64
$env:GOOS="windows"; $env:GOARCH="amd64"; $env:CGO_ENABLED="0"
go build -mod=vendor -trimpath -ldflags "-s -w" -o dist/lynx-server-win32-x64.exe ./cmd/lynx-server

# macOS arm64
$env:GOOS="darwin"; $env:GOARCH="arm64"; $env:CGO_ENABLED="0"
go build -mod=vendor -trimpath -ldflags "-s -w" -o dist/lynx-server-darwin-arm64 ./cmd/lynx-server

# Linux x64
$env:GOOS="linux"; $env:GOARCH="amd64"; $env:CGO_ENABLED="0"
go build -mod=vendor -trimpath -ldflags "-s -w" -o dist/lynx-server-linux-x64 ./cmd/lynx-server
```

进一步混淆：

```powershell
go install mvdan.cc/garble@latest
garble -literals -tiny build -o dist/lynx-server.exe ./cmd/lynx-server
```

## 当前迁移状态

| 模块 | 状态 |
| --- | --- |
| config / app 装配 | done |
| SQLite 打开、pragma、迁移 | done |
| Gin 路由装配 | done |
| loopback / ingest-auth Gin 中间件 | done |
| cursor / query 工具 | done |
| approvals repo + route | done |
| health / meta | done |
| events / tool-calls / sessions / lynx-checks / tokens / dashboard | done |
| ingest 批量校验 + 入库 | done |
| static webview | done |
| OpenAPI 规格、生成接口和文档页 | done |
