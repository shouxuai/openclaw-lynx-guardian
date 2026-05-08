import * as http from "http";
import * as https from "https";
import * as net from "net";
import { URL } from "url";

export interface OpenClawDiscoveryConfig {
  enabled?: boolean;
  runOnStartup?: boolean;
  targets?: string[];
  candidatePorts?: number[];
  fullScan?: boolean;
  localOnly?: boolean;
  timeoutMs?: number;
  hostConcurrency?: number;
  portConcurrency?: number;
  minScore?: number;
  maxHosts?: number;
}

export interface DiscoveryHit {
  target: string;
  host: string;
  port: number;
  alive: boolean;
  score: number;
  confidence: string;
  confidenceDesc: string;
  matchedFeatures: string[];
  version: string;
  scheme: "http" | "https" | "";
  statusCode?: number;
}

export interface DiscoveryReport {
  scannedTargets: number;
  expandedHosts: number;
  elapsedMs: number;
  hits: DiscoveryHit[];
  warnings: string[];
}

interface HostTarget {
  source: string;
  host: string;
  explicitPort?: number;
  preferredScheme?: "http" | "https";
}

interface ResponseInfo {
  status: number;
  headers: Record<string, string>;
  body: string;
  scheme: "http" | "https";
}

interface FingerprintRule {
  pattern: string;
  score: number;
  desc: string;
}

interface HeaderFingerprintRule extends FingerprintRule {
  key: string;
}

interface PathFingerprintRule {
  path: string;
  score: number;
  desc: string;
}

const MAX_BODY_BYTES = 8192;

export const DEFAULT_CANDIDATE_PORTS = [
  18789,
  8080, 8443, 3000,
  9000, 9090, 9443,
  4000, 5000, 7000,
  80, 443, 8000,
  8888, 8889, 18790,
];

const BODY_FINGERPRINTS: FingerprintRule[] = [
  { pattern: "openclaw", score: 40, desc: "品牌关键词" },
  { pattern: "control ui", score: 15, desc: "Control UI 标识" },
  { pattern: "gateway", score: 5, desc: "网关关键词" },
  { pattern: "openclaw.ai", score: 35, desc: "官方域名" },
  { pattern: "openclaw-gateway", score: 45, desc: "网关进程标识" },
  { pattern: "channel", score: 3, desc: "频道概念" },
  { pattern: "agent", score: 3, desc: "Agent 概念" },
  { pattern: "websocket", score: 3, desc: "WebSocket 支持" },
];

const HEADER_FINGERPRINTS: HeaderFingerprintRule[] = [
  { key: "server", pattern: "openclaw", score: 50, desc: "Server 头" },
  { key: "x-powered-by", pattern: "openclaw", score: 50, desc: "X-Powered-By 头" },
  { key: "x-gateway", pattern: "openclaw", score: 50, desc: "自定义网关头" },
];

const PATH_FINGERPRINTS: PathFingerprintRule[] = [
  { path: "/health", score: 10, desc: "健康检查端点" },
  { path: "/status", score: 10, desc: "状态端点" },
  { path: "/api/health", score: 10, desc: "API 健康检查" },
  { path: "/api/status", score: 10, desc: "API 状态" },
  { path: "/api/v1/health", score: 10, desc: "API v1 健康检查" },
];

const CONFIDENCE_LEVELS = [
  { threshold: 80, level: "确认", desc: "OpenClaw 网关 [高置信度]" },
  { threshold: 50, level: "高度疑似", desc: "高度疑似 OpenClaw" },
  { threshold: 25, level: "疑似", desc: "疑似 OpenClaw (建议人工验证)" },
  { threshold: 10, level: "可能", desc: "可能是 OpenClaw (需进一步确认)" },
  { threshold: 0, level: "未知", desc: "HTTP 服务 (未匹配 OpenClaw 指纹)" },
] as const;

function getConfidenceLabel(score: number): { level: string; desc: string } {
  for (const item of CONFIDENCE_LEVELS) {
    if (score >= item.threshold) {
      return { level: item.level, desc: item.desc };
    }
  }
  return { level: "未知", desc: "未知服务" };
}

function uniquePorts(ports?: number[]): number[] {
  const source = Array.isArray(ports) && ports.length > 0 ? ports : DEFAULT_CANDIDATE_PORTS;
  const valid = source.filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535);
  return [...new Set(valid)];
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

function ipToNumber(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function numberToIp(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function expandIpv4Cidr(target: string, maxHosts: number): string[] | null {
  const [baseIp, prefixRaw] = target.split("/");
  const prefix = Number(prefixRaw);
  if (!isIpv4(baseIp) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }

  const base = ipToNumber(baseIp);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = base & mask;
  const total = 2 ** (32 - prefix);

  let first = network;
  let last = network + total - 1;
  if (prefix <= 30) {
    first += 1;
    last -= 1;
  }

  const hostCount = Math.max(0, last - first + 1);
  if (hostCount > maxHosts) {
    return [];
  }

  const hosts: string[] = [];
  for (let current = first; current <= last; current += 1) {
    hosts.push(numberToIp(current >>> 0));
  }
  return hosts;
}

function parseHostTarget(rawTarget: string, maxHosts: number, warnings: string[]): HostTarget[] {
  const value = rawTarget.trim();
  if (!value) return [];

  if (/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(value)) {
    const hosts = expandIpv4Cidr(value, maxHosts);
    if (hosts === null) {
      warnings.push(`跳过无效网段: ${value}`);
      return [];
    }
    if (hosts.length === 0) {
      warnings.push(`跳过网段 ${value}: 主机数量超过 maxHosts=${maxHosts}`);
      return [];
    }
    return hosts.map((host) => ({ source: value, host }));
  }

  if (value.includes("://")) {
    try {
      const url = new URL(value);
      const protocol = url.protocol === "https:" ? "https" : "http";
      const port = url.port ? Number(url.port) : undefined;
      return [{ source: value, host: url.hostname, explicitPort: port, preferredScheme: protocol }];
    } catch {
      warnings.push(`跳过无效 URL: ${value}`);
      return [];
    }
  }

  const hostPortMatch = value.match(/^([^:/]+):(\d{1,5})$/);
  if (hostPortMatch) {
    const port = Number(hostPortMatch[2]);
    if (port >= 1 && port <= 65535) {
      return [{ source: value, host: hostPortMatch[1], explicitPort: port }];
    }
    warnings.push(`跳过无效端口目标: ${value}`);
    return [];
  }

  return [{ source: value, host: value }];
}

async function asyncPool<T, R>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(maxConcurrency, items.length) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  });

  await Promise.all(runners);
  return results;
}

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const entries = Object.entries(headers).map(([key, value]) => {
    if (Array.isArray(value)) {
      return [key.toLowerCase(), value.join(", ")] as const;
    }
    return [key.toLowerCase(), value ?? ""] as const;
  });
  return Object.fromEntries(entries);
}

async function performRequest(
  scheme: "http" | "https",
  host: string,
  port: number,
  path: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<ResponseInfo | null> {
  const client = scheme === "https" ? https : http;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: ResponseInfo | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = client.request(
      {
        host,
        port,
        path,
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; LynxGuardian/1.0)",
          Accept: "text/html,application/json,*/*",
          ...headers,
        },
        timeout: timeoutMs,
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let collected = 0;

        res.on("data", (chunk: Buffer) => {
          if (collected >= MAX_BODY_BYTES) return;
          const remaining = MAX_BODY_BYTES - collected;
          const slice = chunk.subarray(0, remaining);
          chunks.push(slice);
          collected += slice.length;
        });

        res.on("end", () => {
          finish({
            status: res.statusCode ?? 0,
            headers: normalizeHeaders(res.headers),
            body: Buffer.concat(chunks).toString("utf8"),
            scheme,
          });
        });
      },
    );

    req.on("upgrade", (res, socket) => {
      socket.destroy();
      finish({
        status: res.statusCode ?? 101,
        headers: normalizeHeaders(res.headers),
        body: "",
        scheme,
      });
    });

    req.on("timeout", () => {
      req.destroy();
      finish(null);
    });

    req.on("error", () => finish(null));
    req.end();
  });
}

async function httpGet(
  host: string,
  port: number,
  path: string,
  timeoutMs: number,
  preferredScheme?: "http" | "https",
): Promise<ResponseInfo | null> {
  const schemes: ("http" | "https")[] = preferredScheme
    ? [preferredScheme, preferredScheme === "http" ? "https" : "http"]
    : ["http", "https"];

  for (const scheme of schemes) {
    const response = await performRequest(scheme, host, port, path, timeoutMs);
    if (response) {
      return response;
    }
  }
  return null;
}

async function checkWebSocket(
  host: string,
  port: number,
  timeoutMs: number,
  preferredScheme?: "http" | "https",
): Promise<boolean> {
  const schemes: ("http" | "https")[] = preferredScheme
    ? [preferredScheme, preferredScheme === "http" ? "https" : "http"]
    : ["http", "https"];

  for (const scheme of schemes) {
    const response = await performRequest(scheme, host, port, "/", timeoutMs, {
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version": "13",
    });

    if (!response) {
      continue;
    }

    if (response.status === 101) {
      return true;
    }

    const upgrade = response.headers.upgrade?.toLowerCase() ?? "";
    if (upgrade.includes("websocket")) {
      return true;
    }
  }

  return false;
}

async function checkTcpPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host, port });

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function tcpScanPorts(
  host: string,
  ports: number[],
  timeoutMs: number,
  maxConcurrency: number,
): Promise<number[]> {
  const results = await asyncPool(ports, maxConcurrency, async (port) => {
    const open = await checkTcpPort(host, port, timeoutMs);
    return open ? port : 0;
  });
  return results.filter((port) => port > 0).sort((a, b) => a - b);
}

function buildFullPortList(): number[] {
  return Array.from({ length: 65535 }, (_, index) => index + 1);
}

async function fingerprintOpenClaw(
  target: HostTarget,
  port: number,
  timeoutMs: number,
): Promise<DiscoveryHit> {
  const result: DiscoveryHit = {
    target: target.source,
    host: target.host,
    port,
    alive: false,
    score: 0,
    confidence: "未知",
    confidenceDesc: "",
    matchedFeatures: [],
    version: "unknown",
    scheme: "",
  };

  const rootResponse = await httpGet(target.host, port, "/", timeoutMs, target.preferredScheme);
  if (!rootResponse) {
    return result;
  }

  result.alive = true;
  result.statusCode = rootResponse.status;
  result.scheme = rootResponse.scheme;

  const bodyLower = rootResponse.body.toLowerCase();
  for (const fingerprint of BODY_FINGERPRINTS) {
    if (bodyLower.includes(fingerprint.pattern)) {
      result.score += fingerprint.score;
      result.matchedFeatures.push(`[Body] ${fingerprint.desc}: '${fingerprint.pattern}'`);
    }
  }

  for (const fingerprint of HEADER_FINGERPRINTS) {
    const value = rootResponse.headers[fingerprint.key] ?? "";
    if (value.toLowerCase().includes(fingerprint.pattern)) {
      result.score += fingerprint.score;
      result.matchedFeatures.push(`[Header] ${fingerprint.desc}: ${fingerprint.key}=${value}`);
      if (fingerprint.key === "server" || value.toLowerCase().includes("version")) {
        result.version = value;
      }
    }
  }

  for (const fingerprint of PATH_FINGERPRINTS) {
    const pathResponse = await httpGet(target.host, port, fingerprint.path, timeoutMs, result.scheme || target.preferredScheme);
    if (!pathResponse || pathResponse.status >= 404) {
      continue;
    }

    result.score += fingerprint.score;
    result.matchedFeatures.push(
      `[Path] ${fingerprint.desc}: ${fingerprint.path} -> HTTP ${pathResponse.status}`,
    );

    if (pathResponse.body.toLowerCase().includes("openclaw")) {
      result.score += 20;
      result.matchedFeatures.push(`[Path+Body] ${fingerprint.path} 响应含 'openclaw' 关键词`);
    }
  }

  if (await checkWebSocket(target.host, port, timeoutMs, result.scheme || target.preferredScheme)) {
    result.score += 10;
    result.matchedFeatures.push("[WS] 支持 WebSocket 升级");
  }

  result.score = Math.min(100, result.score);
  const confidence = getConfidenceLabel(result.score);
  result.confidence = confidence.level;
  result.confidenceDesc = confidence.desc;
  return result;
}

async function scanTarget(
  target: HostTarget,
  config: Required<Pick<OpenClawDiscoveryConfig, "fullScan" | "timeoutMs" | "portConcurrency">> & {
    candidatePorts: number[];
    minScore: number;
  },
): Promise<DiscoveryHit[]> {
  if (target.explicitPort) {
    const hit = await fingerprintOpenClaw(target, target.explicitPort, config.timeoutMs);
    return hit.alive && hit.score >= config.minScore ? [hit] : [];
  }

  const ports = config.fullScan ? buildFullPortList() : config.candidatePorts;
  const openPorts = await tcpScanPorts(
    target.host,
    ports,
    Math.max(100, Math.floor(config.timeoutMs / 2)),
    config.portConcurrency,
  );

  if (openPorts.length === 0) {
    return [];
  }

  const checks = await asyncPool(openPorts, Math.min(config.portConcurrency, 32), async (port) => (
    fingerprintOpenClaw(target, port, config.timeoutMs)
  ));

  return checks.filter((hit) => hit.alive && hit.score >= config.minScore);
}

function sortHits(hits: DiscoveryHit[]): DiscoveryHit[] {
  return [...hits].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.host !== right.host) {
      return left.host.localeCompare(right.host);
    }
    return left.port - right.port;
  });
}

function normalizeHitHost(host: string): string {
  const value = host.trim().toLowerCase();
  if (value === "localhost" || value === "::1" || value === "[::1]") {
    return "127.0.0.1";
  }
  return value;
}

function dedupeHits(hits: DiscoveryHit[]): DiscoveryHit[] {
  const deduped = new Map<string, DiscoveryHit>();

  for (const hit of hits) {
    const normalizedHost = normalizeHitHost(hit.host);
    const key = `${normalizedHost}|${hit.port}|${hit.scheme || ""}`;
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, {
        ...hit,
        host: normalizedHost === "127.0.0.1" ? "127.0.0.1" : hit.host,
      });
      continue;
    }

    const preferred = hit.score > existing.score ? hit : existing;
    const mergedFeatures = [...new Set([
      ...existing.matchedFeatures,
      ...hit.matchedFeatures,
    ])];

    deduped.set(key, {
      ...preferred,
      host: normalizedHost === "127.0.0.1" ? "127.0.0.1" : preferred.host,
      matchedFeatures: mergedFeatures,
      score: Math.max(existing.score, hit.score),
      statusCode: preferred.statusCode ?? existing.statusCode,
      confidence: preferred.score >= existing.score ? preferred.confidence : existing.confidence,
      confidenceDesc: preferred.score >= existing.score ? preferred.confidenceDesc : existing.confidenceDesc,
    });
  }

  return [...deduped.values()];
}

export async function discoverOpenClaw(config: OpenClawDiscoveryConfig = {}): Promise<DiscoveryReport> {
  const timeoutMs = clamp(config.timeoutMs, 2000, 250, 15000);
  const hostConcurrency = clamp(config.hostConcurrency, 20, 1, 128);
  const portConcurrency = clamp(config.portConcurrency, 128, 1, 1024);
  const maxHosts = clamp(config.maxHosts, 256, 1, 4096);
  const minScore = clamp(config.minScore, 1, 0, 100);
  const candidatePorts = uniquePorts(config.candidatePorts);
  const warnings: string[] = [];
  const rawTargets = Array.isArray(config.targets) ? config.targets : [];

  const expandedTargets = rawTargets.flatMap((target) => parseHostTarget(target, maxHosts, warnings));
  const start = Date.now();

  const batches = await asyncPool(
    expandedTargets,
    hostConcurrency,
    async (target) => scanTarget(target, {
      fullScan: config.fullScan === true,
      timeoutMs,
      portConcurrency,
      candidatePorts,
      minScore,
    }),
  );

  const hits = sortHits(dedupeHits(batches.flat()));

  return {
    scannedTargets: rawTargets.length,
    expandedHosts: expandedTargets.length,
    elapsedMs: Date.now() - start,
    hits,
    warnings,
  };
}

export function formatDiscoverySummary(report: DiscoveryReport): string {
  const confirmed = report.hits.filter((hit) => hit.score >= 80);
  const likely = report.hits.filter((hit) => hit.score >= 50 && hit.score < 80);
  const suspect = report.hits.filter((hit) => hit.score < 50);

  const lines = [
    "OpenClaw 服务检测完成",
    `- 扫描目标数: ${report.scannedTargets}`,
    `- 展开主机数: ${report.expandedHosts}`,
    `- 命中结果数: ${report.hits.length}`,
    `- 检测耗时: ${(report.elapsedMs / 1000).toFixed(1)}s`,
    `- 已确认 OpenClaw 服务: ${confirmed.length} 个`,
    `- 高度疑似 OpenClaw 服务: ${likely.length} 个`,
    `- 低置信度候选: ${suspect.length} 个`,
  ];

  if (report.warnings.length > 0) {
    lines.push("检测警告:");
    for (const warning of report.warnings.slice(0, 10)) {
      lines.push(`- ${warning}`);
    }
  }

  if (confirmed.length > 0) {
    lines.push("已确认的 OpenClaw 服务列表:");
    for (const hit of confirmed) {
      lines.push(
        `- IP=${hit.host} 端口=${hit.port} 协议=${hit.scheme || "http"} 评分=${hit.score} 状态=${hit.confidence}`,
      );
    }
  } else {
    lines.push("已确认的 OpenClaw 服务列表:");
    lines.push("- 未检测到高置信度 OpenClaw 服务");
  }

  if (likely.length > 0) {
    lines.push("高度疑似的 OpenClaw 服务列表:");
    for (const hit of likely) {
      lines.push(
        `- IP=${hit.host} 端口=${hit.port} 协议=${hit.scheme || "http"} 评分=${hit.score} 状态=${hit.confidence}`,
      );
    }
  }

  if (suspect.length > 0) {
    lines.push("低置信度候选列表:");
    for (const hit of suspect.slice(0, 20)) {
      lines.push(
        `- IP=${hit.host} 端口=${hit.port} 协议=${hit.scheme || "http"} 评分=${hit.score} 状态=${hit.confidence}`,
      );
    }
    if (suspect.length > 20) {
      lines.push(`- 其余 ${suspect.length - 20} 个低置信度候选已省略`);
    }
  }

  return lines.join("\n");
}
