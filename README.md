
# Lynx Guardian (首序猞猁)

Lynx-首序猞猁，智能体安全产品。猞猁——以敏锐视觉著称，象征对风险的“高分辨率感知”，多维识别智能体威胁，重塑 Agent 安全边界。

[中文](https://github.com/shouxuai/openclaw-lynx-guardian/blob/main/README_en.md) | 
[en](https://github.com/shouxuai/openclaw-lynx-guardian/blob/main/README_en.md)

## 最新版本

-   支持公网暴露访问检查，完善元认知安全自提升功能。

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

插件默认连接首序服务器环境。如需修改后端 API 地址，请设置环境变量 `LYNX_API_URL`。

## 📜 许可证

MIT License
