## 🔎 OpenClaw 服务检测

### 触发方式

在 OpenClaw 对话框中输入以下任意指令即可触发检测：

**精确指令（直接输入）：**

| 指令                                      | 说明                   |
| ----------------------------------------- | ---------------------- |
| `check` 或 `/check`                   | 通用检测指令           |
| `lynx-check` 或 `/lynx-check`         | Lynx Guardian 专用指令 |
| `openclaw-check` 或 `/openclaw-check` | OpenClaw 检测指令      |

**自然语言（中文）：**

需同时包含「动作 + 目标 + 信号」三类关键词，例如：

- `检测龙虾IP` / `扫描龙虾端口` / `检查openclaw服务`
- 动作词：检查、检测、扫描、探测、排查
- 目标词：openclaw、龙虾
- 信号词：服务、进程、网关、IP、端口、地址

**自然语言（英文）：**

- `scan openclaw port` / `check openclaw service` / `detect claw gateway`
- Action: check, scan, detect, discover
- Target: openclaw, lobster, claw
- Signal: service, port, gateway, ip, address

### 检测配置

通过插件目录下的 `lynx-discovery.config.json` 控制检测行为：

```json
{
  "openclawDiscovery": {
    "enabled": true,
    "runOnStartup": false,
    "fullScan": false,
    "localOnly": false
  }
}
```

| 参数             | 默认值    | 说明                                                                         |
| ---------------- | --------- | ---------------------------------------------------------------------------- |
| `enabled`      | `true`  | 是否启用检测功能                                                             |
| `runOnStartup` | `false` | 插件启动时是否自动扫描（建议保持 false）                                     |
| `fullScan`     | `false` | `true` = 扫描全部 65535 端口；`false` = 仅扫描候选端口                   |
| `localOnly`    | `false` | `true` = 仅检测本机端口（127.0.0.1/localhost）；`false` = 同时扫描局域网 |

### 检测报告

检测完成后，报告会直接输出到对话中，包含以下信息：

- 扫描目标数、展开主机数、命中结果数、检测耗时
- 已确认的 OpenClaw 服务列表（IP、端口、协议、评分、置信度）
- 高度疑似与低置信度候选列表

### 配套 Skill

插件内置 `SX-openclaw-discovery` Skill，插件启动时自动部署到 `~/.openclaw/skills/`。该 Skill 指导模型正确处理和输出检测报告，确保报告完整呈现、不被过滤或改写。
