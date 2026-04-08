# SX-openclaw-discovery

## 这份 README 对应哪一版

本文以当前仓库代码实现为准，描述的是已经并入 Lynx Guardian 主流程的 OpenClaw 服务发现能力，而不是早期那种单独维护 `lynx-discovery.config.json` 的旧模式。

当前版本可以简单理解为：

- discovery 配置统一从 `openclaw.plugin.json` 的 `openclawDiscovery` 读取
- `/lynx-check` 返回的是一份综合检测报告，服务发现结果只是其中最后一段
- 发现结果优先在 `before_message_write` 阶段自动附加到最终回复里，`agent_end` 作为兜底补发

## 作用

这个能力用于识别当前机器或局域网内可能暴露的 OpenClaw 服务实例，并输出：

- IP
- 端口
- 协议（HTTP / HTTPS）
- 指纹得分
- 置信度分级

在当前实现里，它既可以被手动触发，也会在 `/lynx-check` 主流程里统一调度，最终成为综合检测报告中的“服务发现 IP / 端口”部分。

## 触发方式

在 OpenClaw 对话里输入以下命令，都可以触发检测：

| 命令 | 说明 |
| --- | --- |
| `check` / `/check` | 通用检测入口 |
| `lynx-check` / `/lynx-check` | Lynx Guardian 主检测入口 |
| `openclaw-check` / `/openclaw-check` | 面向 OpenClaw 服务发现的别名 |

也支持自然语言触发。当前规则不是单纯看某一个词，而是同时命中三类关键词：

- 动作词：`检查`、`检测`、`扫描`、`探测`、`排查`、`check`
- 目标词：`openclaw`、`lynx`、`龙虾`
- 信号词：`服务`、`进程`、`网关`、`IP`、`端口`、`地址`

例如：

- `帮我检查 openclaw 服务`
- `扫描 lynx 的 IP 和端口`
- `check openclaw gateway`

补充一点：定时任务 `scheduledLynxCheck` 本质上也是发起 `/lynx-check`，所以会走同一套 discovery 逻辑。

## 配置来源

discovery 现在不再依赖独立配置文件，配置来源统一如下：

- 配置源标识：`openclaw.plugin.json`
- 运行时读取位置：插件配置对象中的 `openclawDiscovery`
- 默认值补齐位置：`src/discovery/discovery-runtime-config.ts`
- 端口、并发、阈值等运行时兜底：`src/discovery/openclaw-discovery.ts`

也就是说，这份 README 里提到的配置项，应当按 `openclaw.plugin.json` 中 `openclawDiscovery` 的 schema 和运行时代码一起理解。

## 推荐配置示例

```json
{
  "openclawDiscovery": {
    "targets": ["127.0.0.1:18789"],
    "candidatePorts": [18789, 8080, 8443],
    "fullScan": false,
    "localOnly": false,
    "timeoutMs": 2000,
    "hostConcurrency": 20,
    "portConcurrency": 128,
    "minScore": 1,
    "maxHosts": 256
  }
}
```

如果你没有显式传这些值，运行时会按默认值自动补齐。

## 配置项说明

| 配置项 | 运行时默认值 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| `enabled` | `true` | 保留字段 | schema 中存在，但当前 `/lynx-check` 和手动 discovery 路径会强制执行 discovery，不把它作为最终开关 |
| `runOnStartup` | `false` | 保留字段 | 当前主要用于兼容和预留，主流程没有单独启用“启动即自动扫描” |
| `targets` | 空 | 生效 | 显式指定扫描目标，支持 `host`、`host:port`、`http://...`、`https://...`、`CIDR` |
| `candidatePorts` | 内置端口列表 | 生效 | 非全端口扫描时的候选端口集合 |
| `fullScan` | `false` | 生效 | `true` 时扫描 `1-65535`，`false` 时只扫描候选端口 |
| `localOnly` | `false` | 生效 | `true` 时只扩展本机目标；`false` 时还会扩展本机局域网网段 |
| `timeoutMs` | `2000` | 生效 | 单次请求 / 端口探测超时，范围 `250-15000` ms |
| `hostConcurrency` | `20` | 生效 | 并发主机扫描上限，范围 `1-128` |
| `portConcurrency` | `128` | 生效 | 并发端口扫描上限，范围 `1-1024` |
| `minScore` | `1` | 生效 | 命中结果最低指纹分数，范围 `0-100` |
| `maxHosts` | `256` | 生效 | CIDR 展开后的最大主机数，范围 `1-4096` |

## 候选端口默认值

当 `candidatePorts` 未配置时，当前代码会使用以下默认端口：

```text
18789, 8080, 8443, 3000, 9000, 9090, 9443, 4000, 5000, 7000, 80, 443, 8000, 8888, 8889, 18790
```

其中 `18789` 是默认优先级最高的 OpenClaw 网关端口。

## 目标解析规则

当 `targets` 没有配置时，插件会自动推导目标：

1. 总是优先加入 `127.0.0.1:<gatewayPort>` 和 `localhost:<gatewayPort>`
2. 如果 `localOnly=false`，会尝试加入当前探测到的本机 IPv4 地址
3. 如果 `localOnly=false`，还会把当前私有网卡对应的局域网网段展开为 CIDR 目标

其中 `gatewayPort` 来自 `~/.openclaw/openclaw.json` 的 `gateway.port`，默认回退到 `18789`。

`targets` 当前支持这些格式：

- `127.0.0.1`
- `127.0.0.1:18789`
- `localhost:18789`
- `http://127.0.0.1:18789`
- `https://demo.example.com`
- `192.168.1.0/24`

注意：

- 如果写了显式端口，运行时会直接对该端口做指纹识别
- 如果没写端口，运行时会先做 TCP 端口探测，再对开放端口做 HTTP / HTTPS 指纹识别
- 如果是 CIDR，展开后的主机数超过 `maxHosts` 会直接跳过并给出 warning

## 指纹识别逻辑

当前 discovery 不是“只看端口开没开”，而是做了一层 OpenClaw 指纹识别，主要包括：

- 根路径 `/` 的 HTTP / HTTPS 响应体关键词
- 响应头关键词，如 `server`、`x-powered-by`、`x-gateway`
- 健康检查路径：
  - `/health`
  - `/status`
  - `/api/health`
  - `/api/status`
  - `/api/v1/health`
- WebSocket 升级能力

当前内置关键词大致覆盖：

- `openclaw`
- `control ui`
- `gateway`
- `openclaw.ai`
- `openclaw-gateway`
- `channel`
- `agent`
- `websocket`

最后会根据得分给出置信度分级：

- `>= 80`：确认
- `>= 50`：高度疑似
- `>= 25`：疑似
- `>= 10`：可能
- `< 10`：未知 HTTP 服务

## 当前输出结构

现在 `/lynx-check` 返回的不是单独一段 discovery 文本，而是一份四段式综合检测报告：

1. 公网暴露检测
2. 恶意脚本扫描
3. Skill 完整性校验
4. 服务发现 IP / 端口

其中“服务发现 IP / 端口”固定放在最后，更适合 WebChat 阅读，也方便把前面几项安全结论和后面的网络发现结果放在一起看。

## 服务发现部分会显示什么

服务发现摘要里通常会包含：

- 扫描目标数
- 展开主机数
- 命中结果数
- 检测耗时
- 已确认的 OpenClaw 服务数量
- 高度疑似的 OpenClaw 服务数量
- 低置信度候选数量

如果命中了服务，还会列出类似这样的结果：

```text
- IP=127.0.0.1 端口=18789 协议=http 评分=90 状态=确认
```

在综合报告里，这部分除了摘要卡片，还会把原始 discovery summary 作为代码块完整附在后面，便于人工复核。

## 输出链路

当前实现里的输出链路是这样的：

1. 在 `before_agent_start` 阶段构建 `/lynx-check` 综合报告
2. 先把结果写入本地暂存文件 `.openclaw/.lynx-pending-discovery.txt`
3. 在 `before_message_write` 阶段把报告自动附加到最终 assistant 消息里
4. 如果附加失败或当前通道不适合直接改写消息，则在 `agent_end` 阶段兜底发送

配套还会写入：

- `.openclaw/.lynx-pending-discovery.request.json`：记录当前 session 对应的 discovery 请求
- `.openclaw/.lynx-pending-discovery.consumed`：标记报告已消费，避免重复附加

所以和旧版相比，现在的结果合并更稳定，也更接近“同一条回复内完整输出”的体验。

## 和旧版说明相比，最重要的变化

- 不再使用 `lynx-discovery.config.json`
- 统一以 `openclaw.plugin.json` 中的 `openclawDiscovery` 为准
- `/lynx-check` 现在输出的是综合检测报告，不是只返回 discovery 结果
- discovery 结果现在作为最后一段自动附加，而不是依赖旧式 prepend 文案来提醒用户自己刷新查看

## 一句话总结

这份 README 对应的是“当前代码版”的 SX-openclaw-discovery：

- 配置入口已经切到 `openclaw.plugin.json`
- 核心场景已经切到 `/lynx-check` 综合检测
- 输出链路已经切到 `before_message_write` 主附加、`agent_end` 兜底补发
