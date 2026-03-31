# SX-openclaw-discovery

## 作用

这个能力用于识别 OpenClaw 网关可能暴露的 IP / 端口，并把服务发现结果作为 `/lynx-check` 综合报告的最后一部分输出。

当前实现里，它已经不是“单独跑一个旧版 discovery 配置文件”的模式了，而是由插件主流程统一调度。

## 触发方式

在 OpenClaw 对话里输入以下任一命令，都可以触发检测：

| 命令                                     | 说明                     |
| ---------------------------------------- | ------------------------ |
| `check` / `/check`                   | 通用检测入口             |
| `lynx-check` / `/lynx-check`         | Lynx Guardian 主检测入口 |
| `openclaw-check` / `/openclaw-check` | OpenClaw 服务检测别名    |

也支持自然语言触发，规则是同时命中三类关键词：

- 动作词：`检查`、`检测`、`扫描`、`探测`、`排查`、`check`
- 目标词：`openclaw`、`lynx`
- 信号词：`服务`、`进程`、`网关`、`IP`、`端口`、`地址`

例如：

- `帮我检查 openclaw 服务`
- `扫描 lynx 的 IP 和端口`
- `check openclaw gateway`

## 配置来源

discovery 的配置来源以插件配置为准：

- 配置源标识：`openclaw.plugin.json`
- 运行时读取位置：插件配置对象中的 `openclawDiscovery`
- 默认值补齐位置：`src/discovery/discovery-runtime-config.ts`

也就是说，README 这里描述的配置项，应当按 `openclaw.plugin.json` 里的 `openclawDiscovery` schema 来理解。

## 当前推荐配置

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

如果你不显式传这些值，系统会使用默认值。

## 配置项说明

| 配置项              | 默认值       | 当前状态 | 说明                                                                                      |
| ------------------- | ------------ | -------- | ----------------------------------------------------------------------------------------- |
| `enabled`         | `true`     | 保留项   | schema 中存在，当前 `/lynx-check` 主路径里会强制执行 discovery，不依赖它做最终开关      |
| `runOnStartup`    | `false`    | 保留项   | 目前主要用于兼容和预留，当前主流程没有单独启用“启动即自动扫描”                          |
| `targets`         | 空           | 生效     | 显式指定扫描目标，支持 `host`、`host:port`、`http://...`、`https://...`、`CIDR` |
| `candidatePorts`  | 内置端口列表 | 生效     | 非全端口扫描时的候选端口集合                                                              |
| `fullScan`        | `false`    | 生效     | `true` 时扫描 `1-65535`，`false` 时只扫描候选端口                                   |
| `localOnly`       | `false`    | 生效     | `true` 时只扩展本机目标；`false` 时还会扩展本机局域网网段                             |
| `timeoutMs`       | `2000`     | 生效     | 单次请求 / 端口探测超时，范围 `250-15000` ms                                            |
| `hostConcurrency` | `20`       | 生效     | 并发主机扫描上限，范围 `1-128`                                                          |
| `portConcurrency` | `128`      | 生效     | 并发端口扫描上限，范围 `1-1024`                                                         |
| `minScore`        | `1`        | 生效     | 命中结果最低指纹分数，范围 `0-100`                                                      |
| `maxHosts`        | `256`      | 生效     | CIDR 展开后的最大主机数，范围 `1-4096`                                                  |

## 候选端口默认值

当 `candidatePorts` 未配置时，当前代码会使用以下默认端口：

```text
18789, 8080, 8443, 3000, 9000, 9090, 9443, 4000, 5000, 7000, 80, 443, 8000, 8888, 8889, 18790
```

其中 `18789` 是最重要的默认目标端口。

## 目标解析规则

当 `targets` 没有配置时，插件会自动推导目标：

1. 总是优先加入 `127.0.0.1:<gatewayPort>` 和 `localhost:<gatewayPort>`
2. 当 `localOnly=false` 时，还会尝试加入当前探测到的本机 IPv4 地址
3. 当 `localOnly=false` 时，还会把本机局域网网段展开为 CIDR 目标进行扫描

`targets` 支持这些格式：

- `127.0.0.1`
- `127.0.0.1:18789`
- `localhost:18789`
- `http://127.0.0.1:18789`
- `https://demo.example.com`
- `192.168.1.0/24`

## 指纹识别逻辑

当前探测不是“只看端口开没开”，而是会做一层 OpenClaw 指纹识别，主要包括：

- 页面 / 接口响应体关键字
- 响应头关键字
- 健康检查路径，如 `/health`、`/status`、`/api/health`
- WebSocket 升级能力

最后会根据得分给出置信度分级，大致可理解为：

- `>= 80`：确认
- `>= 50`：高度疑似
- `>= 25`：疑似
- `>= 10`：可能
- `< 10`：未知 HTTP 服务

## 当前输出结构

现在 `/lynx-check` 不再只返回 IP/端口探测结果，而是一个四段式综合报告：

1. 公网暴露检测
2. 恶意脚本扫描
3. Skill 完整性校验
4. 服务发现 IP / 端口

其中“服务发现 IP / 端口”固定放在最后，更适合 WebChat 阅读。

## 服务发现部分会显示什么

服务发现摘要里通常会包含：

- 扫描目标数
- 展开主机数
- 命中结果数
- 检测耗时
- 已确认的 OpenClaw 服务数量
- 高度疑似的 OpenClaw 服务数量
- 低置信度候选数量

如果命中了服务，还会列出类似：

```text
- IP=127.0.0.1 端口=18789 协议=http 评分=90 状态=确认
```

## 输出时机

当前最新实现里，discovery 结果会先落到本地暂存文件，再由插件生命周期 hook 在最终消息写入前附加到原始回答里。

也就是说：

- 主要附加时机：`before_message_write`
- 兜底发送路径：`agent_end`

这也是为什么现在它能更稳定地和原回答合并，而不是只在刷新后才看到。

## 一句话总结

这份 README 对应的是“当前代码版”的 discovery：

- 配置不再看 `lynx-discovery.config.json`
- 以 `openclaw.plugin.json` 中的 `openclawDiscovery` 为准
- `/lynx-check` 返回的是四类综合检测
- 服务发现 IP / 端口报告作为最后一段附加输出
