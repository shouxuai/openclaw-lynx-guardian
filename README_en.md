# Lynx Guardian

Lynx - First Order Lynx, an agent security product. Lynx—renowned for its keen vision, symbolizing "high-resolution perception" of risk, multi-dimensionally identifying agent threats and reshaping agent security boundaries.

[中文](https://github.com/shouxuai/openclaw-lynx-guardian/blob/main/README_en.md) | 
[en](https://github.com/shouxuai/openclaw-lynx-guardian/blob/main/README_en.md)

## 🛡️ Core Functions

1. **Automatic Identity Registration and Management**

- Automatically generates a unique, compliant user ID upon plugin startup.

- Integrates with the backend security center to ensure every agent session is traceable.

2. **End-to-End Risk Detection**

- **Input/Output Review**: Real-time scanning of user input and model output to identify potential value risks (such as political, pornographic, or terrorist content).

- **Tool Call Protection**:

- **Local Blacklist**: Millisecond-level interception of high-risk commands (such as `rm -rf /`, modifying `/etc/passwd`, etc.).

- **Semantic Analysis**: Deeply analyzes the true intent of tool calls based on context to prevent bypass and injection attacks. **Peripheral Application Protection:**

- **Monitors and blocks unauthorized access to external systems (such as databases, file systems, etc.).**

- **Strictly verifies permissions for calls to external systems to prevent unauthorized access.**

3. **Tiered Response Mechanism:**

- 🔴 **High Risk (Level 3)**: Directly blocks the operation and reports it to the security center.

- 🟠 **Medium Risk (Level 2)**: Blocks the operation; it can only be allowed after explicit user confirmation (entering "Confirm" or "Agree").

- 🟡 **Low Risk (Level 1)**: Allows the operation, but injects security prompts and value guidance into the context.

4. **Autonomous Security Enhancement:**

- Based on metacognitive autonomous learning, enhances the Agent's capabilities and security awareness in the security domain.

5. **Real-Time Audit Reporting:**

- All interception records and risk events are reported to the backend in real time, forming a complete security audit chain.

## 📦 Installation Steps

【Method 1】Install via OpenClaw:

```bash
openclaw plugins install @shouxuai/openclaw-lynx-guardian

```
【Method 2】Install via source code:

Enter the following command in the OpenClaw dialog box:

```text Install the OpenClaw lynx-guardian plugin for me. Plugin address: https://github.com/shouxuai/openclaw-lynx-guardian

```
【Method 3】Manual installation steps:

1. Clone the plugin repository:

```bash

git clone https://github.com/shouxuai/openclaw-lynx-guardian.git

```
2. Enter the plugin directory:

Copy the plugin directory to the OpenClaw plugin directory:

```bash

cp -r openclaw-lynx-guardian /path/to/openclaw/extensions/

```
Copy the skill directory to OpenClaw Skills directory:

``bash

cp -r openclaw-lynx-guardian/skills/lynx-guardian-lesson /path/to/openclaw/skills/

```
Copy the hooks directory to the OpenClaw hooks directory:

``bash

cp -r openclaw-lynx-guardian/hooks/lynx-guardian-sensitiveData /path/to/openclaw/hooks/

```
3. Install dependencies:

``bash

npm install

```
4. Enable plugins:

``config configuration

"plugins": {

"entries": {

"openclaw-lynx-guardian": {

"enabled": true

}
},

"installs": {

"openclaw-lynx-guardian": {

"spec": "openclaw-lynx-guardian",

"installPath": "/path/to/openclaw/extensions/", "version": "1.0.1",

"resolvedName": "openclaw-lynx-guardian",

"resolvedVersion": "1.0.1",

"resolvedSpec": "openclaw-lynx-guardian@1.0.1",

"shasum": "e8275df385212d82b495775658d813fb03a6eea6",

"resolvedAt": "2026-03-02T11:49:51.903Z",

"installedAt": "2026-03-02T11:49:51.923Z"

}
}
}

``
## 🔧 Enable Metacognition to Improve Security Decisions
```bash
openclaw hooks enable lynx-guardian-lesson
openclaw skills enable lynx-guardian-sensitiveData

```

## ⚙️ Configuration Instructions

The plugin connects to the first-order server environment by default. To modify the backend API address, please set the environment variable `LYNX_API_URL`.

## 📜 License

MIT License