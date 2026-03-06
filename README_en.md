# Lynx Guardian

Lynx - First Order Lynx, an agent security product. Lynx—renowned for its keen vision, symbolizing "high-resolution perception" of risk, multi-dimensionally identifying agent threats and reshaping agent security boundaries.

## 🛡️ Core Functions

1. **Automatic Identity Registration and Management**

- Automatically generates a unique, compliant user ID upon plugin startup.

- Integrates with the backend security center to ensure every agent session is traceable.

2. **End-to-End Risk Detection**

- **Input/Output Review**: Real-time scanning of user input and model output to identify potential value risks (such as political, pornographic, or terrorist content).

- **Tool Call Protection**:

- **Local Blacklist**: Millisecond-level interception of high-risk commands (such as `rm -rf /`, modifying `/etc/passwd`, etc.).

- **Semantic Analysis**: Deeply analyzes the true intent of tool calls based on context to prevent bypass and injection attacks. **External Application Protection:**

- **Monitor and block unauthorized access to external systems (such as databases, file systems, etc.).**

- **Strict permission verification is performed on calls to external systems to prevent unauthorized access.**

3. **Tiered Response Mechanism:**

- 🔴 **High Risk (Level 3)**: Operations are directly blocked and reported to the security center.

- 🟠 **Medium Risk (Level 2)**: Operations are blocked; explicit user confirmation (entering "Confirm" or "Agree") is required before permission is granted.

- 🟡 **Low Risk (Level 1)**: Operations are allowed, but security prompts and value guidance are injected into the context.

4. **Real-Time Audit Reporting:**

- All blocked records and risk events are reported to the backend in real time, forming a complete security audit chain.

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
3. Install dependencies: 
```bash 
npm install 
```
4. Enable the plugin: 
```config configuration 
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

``

## ⚙️ Configuration Instructions

The plugin connects to the first-order server environment by default. To modify the backend API address, please set the environment variable `LYNX_API_URL`.

## 📜 License

MIT License