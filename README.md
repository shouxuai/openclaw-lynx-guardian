
# Lynx Guardian (首序猞猁)

Lynx-首序猞猁，智能体安全产品。猞猁——以敏锐视觉著称，象征对风险的“高分辨率感知”，多维识别智能体威胁，重塑 Agent 安全边界。

[中文](https://github.com/shouxuai/openclaw-lynx-guardian/blob/main/README_en.md) | 
[en](https://github.com/shouxuai/openclaw-lynx-guardian/blob/main/README_en.md)

## 最新版本 (v2.0)

- **AI 自我安全防护 (SX-self-safety-guard)**：提示注入检测 (M1)、系统提示保护 (M2)、过度代理检测 (M3)、凭证窃取防护 (M5)、恶意代码请求拦截 (M6)，五级风险评估 (L0–L4)。
- **全方位安全审计 (SX-security-audit)**：插件启动时自动运行安全审计与恶意脚本扫描；支持权限、环境变量、依赖、Git、网络、Shell、macOS 等模块。
- 支持公网暴露访问检查，完善元认知安全自提升功能。

## 🛡️ 核心功能

1.  **自动身份注册与管理**
    -   插件启动时自动生成符合规范的唯一用户 ID 。
    -   与后端安全中心联动，确保每个智能体会话都有迹可循。

2.  **全链路风险检测**
    -   **输入/输出审查**: 实时扫描用户输入和模型输出，识别潜在的价值观风险（如涉政、涉黄、暴恐等）。
    -   **工具调用防护**:
        -   **本地黑名单**: 毫秒级拦截高危命令（如 `rm -rf /`、修改 `/etc/passwd` 等）。
        -   **语义分析**: 结合上下文深度分析工具调用的真实意图，防止绕过与注入攻击。
        **外围应用防护**:
        -   **监控并拦截对外部系统（如数据库、文件系统等）的未授权访问。
        -   **对外部系统的调用进行严格的权限验证，防止未授权访问。


3.  **分级响应机制**
    -   🔴 **高危 (Level 3)**: 直接阻断操作并上报至安全中心。
    -   🟠 **中危 (Level 2)**: 拦截操作，必须由用户明确确认（输入“确认”或“同意”）后方可放行。
    -   🟡 **低危 (Level 1)**: 允许操作，但在上下文中注入安全提示与价值观引导。

4.  **自主安全提升**
    -   基于元认知的自主学习，提升Agent在安全领域的能力和安全感知能力。

5.  **实时审计上报**
    -   所有拦截记录与风险事件均会实时上报至后端，形成完整的安全审计链。

6.  **AI 自我安全防护 (v2.0)**
    -   **输入防护**：在 `message_received`、`before_agent_start` 时检测提示注入、系统提示探测、过度代理、凭证窃取、恶意代码请求。
    -   **输出防护**：在 `agent_end` 时检测输出中是否泄露系统提示/受保护配置。
    -   **工具防护**：在 `before_tool_call` 时检测凭证访问、过度代理与「致命三角」风险。
    -   风险达 L3/L4 时自动拦截并上报。

7.  **安全审计 (v2.0)**
    -   插件启动时自动执行 `security_audit.py` 与恶意脚本扫描；结果写入日志。
    -   可通过配置 `securityAudit.runOnStartup`、`securityAudit.checks`、`securityAudit.severity` 控制。

## 👀 用户如何得知「自我审计」与「安全防护」

| 场景 | 用户/管理员如何知道 |
|------|----------------------|
| **安全防护拦截**（提示注入、恶意代码请求、高危工具调用等） | 对话或工具调用被阻断时，**界面会直接显示拦截原因**（如 `[Lynx Guardian] 🛡️ 安全防护拦截 (L4, score=8): 检测到提示注入攻击`），用户可见到具体风险类型与等级。 |
| **安全防护警告**（L2 风险，未阻断但需注意） | 会在本轮对话的**上下文开头注入安全提醒**，Agent 与用户都能看到该段提示。 |
| **启动时安全审计**（权限、依赖、环境变量、恶意脚本等） | 审计结果输出到 **OpenClaw 运行日志**（如 `[lynx-guardian] Security audit: ...`）。管理员查看日志即可看到通过/警告/失败统计与需关注项。 |
| **恶意脚本扫描** | 若有问题，同上在 **运行日志** 中输出 `[lynx-guardian] ⚠️ Malicious script scan found N issues` 及简要详情。 |
| **所有拦截与风险事件** | 会**上报至首序安全中心**，可在后端审计链中追溯。 |
| **lesson 学习记录** | 若启用了 `lynx-guardian-lesson` skill，敏感数据/内容风险/黑名单命中会写入工作区 `.lynx/SENSITIVE.md`、`.lynx/CONTENT.md`、`.lynx/TOOLS.md`，便于复盘与规则沉淀。 |

**建议**：管理员定期查看 OpenClaw 日志中的 `[lynx-guardian]` 输出，并视需要配置飞书 Webhook（见下方「安全审计报告发飞书」）或后端看板，以便集中感知审计与防护结果。

## 📦 安装步骤

【方式一】通过openclaw安装：
```bash
openclaw plugins install @shouxuai/openclaw-lynx-guardian

```
【方式二】通过源码安装：
openclaw对话框输入以下指令：
```text
帮我安装openclaw lynx-guardian插件，插件地址： https://github.com/shouxuai/openclaw-lynx-guardian

```
【方式三】手动安装步骤：

1.  克隆插件仓库：
    ```bash
    git clone https://github.com/shouxuai/openclaw-lynx-guardian.git
    ```
2.  进入插件目录：
    拷贝插件目录到 OpenClaw 插件目录：
    ```bash
    cp -r openclaw-lynx-guardian /path/to/openclaw/extensions/
    ```
    拷贝skill目录到 OpenClaw skill目录：
    ```bash
    cp -r openclaw-lynx-guardian/skills/lynx-guardian-lesson /path/to/openclaw/skills/
    ```
    拷贝hooks目录到 OpenClaw hooks目录：
    ```bash
    cp -r openclaw-lynx-guardian/hooks/lynx-guardian-sensitiveData /path/to/openclaw/hooks/
    ```
3.  安装依赖：
    ```bash
    npm install
    ```
4.  启用插件：
    ```config 配置
    "plugins": {
        "entries": {
            "openclaw-lynx-guardian": {
                "enabled": true
            }
        },
        "installs": {
            "openclaw-lynx-guardian": {
                "spec": "openclaw-lynx-guardian",
                "installPath": "/path/to/openclaw/extensions/",
                "version": "1.0.1",
                "resolvedName": "openclaw-lynx-guardian",
                "resolvedVersion": "1.0.1",
                "resolvedSpec": "openclaw-lynx-guardian@1.0.1",
                "shasum": "e8275df385212d82b495775658d813fb03a6eea6",
            "resolvedAt": "2026-03-02T11:49:51.903Z",
            "installedAt": "2026-03-02T11:49:51.923Z"
        }
        }
    }
    
    ```
## 🔧 启用元认知提升安全决策
```bash
    openclaw hooks enable lynx-guardian-lesson
    openclaw skills enable lynx-guardian-sensitiveData
```

## ⚙️ 配置说明

- **后端 API**：插件默认连接首序服务器环境。如需修改，请设置环境变量 `LYNX_API_URL`。
- **自我安全防护 (v2.0)**：在 OpenClaw 插件配置中可设置：
  - `selfSafetyGuard.enabled`：总开关
  - `selfSafetyGuard.inputGuard`：输入防护（提示注入、系统提示探测等）
  - `selfSafetyGuard.outputGuard`：输出防护（系统提示泄露检测）
  - `selfSafetyGuard.toolGuard`：工具调用防护（凭证窃取、过度代理、致命三角）
- **安全审计 (v2.0)**：
  - `securityAudit.runOnStartup`：是否在插件启动时运行审计
  - `securityAudit.checks`：要执行的模块（如 `permissions`, `env`, `git`, `dependencies` 等）
  - `securityAudit.severity`：最低报告级别（`low` / `medium` / `high` / `critical`）
- **安全审计报告发飞书**：审计脚本支持将报告发到飞书。在运行 `send_report_to_feishu.py` 前设置环境变量 `FEISHU_WEBHOOK_URL`，或在命令中传入 `--webhook <URL>`，即可在飞书群中收到审计摘要，便于团队感知。

## 📜 许可证

MIT License
