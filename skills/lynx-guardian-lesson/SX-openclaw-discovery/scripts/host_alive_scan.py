#!/usr/bin/env python3
"""
网络主机存活探测工具
用途：探测指定网段内存活的主机数量
方法：ICMP Ping / TCP SYN / ARP (可选)
使用前请确保已获得目标网络的扫描授权
"""

import subprocess
import ipaddress
import argparse
import concurrent.futures
import platform
import time
import sys


def ping_host(ip: str, timeout: int = 1) -> dict | None:
    """通过 ICMP ping 判断主机是否存活"""
    param = "-n" if platform.system().lower() == "windows" else "-c"
    timeout_param = "-w" if platform.system().lower() == "windows" else "-W"

    try:
        result = subprocess.run(
            ["ping", param, "1", timeout_param, str(timeout), str(ip)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout + 2,
        )
        if result.returncode == 0:
            return {"ip": str(ip), "status": "alive", "method": "ICMP"}
    except (subprocess.TimeoutExpired, Exception):
        pass
    return None


def tcp_probe(ip: str, port: int = 80, timeout: int = 1) -> dict | None:
    """通过 TCP 连接探测主机是否存活（适用于禁 ping 的场景）"""
    import socket

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((str(ip), port))
        sock.close()
        if result == 0:
            return {"ip": str(ip), "status": "alive", "method": f"TCP:{port}"}
    except Exception:
        pass
    return None


def scan_network(
    network: str,
    max_workers: int = 100,
    timeout: int = 1,
    method: str = "icmp",
    tcp_ports: list[int] | None = None,
) -> list[dict]:
    """
    扫描整个网段，返回存活主机列表

    参数:
        network:     CIDR 格式的网段，如 192.168.1.0/24
        max_workers: 并发线程数
        timeout:     每个探测的超时时间(秒)
        method:      探测方式 icmp / tcp / both
        tcp_ports:   TCP 探测端口列表
    """
    if tcp_ports is None:
        tcp_ports = [80, 443, 22, 3389]

    try:
        net = ipaddress.ip_network(network, strict=False)
    except ValueError as e:
        print(f"[!] 无效的网段格式: {e}")
        sys.exit(1)

    hosts = list(net.hosts())
    total = len(hosts)
    alive_hosts = []

    print(f"[*] 目标网段: {network}")
    print(f"[*] 待探测主机数: {total}")
    print(f"[*] 探测方式: {method.upper()}")
    print(f"[*] 并发线程数: {max_workers}")
    print(f"[*] 超时时间: {timeout}s")
    print("-" * 50)

    scanned = 0
    start_time = time.time()

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}

        for ip in hosts:
            if method in ("icmp", "both"):
                f = executor.submit(ping_host, str(ip), timeout)
                futures[f] = str(ip)

            if method in ("tcp", "both"):
                for port in tcp_ports:
                    f = executor.submit(tcp_probe, str(ip), port, timeout)
                    futures[f] = str(ip)

        seen_ips = set()
        for future in concurrent.futures.as_completed(futures):
            scanned += 1
            result = future.result()
            if result and result["ip"] not in seen_ips:
                seen_ips.add(result["ip"])
                alive_hosts.append(result)
                print(f"  [+] {result['ip']:>15s}  存活  ({result['method']})")

            # 进度显示
            if scanned % 50 == 0 or scanned == len(futures):
                pct = scanned / len(futures) * 100
                sys.stdout.write(f"\r[*] 进度: {scanned}/{len(futures)} ({pct:.1f}%)")
                sys.stdout.flush()

    elapsed = time.time() - start_time

    # 按 IP 排序
    alive_hosts.sort(key=lambda x: ipaddress.ip_address(x["ip"]))

    print(f"\n{'=' * 50}")
    print(f"[*] 扫描完成!")
    print(f"[*] 耗时: {elapsed:.2f}s")
    print(f"[*] 总主机数: {total}")
    print(f"[*] 存活主机数: {len(alive_hosts)}")
    print(f"[*] 存活率: {len(alive_hosts) / total * 100:.1f}%" if total > 0 else "")
    print(f"{'=' * 50}")

    return alive_hosts


def export_results(hosts: list[dict], filename: str):
    """将结果导出到文件"""
    with open(filename, "w") as f:
        f.write("IP地址,状态,探测方式\n")
        for h in hosts:
            f.write(f"{h['ip']},{h['status']},{h['method']}\n")
    print(f"[*] 结果已保存到: {filename}")


def main():
    parser = argparse.ArgumentParser(
        description="网络主机存活探测工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用示例:
  # ICMP 探测 (默认)
  python3 host_alive_scan.py -n 192.168.1.0/24

  # TCP 探测 (适用于禁 ping 环境)
  python3 host_alive_scan.py -n 10.0.0.0/24 -m tcp -p 80,443,22

  # 同时使用 ICMP + TCP
  python3 host_alive_scan.py -n 172.16.0.0/16 -m both -t 2 -w 200

  # 导出结果到文件
  python3 host_alive_scan.py -n 192.168.1.0/24 -o result.csv
        """,
    )

    parser.add_argument("-n", "--network", required=True, help="目标网段 (CIDR), 如 192.168.1.0/24")
    parser.add_argument("-m", "--method", choices=["icmp", "tcp", "both"], default="icmp", help="探测方式 (默认 icmp)")
    parser.add_argument("-p", "--ports", default="80,443,22,3389", help="TCP 探测端口, 逗号分隔 (默认 80,443,22,3389)")
    parser.add_argument("-w", "--workers", type=int, default=100, help="并发线程数 (默认 100)")
    parser.add_argument("-t", "--timeout", type=int, default=1, help="超时时间/秒 (默认 1)")
    parser.add_argument("-o", "--output", help="结果导出文件路径 (CSV 格式)")

    args = parser.parse_args()
    tcp_ports = [int(p.strip()) for p in args.ports.split(",")]

    print(r"""
  _   _           _     ____
 | | | | ___  ___| |_  / ___|  ___ __ _ _ __
 | |_| |/ _ \/ __| __| \___ \ / __/ _` | '_ \
 |  _  | (_) \__ \ |_   ___) | (_| (_| | | | |
 |_| |_|\___/|___/\__| |____/ \___\__,_|_| |_|
    """)

    alive = scan_network(
        network=args.network,
        max_workers=args.workers,
        timeout=args.timeout,
        method=args.method,
        tcp_ports=tcp_ports,
    )

    if args.output and alive:
        export_results(alive, args.output)


if __name__ == "__main__":
    main()
