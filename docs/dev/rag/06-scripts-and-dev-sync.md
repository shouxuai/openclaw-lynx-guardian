# 构建脚本与 Docker 开发同步链

## 1. 这一层解决什么问题

这个仓库不是单纯的 TypeScript 插件仓库，它还承担“把当前开发目录同步到真实 OpenClaw Docker 网关里运行验证”的职责。

因此脚本层分成两类：

1. 构建发布
   `scripts/build.js`
2. 本地开发同步与 ready 校验
   `scripts-dev/*`

## 2. 构建脚本：`scripts/build.js`

### 关键步骤

1. 清理 `dist/`
2. 执行 `npx tsup`
3. 复制 `package.json`、`openclaw.plugin.json`、`default-policies.json`、`README.md`
4. 复制 `hooks/` 和 `skills/`
5. 改写 `dist/package.json` 中的入口，从 `.ts` 指向 `.js`
6. 删除 `devDependencies` 和 `scripts`

### 实现思路

这份脚本本质上是在做“插件分发包组装”，确保发布产物不只包含编译后的 JS，还包含 OpenClaw 运行必需的配置、Hook 资产和 Skill 资产。

## 3. 开发同步基础库：`scripts-dev/dev-sync-lib.mjs`

### 关键函数

| 函数 | 作用 |
| --- | --- |
| `shouldStagePath()` | 判断某个路径是否应该被 staged 到容器 |
| `findStalePluginManagedDirectories()` | 找出目标目录里已不存在于源目录的旧资源目录 |
| `resolveOpenClawHome()` | 解析宿主机 `.openclaw` 根目录 |
| `pickGatewayContainer()` | 选择网关容器名 |
| `buildDevSyncPlan()` | 组装 repoRoot / host / container 路径计划 |
| `assessGatewayLogs()` | 通过日志判断插件是否真正从容器内安全路径加载 |

### 实现思路

这是 dev sync 流的路径与容器决策层，尽量把“算路径”“挑容器”“看日志”这些纯逻辑从主脚本里抽出来。

## 4. Ready 校验辅助库：`scripts-dev/ready-sync-lib.mjs`

### 关键函数

| 函数 | 作用 |
| --- | --- |
| `extractContainerHealthStatus()` | 解析 Docker health 状态 |
| `hasGatewayReadyMarkers()` | 判断日志是否出现启动完成标记 |
| `collectGatewayReadyMarkerLines()` | 收集 ready 关键日志行 |
| `buildReadySyncSuccessMessage()` | 构造 SUCCESS 回调文案 |
| `resolveCronStoreSyncPaths()` | 计算 legacy cron store 和 docker-state cron store 路径 |
| `buildCronStoreContainsJobShellCommand()` | 生成检查 cron store 中是否存在目标 job 的 shell 命令 |
| `buildCronStoreSyncShellCommand()` | 生成 cron store 复制 + 权限修复命令 |

### 实现思路

这层主要服务于“同步完成后不只是重启容器，还要确认 cron store 真正进了 Docker runtime store”。

## 5. 主开发同步脚本：`scripts-dev/sync-openclaw-dev.mjs`

### 关键函数

| 函数 | 作用 |
| --- | --- |
| `parseArgs()` | 解析命令行参数 |
| `runCommand()` | 子进程执行包装 |
| `listContainerNames()` | 读取 Docker 容器名 |
| `copyNamedDirectories()` | 同步宿主机 hooks/skills 目录 |
| `stagePlugin()` | 把仓库复制到临时目录，并过滤掉不该同步的内容 |
| `logPlan()` | 打印当前同步计划 |
| `main()` | 执行 host sync、container copy、restart、logs 检查 |

### 实际流程

1. 解析 repo root、container、openclaw home
2. 同步宿主机 `hooks/` 和 `skills/`
3. 在临时目录中 stage 插件
4. 用 `docker cp` 把插件放到容器内 `/app/extensions/openclaw-lynx-guardian`
5. 修复容器内文件归属
6. 重启 gateway
7. 拉取最近日志并评估是否 ready

## 6. Ready 版同步脚本

### 相关文件

| 文件 | 角色 |
| --- | --- |
| `scripts-dev/sync-openclaw-dev-ready.mjs` | Node 版 ready sync 主脚本 |
| `scripts-dev/sync-openclaw-dev-ready.ps1` | PowerShell 包装器 |
| `scripts-dev/sync-openclaw-dev-ready.md` | 使用说明 |

### 作用

相比基础版，它多做了几件关键事：

1. 等待容器健康状态恢复
2. 等待网关 ready markers 出现
3. 确认 cron store 中包含 `lynx-guardian-scheduled-lynx-check`
4. 把 legacy cron store 复制到 docker-state cron store
5. 二次重启 gateway，让 cron 真正加载 docker-state store
6. 输出显式 `SUCCESS`

这正是当前 Docker cron-store 分裂环境下必需的补丁流程。

## 7. 其他辅助脚本

### `scripts-dev/verify-dev-sync.mjs`

作用是校验 `dev-sync-lib.mjs` 和 `ready-sync-lib.mjs` 提供的行为是否符合预期，属于脚本层自己的轻量验证。

### `scripts-dev/*.ps1`

这些 PowerShell 文件的定位是：

- 让 Windows 开发环境下的执行入口更顺手
- 把 Node 脚本封装成符合当前仓库使用习惯的命令

## 8. 当前 dev sync 设计特点

### 优点

- 明确区分了“基础同步”和“ready 版同步”
- 把路径解析、cron store 同步、日志判断等逻辑独立成库
- 开发验证直接对真实 Docker 运行时负责，而不是只看本机结果

### 问题

- `sync-openclaw-dev.mjs` 和 `sync-openclaw-dev-ready.mjs` 仍有参数解析、子进程包装等重复逻辑
- 仓库里同时存在 `.mjs`、`.ps1`、`.md` 三套入口文档，信息容易漂移
- 一部分“环境特例修复”依然硬编码在脚本里，后续如果 OpenClaw cron 机制变化，需要手工更新
