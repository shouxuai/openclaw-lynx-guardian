# OpenClaw 网关存活探测工具 — 实现原理与技术剖析

## 一、背景与目标

OpenClaw 是一个自托管 AI 网关服务，用于将 WhatsApp、Telegram、Discord 等聊天平台桥接到 AI 编程代理。其默认监听端口为 `18789`（HTTP），提供 Control UI 和 WebSocket RPC 通信。

在实际网络安全评估中，管理员可能修改了默认端口甚至 IP 绑定地址，导致传统"固定端口扫描"失效。本工具的核心目标是：

> **无论 OpenClaw 部署在哪个 IP、哪个端口上，都能准确识别并判断其存活状态。**

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      扫描调度层                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ 单主机模式 │  │ 网段模式  │  │ 文件批量  │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       └──────────────┼────────────┘                         │
│                      ▼                                      │
│  ┌──────────────────────────────────────────────┐           │
│  │       线程池并发调度 (ThreadPoolExecutor)       │           │
│  └──────────────────┬───────────────────────────┘           │
│                     ▼                                       │
├─────────────────────────────────────────────────────────────┤
│                   第 1 层: 端口发现                           │
│  ┌──────────────────┐  ┌────────────────────────┐           │
│  │ 候选端口快扫 (15个)│  │ 全端口扫描 (1-65535)    │           │
│  │ TCP SYN Connect  │  │ TCP SYN Connect        │           │
│  └────────┬─────────┘  └───────────┬────────────┘           │
│           └────────────┬───────────┘                        │
│                        ▼                                    │
├─────────────────────────────────────────────────────────────┤
│                 第 2 层: HTTP 指纹识别                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Body匹配  │ │ Header匹配│ │ 路径探测  │ │ WS探测   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                        ▼                                    │
├─────────────────────────────────────────────────────────────┤
│                 第 3 层: 置信度评分                           │
│           加权评分 → 等级判定 → 结果排序                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、核心原理详解

### 3.1 第一层：端口发现 — TCP Connect 扫描

**问题**：OpenClaw 可能运行在任意端口上，如何找到它？

**原理**：TCP 三次握手。向目标端口发送 SYN 包，如果收到 SYN+ACK 则端口开放，收到 RST 则端口关闭。

```
客户端                服务端
  │── SYN ──────────→ │
  │←── SYN+ACK ───── │  ← 端口开放
  │── ACK ──────────→ │
  │                    │
  │── SYN ──────────→ │
  │←── RST ────────  │  ← 端口关闭
```

**实现方式**：使用 Python `socket.connect_ex()` 进行非阻塞连接检测：

```python
def tcp_scan_ports(ip, ports, timeout=1):
    """对候选端口列表进行并发 TCP 探测"""
    open_ports = []

    def _check(port):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        # connect_ex 返回 0 表示连接成功（端口开放）
        if sock.connect_ex((ip, port)) == 0:
            return port
        return None

    # 多线程并发扫描
    with ThreadPoolExecutor(max_workers=200) as executor:
        for result in executor.map(_check, ports):
            if result:
                open_ports.append(result)

    return open_ports
```

**两种扫描模式**：

| 模式 | 端口范围 | 速度 | 适用场景 |
|------|---------|------|---------|
| 候选端口快扫 | 15 个高概率端口 | 快 (< 5秒/主机) | 已知目标可能使用常见端口 |
| 全端口扫描 `--full` | 1-65535 | 慢 (约 30-60秒/主机) | 完全未知端口，不能遗漏 |

候选端口列表的选取逻辑：
```python
CANDIDATE_PORTS = [
    18789,              # OpenClaw 官方默认端口
    8080, 8443, 3000,   # 常见 Web 服务替代端口
    9000, 9090, 9443,   # 常见网关/代理端口
    4000, 5000, 7000,   # Node.js 应用常用端口
    80, 443, 8000,      # 标准 HTTP/HTTPS
    8888, 8889, 18790,  # 默认端口临近范围
]
```

---

### 3.2 第二层：HTTP 指纹识别 — 多维特征匹配

端口开放只说明"有服务在监听"，不能证明是 OpenClaw。需要通过 HTTP 响应的多个维度来做指纹匹配。

#### 3.2.1 响应体 (Body) 关键词匹配

原理：访问服务根路径 `/`，分析 HTML/JSON 响应中是否包含 OpenClaw 特有关键词。

```python
# OpenClaw 特征关键词及其权重
body_fingerprints = [
    {"pattern": "openclaw",          "score": 40},  # 品牌名称
    {"pattern": "openclaw.ai",       "score": 35},  # 官方域名
    {"pattern": "openclaw-gateway",  "score": 45},  # 进程标识
    {"pattern": "control ui",        "score": 15},  # UI 标识
]

# 匹配逻辑
body_lower = response.body.lower()
for fp in body_fingerprints:
    if fp["pattern"] in body_lower:
        score += fp["score"]
```

**为什么有效**：OpenClaw 的 Control UI 是 Web 页面，HTML 中必然包含产品名称、JS 资源引用等特征字符串。即使管理员改了端口，这些内容不会变。

#### 3.2.2 HTTP 响应头 (Headers) 匹配

原理：Web 服务通常在 `Server`、`X-Powered-By` 等响应头中暴露框架/产品信息。

```python
header_fingerprints = [
    {"key": "Server",       "pattern": "openclaw", "score": 50},
    {"key": "X-Powered-By", "pattern": "openclaw", "score": 50},
    {"key": "X-Gateway",    "pattern": "openclaw", "score": 50},
]

for fp in header_fingerprints:
    header_value = headers.get(fp["key"], "").lower()
    if fp["pattern"] in header_value:
        score += fp["score"]
```

**为什么有效**：即使页面被自定义，HTTP 响应头通常不会被修改，是可靠的指纹来源。

#### 3.2.3 特定路径探测

原理：OpenClaw 内置了 `health`、`status` 等运维端点。探测这些路径是否存在且能正常响应。

```python
health_paths = ["/health", "/status", "/api/health", "/api/status"]

for path in health_paths:
    resp = http_get(ip, port, path)
    if resp and resp.status < 404:
        score += 10  # 路径存在加基础分
        if "openclaw" in resp.body.lower():
            score += 20  # 路径响应含特征词加额外分
```

**为什么有效**：这些是 OpenClaw 架构内置的功能端点，与端口配置无关。其他服务通常不会同时拥有完全相同的路径组合。

#### 3.2.4 WebSocket 升级探测

原理：OpenClaw Control UI 通过 WebSocket 与网关通信。发送 WebSocket 升级请求，检查服务端是否支持协议切换。

```
GET / HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13

→ 预期响应 HTTP 101 Switching Protocols
```

```python
def _check_websocket(ip, port, timeout=2):
    req = Request(url, method="GET")
    req.add_header("Upgrade", "websocket")
    req.add_header("Connection", "Upgrade")
    req.add_header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
    req.add_header("Sec-WebSocket-Version", "13")

    resp = urlopen(req, timeout=timeout)
    return resp.status == 101
```

**为什么有效**：OpenClaw 的 RPC 通信依赖 WebSocket，支持 WS 升级是其架构特征之一。

---

### 3.3 第三层：置信度评分系统

**问题**：单一特征可能误判（例如很多服务都有 `/health` 端点），如何综合判断？

**方案**：加权评分制。每个指纹特征有不同的分值，匹配越多分数越高，置信度越强。

```
评分规则：

  高权重 (40-50分) — 确定性特征
  ├── Server 头含 "openclaw"             → 50 分
  ├── X-Powered-By 含 "openclaw"         → 50 分
  ├── Body 含 "openclaw-gateway"         → 45 分
  └── Body 含 "openclaw"                 → 40 分

  中权重 (10-35分) — 辅助特征
  ├── Body 含 "openclaw.ai"              → 35 分
  ├── 路径响应含 "openclaw"              → 20 分
  ├── Body 含 "control ui" + "gateway"   → 15 分
  └── 特定路径存在 (/health 等)           → 10 分/个

  低权重 (3-10分) — 弱相关特征
  ├── WebSocket 升级支持                  → 10 分
  ├── Body 含 "channel"                  → 3 分
  ├── Body 含 "agent"                    → 3 分
  └── Body 含 "gateway"                  → 5 分
```

**置信度等级划分**：

```
 >=80 分   ███████████████████ 确认      → OpenClaw 网关 [高置信度]
 50-79 分  █████████████       高度疑似   → 高度疑似 OpenClaw
 25-49 分  ████████            疑似      → 建议人工验证
 10-24 分  ████                可能      → 需进一步确认
  <10 分   █                   未知      → 未匹配特征
```

**为什么用评分制而非规则匹配**：
- 单一特征容易误判（`/health` 很多服务都有）
- 高权重特征单独就能定性（Server 头含 "openclaw" 直接 50 分）
- 多个弱特征叠加也能定性（路径+WS+关键词 = 综合判断）
- 管理员可能删除部分特征，但不太可能删除所有特征

---

## 四、并发模型

### 4.1 两级线程池架构

```
                  主线程
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
    Host-A 线程  Host-B 线程  Host-C 线程    ← 第一级: 主机级并发
        │           │           │
    ┌───┼───┐   ┌───┼───┐   ┌───┼───┐
    ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼      ← 第二级: 端口级并发
   P1  P2  P3  P1  P2  P3  P1  P2  P3
```

- **第一级**：网段扫描时，每个主机分配一个线程（`max_workers=50`）
- **第二级**：单主机内，多个候选端口并行扫描（`max_workers=200`）

### 4.2 性能优化

```python
# 端口扫描使用短超时（0.5s），减少无响应端口的等待
tcp_full_scan(ip, timeout=0.5, workers=500)

# HTTP 指纹识别使用较长超时（3s），确保完整响应
fingerprint_openclaw(ip, port, timeout=3)
```

| 扫描场景 | 预估耗时 |
|---------|---------|
| 单主机 15 端口 | < 3 秒 |
| 单主机全端口 | 30-60 秒 |
| C 段 (/24) 15 端口 | 30-90 秒 |
| C 段 (/24) 全端口 | 15-30 分钟 |

---

## 五、协议级实现细节

### 5.1 HTTP/HTTPS 双协议探测

OpenClaw 可能配置了 TLS，所以对每个端口同时尝试 HTTP 和 HTTPS：

```python
for scheme in ("http", "https"):
    url = f"{scheme}://{ip}:{port}/"
    # 禁用证书验证（自签证书场景）
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
```

### 5.2 错误响应也是指纹

即使服务返回 `401 Unauthorized` 或 `403 Forbidden`，响应体和响应头中仍可能包含 OpenClaw 特征：

```python
except urllib.error.HTTPError as e:
    # 4xx/5xx 依然说明服务存活
    body = e.read(4096).decode("utf-8", errors="ignore")
    if "openclaw" in body.lower():
        result["is_openclaw"] = True  # 即使被拒绝，也能识别身份
```

---

## 六、工具文件说明

```
openclaw-scanner/
├── README.md               ← 本文 (实现原理)
├── openclaw_scan.py         ← v2 主扫描工具 (端口无关指纹识别)
└── host_alive_scan.py       ← v1 通用主机存活探测 (ICMP/TCP)
```

### openclaw_scan.py (v2 主工具)

核心能力：多端口扫描 + 多维指纹匹配 + 置信度评分

```bash
# 单主机全端口探测
python3 openclaw_scan.py -H 10.0.0.5 --full

# 网段扫描 + 自定义端口
python3 openclaw_scan.py -n 192.168.1.0/24 -p 8080,9090,3000

# 只看确认结果 + 导出
python3 openclaw_scan.py -n 10.0.0.0/24 --min-score 50 -o report.json
```

### host_alive_scan.py (v1 基础工具)

核心能力：ICMP Ping + TCP 探测，判断主机是否在线

```bash
# ICMP 存活探测
python3 host_alive_scan.py -n 192.168.1.0/24

# TCP 探测 (禁 ping 环境)
python3 host_alive_scan.py -n 10.0.0.0/24 -m tcp
```

---

## 七、对抗与局限性

| 对抗手段 | 影响 | 应对方案 |
|---------|------|---------|
| 修改默认端口 | 固定端口扫描失效 | `--full` 全端口扫描 |
| 删除 Server 头 | Header 指纹失效 | Body + 路径 + WS 多维互补 |
| 反向代理包裹 | 直接特征被隐藏 | 探测 API 路径响应特征 |
| 修改 HTML 内容 | Body 指纹减弱 | Header + 路径 + WS 仍有效 |
| 防火墙限速 | 扫描超时/被封 | 降低并发 `-w 10`、加大超时 `-t 5` |
| 白名单 IP 访问 | 无法连接 | 需要从授权网络发起扫描 |

---

## 八、合规声明

本工具仅用于：
- 经授权的内网安全评估与资产梳理
- 安全团队对自有网络的巡检与监控
- CTF 竞赛与安全研究教学

未经授权对他人网络进行扫描可能违反《网络安全法》等相关法律法规。使用者应确保在合法授权范围内使用本工具，并对使用后果自行承担责任。
