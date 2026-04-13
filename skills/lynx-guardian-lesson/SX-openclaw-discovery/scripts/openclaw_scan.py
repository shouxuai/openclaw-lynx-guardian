#!/usr/bin/env python3
"""
OpenClaw 网关存活探测工具 v2
核心能力：即使目标修改了 IP/端口，也能通过指纹识别定位 OpenClaw 服务

探测策略：
  1. 常见端口快扫  → 快速覆盖高概率端口
  2. 全端口扫描    → 不放过任何端口 (--full)
  3. 多维度指纹匹配 → HTTP 响应体 / 响应头 / WebSocket / RPC 路径
  4. 置信度评分    → 综合多个特征给出判断可信度

使用前请确保已获得目标网络的扫描授权
"""

import argparse
import concurrent.futures
import hashlib
import ipaddress
import json
import socket
import ssl
import struct
import sys
import time
import urllib.error
import urllib.request

BANNER = r"""
   ___                    ____ _                  ____                       ___
  / _ \ _ __   ___ _ __  / ___| | __ ___      __ / ___|  ___ __ _ _ __   ___{__ \
 | | | | '_ \ / _ \ '_ \| |   | |/ _` \ \ /\ / / \___ \ / __/ _` | '_ \ / _ \/ /
 | |_| | |_) |  __/ | | | |___| | (_| |\ V  V /   ___) | (_| (_| | | | |  __/_|
  \___/| .__/ \___|_| |_|\____|_|\__,_| \_/\_/   |____/ \___\__,_|_| |_|\___(_)
       |_|                                          v2 - 端口无关指纹识别
"""

# ─── OpenClaw 指纹特征库 ───────────────────────────────────────────────

# 高概率端口列表（默认端口 + 常见替代端口）
CANDIDATE_PORTS = [
    18789,              # 官方默认
    8080, 8443, 3000,   # 常见 Web 替代
    9000, 9090, 9443,   # 常见网关端口
    4000, 5000, 7000,   # Node.js 常用
    80, 443, 8000,      # 标准 Web
    8888, 8889, 18790,  # 临近端口
]

# OpenClaw 指纹特征 - 每命中一条加对应分数，满分 100
FINGERPRINTS = {
    # ── HTTP 响应体关键词 (body) ──
    "body": [
        {"pattern": "openclaw",          "score": 40, "desc": "品牌关键词"},
        {"pattern": "control ui",        "score": 15, "desc": "Control UI 标识"},
        {"pattern": "gateway",           "score": 5,  "desc": "网关关键词"},
        {"pattern": "openclaw.ai",       "score": 35, "desc": "官方域名"},
        {"pattern": "openclaw-gateway",  "score": 45, "desc": "网关进程标识"},
        {"pattern": "channel",           "score": 3,  "desc": "频道概念"},
        {"pattern": "agent",             "score": 3,  "desc": "Agent 概念"},
        {"pattern": "websocket",         "score": 3,  "desc": "WebSocket 支持"},
    ],
    # ── HTTP 响应头 (headers) ──
    "headers": [
        {"key": "Server",        "pattern": "openclaw", "score": 50, "desc": "Server 头"},
        {"key": "X-Powered-By",  "pattern": "openclaw", "score": 50, "desc": "X-Powered-By 头"},
        {"key": "X-Gateway",     "pattern": "openclaw", "score": 50, "desc": "自定义网关头"},
    ],
    # ── RPC / API 路径探测 ──
    "paths": [
        {"path": "/health",       "score": 10, "desc": "健康检查端点"},
        {"path": "/status",       "score": 10, "desc": "状态端点"},
        {"path": "/api/health",   "score": 10, "desc": "API 健康检查"},
        {"path": "/api/status",   "score": 10, "desc": "API 状态"},
        {"path": "/api/v1/health","score": 10, "desc": "API v1 健康检查"},
    ],
}

# 置信度等级
CONFIDENCE_LEVELS = [
    (80, "确认",   "OpenClaw 网关 [高置信度]"),
    (50, "高度疑似","高度疑似 OpenClaw"),
    (25, "疑似",   "疑似 OpenClaw (建议人工验证)"),
    (10, "可能",   "可能是 OpenClaw (需进一步确认)"),
    (0,  "未知",   "HTTP 服务 (未匹配 OpenClaw 指纹)"),
]


def get_confidence_label(score: int) -> tuple[str, str]:
    """根据分数返回置信度等级和描述"""
    for threshold, level, desc in CONFIDENCE_LEVELS:
        if score >= threshold:
            return level, desc
    return "未知", "未知服务"


# ─── TCP 扫描 ──────────────────────────────────────────────────────────

def tcp_scan_ports(ip: str, ports: list[int], timeout: int = 1) -> list[int]:
    """快速扫描多个端口，返回开放端口列表"""
    open_ports = []

    def _check(port):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            if sock.connect_ex((str(ip), port)) == 0:
                return port
        except Exception:
            pass
        finally:
            try:
                sock.close()
            except Exception:
                pass
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(ports), 200)) as ex:
        for result in ex.map(_check, ports):
            if result is not None:
                open_ports.append(result)

    return sorted(open_ports)


def tcp_full_scan(ip: str, start: int = 1, end: int = 65535, timeout: float = 0.5, workers: int = 500) -> list[int]:
    """全端口扫描 (1-65535)"""
    open_ports = []
    ports = range(start, end + 1)

    def _check(port):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            if sock.connect_ex((str(ip), port)) == 0:
                return port
        except Exception:
            pass
        finally:
            try:
                sock.close()
            except Exception:
                pass
        return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        for result in ex.map(_check, ports):
            if result is not None:
                open_ports.append(result)

    return sorted(open_ports)


# ─── HTTP 指纹识别 ─────────────────────────────────────────────────────

def _make_ssl_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _http_get(ip: str, port: int, path: str = "/", timeout: int = 3) -> dict | None:
    """发送 HTTP GET 请求并返回响应信息"""
    ctx = _make_ssl_ctx()
    for scheme in ("http", "https"):
        url = f"{scheme}://{ip}:{port}{path}"
        try:
            req = urllib.request.Request(url, method="GET")
            req.add_header("User-Agent", "Mozilla/5.0 (compatible; SecurityAudit/2.0)")
            req.add_header("Accept", "text/html,application/json,*/*")

            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                return {
                    "status": resp.status,
                    "headers": dict(resp.headers),
                    "body": resp.read(8192).decode("utf-8", errors="ignore"),
                    "scheme": scheme,
                }
        except urllib.error.HTTPError as e:
            try:
                body = e.read(4096).decode("utf-8", errors="ignore")
            except Exception:
                body = ""
            return {
                "status": e.code,
                "headers": dict(e.headers) if hasattr(e, "headers") else {},
                "body": body,
                "scheme": scheme,
            }
        except Exception:
            continue
    return None


def fingerprint_openclaw(ip: str, port: int, timeout: int = 3) -> dict:
    """
    对指定 ip:port 进行 OpenClaw 指纹识别
    返回包含置信度评分的结果
    """
    result = {
        "ip": str(ip),
        "port": port,
        "alive": False,
        "score": 0,
        "confidence": "未知",
        "confidence_desc": "",
        "matched_features": [],
        "version": "unknown",
        "scheme": "",
    }

    # 1) 首页探测
    resp = _http_get(ip, port, "/", timeout)
    if not resp:
        return result

    result["alive"] = True
    result["status_code"] = resp["status"]
    result["scheme"] = resp["scheme"]

    body_lower = resp["body"].lower()
    headers = resp["headers"]

    # 2) 匹配 body 指纹
    for fp in FINGERPRINTS["body"]:
        if fp["pattern"] in body_lower:
            result["score"] += fp["score"]
            result["matched_features"].append(f"[Body] {fp['desc']}: '{fp['pattern']}'")

    # 3) 匹配 header 指纹
    for fp in FINGERPRINTS["headers"]:
        header_val = headers.get(fp["key"], "")
        if fp["pattern"] in header_val.lower():
            result["score"] += fp["score"]
            result["matched_features"].append(f"[Header] {fp['desc']}: {fp['key']}={header_val}")
            if "version" in header_val.lower() or fp["key"] == "Server":
                result["version"] = header_val

    # 4) 探测特定路径
    for fp in FINGERPRINTS["paths"]:
        path_resp = _http_get(ip, port, fp["path"], timeout)
        if path_resp and path_resp["status"] < 404:
            result["score"] += fp["score"]
            result["matched_features"].append(
                f"[Path] {fp['desc']}: {fp['path']} -> HTTP {path_resp['status']}"
            )
            # 路径响应体里也做关键词匹配
            if "openclaw" in path_resp["body"].lower():
                result["score"] += 20
                result["matched_features"].append(
                    f"[Path+Body] {fp['path']} 响应含 'openclaw' 关键词"
                )

    # 5) WebSocket 升级探测 (OpenClaw Control UI 使用 WebSocket)
    if _check_websocket(ip, port, timeout):
        result["score"] += 10
        result["matched_features"].append("[WS] 支持 WebSocket 升级")

    # 6) 置信度判定
    result["score"] = min(result["score"], 100)
    result["confidence"], result["confidence_desc"] = get_confidence_label(result["score"])

    return result


def _check_websocket(ip: str, port: int, timeout: int = 2) -> bool:
    """检测是否支持 WebSocket 升级"""
    ctx = _make_ssl_ctx()
    for scheme in ("http", "https"):
        url = f"{scheme}://{ip}:{port}/"
        try:
            req = urllib.request.Request(url, method="GET")
            req.add_header("Upgrade", "websocket")
            req.add_header("Connection", "Upgrade")
            req.add_header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
            req.add_header("Sec-WebSocket-Version", "13")
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                if resp.status == 101:
                    return True
        except urllib.error.HTTPError as e:
            # 某些实现返回 400 但带有 Upgrade 相关头
            if hasattr(e, "headers"):
                upgrade = e.headers.get("Upgrade", "").lower()
                if "websocket" in upgrade:
                    return True
        except Exception:
            continue
    return False


# ─── 网段扫描编排 ──────────────────────────────────────────────────────

def scan_host_auto(ip: str, ports: list[int], timeout: int, full: bool, deep: bool) -> list[dict]:
    """
    自动发现模式：对单主机先找开放端口，再逐个做指纹识别
    """
    # 第一步：端口发现
    if full:
        open_ports = tcp_full_scan(ip, timeout=timeout * 0.5)
    else:
        open_ports = tcp_scan_ports(ip, ports, timeout)

    if not open_ports:
        return []

    # 第二步：对每个开放端口做指纹识别
    hits = []
    for port in open_ports:
        result = fingerprint_openclaw(ip, port, timeout + 1)
        if result["alive"] and result["score"] > 0:
            hits.append(result)

    return hits


def scan_network_auto(
    network: str,
    ports: list[int] | None = None,
    max_workers: int = 50,
    timeout: int = 2,
    full: bool = False,
    deep: bool = False,
    min_score: int = 0,
) -> list[dict]:
    """网段级自动扫描"""
    if ports is None:
        ports = CANDIDATE_PORTS

    try:
        net = ipaddress.ip_network(network, strict=False)
    except ValueError as e:
        print(f"[!] 无效的网段格式: {e}")
        sys.exit(1)

    hosts = list(net.hosts())
    total = len(hosts)

    print(f"[*] 目标网段     : {network}")
    print(f"[*] 候选端口     : {ports if not full else '1-65535 (全端口)'}")
    print(f"[*] 待探测主机   : {total}")
    print(f"[*] 并发数       : {max_workers}")
    print(f"[*] 最低置信分数  : {min_score}")
    print("-" * 70)

    all_hits = []
    scanned = 0
    start_time = time.time()

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(scan_host_auto, str(ip), ports, timeout, full, deep): str(ip)
            for ip in hosts
        }

        for future in concurrent.futures.as_completed(future_map):
            scanned += 1
            try:
                hits = future.result()
            except Exception:
                hits = []

            for h in hits:
                if h["score"] >= min_score:
                    all_hits.append(h)
                    _print_hit(h)

            if scanned % 20 == 0 or scanned == total:
                pct = scanned / total * 100
                elapsed = time.time() - start_time
                sys.stdout.write(
                    f"\r[*] 进度: {scanned}/{total} ({pct:.1f}%) "
                    f"| 已发现: {len(all_hits)} | 耗时: {elapsed:.1f}s"
                )
                sys.stdout.flush()

    elapsed = time.time() - start_time
    all_hits.sort(key=lambda x: (-x["score"], ipaddress.ip_address(x["ip"])))

    _print_summary(total, all_hits, elapsed)
    return all_hits


def _print_hit(h: dict):
    """打印单条发现"""
    score_bar = "#" * (h["score"] // 5) + "-" * (20 - h["score"] // 5)
    print(
        f"\n  [+] {h['ip']:>15s}:{h['port']:<5d}  "
        f"[{score_bar}] {h['score']:>3d}分  "
        f"{h['confidence']}: {h['confidence_desc']}"
    )
    for feat in h["matched_features"]:
        print(f"      -> {feat}")


def _print_summary(total: int, hits: list[dict], elapsed: float):
    """打印汇总报告"""
    confirmed = [h for h in hits if h["score"] >= 80]
    likely    = [h for h in hits if 50 <= h["score"] < 80]
    suspect   = [h for h in hits if 25 <= h["score"] < 50]
    possible  = [h for h in hits if h["score"] < 25]

    print(f"\n\n{'=' * 70}")
    print(f" OpenClaw 网关存活探测报告")
    print(f"{'=' * 70}")
    print(f" 扫描主机总数    : {total}")
    print(f" 扫描耗时        : {elapsed:.2f}s")
    print(f"{'─' * 70}")
    print(f" 确认 OpenClaw   : {len(confirmed):>4d}  (评分 >= 80)")
    print(f" 高度疑似        : {len(likely):>4d}  (评分 50-79)")
    print(f" 疑似            : {len(suspect):>4d}  (评分 25-49)")
    print(f" 可能            : {len(possible):>4d}  (评分 < 25)")
    print(f"{'─' * 70}")
    print(f" 总发现数        : {len(hits)}")
    if total > 0:
        print(f" OpenClaw 存活率  : {len(confirmed) / total * 100:.2f}% (仅计确认)")
    print(f"{'=' * 70}")

    if confirmed:
        print(f"\n [确认的 OpenClaw 实例]")
        for h in confirmed:
            print(f"   {h['scheme']}://{h['ip']}:{h['port']}  (评分:{h['score']})")

    if likely:
        print(f"\n [高度疑似 - 建议验证]")
        for h in likely:
            print(f"   {h['scheme']}://{h['ip']}:{h['port']}  (评分:{h['score']})")


# ─── 单主机模式 ────────────────────────────────────────────────────────

def scan_single_auto(target: str, ports: list[int], timeout: int, full: bool):
    """单主机全面探测"""
    print(f"[*] 目标: {target}")
    print(f"[*] 模式: {'全端口扫描 (1-65535)' if full else f'候选端口 {ports}'}")
    print("-" * 70)

    # 端口发现
    print("[1/3] 端口发现...")
    if full:
        open_ports = tcp_full_scan(target, timeout=timeout * 0.5)
    else:
        open_ports = tcp_scan_ports(target, ports, timeout)

    if not open_ports:
        print("  [-] 未发现开放端口")
        return

    print(f"  [+] 开放端口: {open_ports}")

    # 指纹识别
    print("[2/3] OpenClaw 指纹识别...")
    results = []
    for port in open_ports:
        print(f"  [*] 探测 {target}:{port} ...")
        result = fingerprint_openclaw(target, port, timeout + 1)
        if result["alive"]:
            results.append(result)
            _print_hit(result)

    # 汇总
    print(f"\n[3/3] 汇总")
    print(f"{'=' * 70}")
    if not results:
        print("  [-] 未检测到 OpenClaw 服务")
    else:
        best = max(results, key=lambda r: r["score"])
        if best["score"] >= 50:
            print(f"  [+] 最可能的 OpenClaw 实例: {best['scheme']}://{target}:{best['port']}")
            print(f"      置信度: {best['confidence']} ({best['score']}分)")
        else:
            print(f"  [?] 未发现高置信度 OpenClaw 实例，最高评分: {best['score']}分")
            print(f"      建议使用 --full 进行全端口扫描")
    print(f"{'=' * 70}")


# ─── 导出 ─────────────────────────────────────────────────────────────

def export_results(results: list[dict], filename: str):
    """导出扫描结果"""
    # 清理不可序列化的字段
    clean = []
    for r in results:
        clean.append({
            "ip": r.get("ip"),
            "port": r.get("port"),
            "scheme": r.get("scheme"),
            "score": r.get("score"),
            "confidence": r.get("confidence"),
            "confidence_desc": r.get("confidence_desc"),
            "status_code": r.get("status_code"),
            "version": r.get("version"),
            "matched_features": r.get("matched_features", []),
        })

    if filename.endswith(".json"):
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(clean, f, ensure_ascii=False, indent=2)
    else:
        with open(filename, "w", encoding="utf-8") as f:
            f.write("IP,端口,协议,评分,置信度,状态码,版本,匹配特征\n")
            for r in clean:
                feats = " | ".join(r.get("matched_features", []))
                f.write(
                    f"{r['ip']},{r['port']},{r['scheme']},{r['score']},"
                    f"{r['confidence']},{r.get('status_code','')},{r['version']},\"{feats}\"\n"
                )
    print(f"[*] 结果已保存到: {filename}")


# ─── CLI 入口 ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="OpenClaw 网关存活探测工具 v2 - 端口无关指纹识别",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用示例:

  # 场景1: 默认端口扫描 C 段
  python3 openclaw_scan.py -n 192.168.1.0/24

  # 场景2: 目标改了端口 → 全端口扫描单主机
  python3 openclaw_scan.py -H 10.0.0.5 --full

  # 场景3: 指定候选端口范围
  python3 openclaw_scan.py -n 10.0.0.0/24 -p 8080,9090,18789,3000

  # 场景4: 全端口扫描整个网段 (慢但全面)
  python3 openclaw_scan.py -n 192.168.1.0/24 --full -w 30

  # 场景5: 只显示高置信度结果
  python3 openclaw_scan.py -n 192.168.1.0/24 --min-score 50

  # 场景6: 批量目标 + 导出
  python3 openclaw_scan.py -f targets.txt -o report.json
        """,
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("-n", "--network", help="目标网段 (CIDR)")
    group.add_argument("-H", "--host", help="单个目标 IP/域名")
    group.add_argument("-f", "--file", help="目标列表文件 (每行一个 IP)")

    parser.add_argument("-p", "--ports", default=None,
                        help="候选端口, 逗号分隔 (默认使用内置高概率端口列表)")
    parser.add_argument("--full", action="store_true",
                        help="全端口扫描 (1-65535), 慢但不遗漏")
    parser.add_argument("-w", "--workers", type=int, default=50,
                        help="网段扫描并发数 (默认 50)")
    parser.add_argument("-t", "--timeout", type=int, default=2,
                        help="超时时间/秒 (默认 2)")
    parser.add_argument("--min-score", type=int, default=0,
                        help="最低置信分数过滤 (默认 0, 显示所有)")
    parser.add_argument("-o", "--output", help="导出路径 (.json 或 .csv)")

    args = parser.parse_args()
    print(BANNER)

    # 解析端口
    if args.ports:
        ports = [int(p.strip()) for p in args.ports.split(",")]
    else:
        ports = CANDIDATE_PORTS

    if args.host:
        scan_single_auto(args.host, ports, args.timeout, args.full)

    elif args.file:
        try:
            with open(args.file, "r") as f:
                targets = [l.strip() for l in f if l.strip() and not l.startswith("#")]
        except FileNotFoundError:
            print(f"[!] 文件不存在: {args.file}")
            sys.exit(1)

        print(f"[*] 从文件加载 {len(targets)} 个目标")
        all_hits = []
        for t in targets:
            hits = scan_host_auto(t, ports, args.timeout, args.full, False)
            for h in hits:
                if h["score"] >= args.min_score:
                    all_hits.append(h)
                    _print_hit(h)

        _print_summary(len(targets), all_hits, 0)
        if args.output and all_hits:
            export_results(all_hits, args.output)

    else:
        results = scan_network_auto(
            network=args.network,
            ports=ports,
            max_workers=args.workers,
            timeout=args.timeout,
            full=args.full,
            min_score=args.min_score,
        )
        if args.output and results:
            export_results(results, args.output)


if __name__ == "__main__":
    main()
