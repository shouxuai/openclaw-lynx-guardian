import { baseIpInfo, listLocalSubnetCidrs } from "../utils.js";
import { discoverOpenClaw, formatDiscoverySummary } from "./openclaw-discovery.js";
import { normalizeStringList } from "../runtime/plugin-runtime-helpers.js";

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function isManualDiscoveryRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const exactCommands = [
    "check",
    "/check",
    "lynx-check",
    "/lynx-check",
    "openclaw-check",
    "/openclaw-check",
  ];
  if (exactCommands.some((command) => normalized === command || normalized.startsWith(`${command} `))) {
    return true;
  }

  const compact = normalized.replace(/\s+/g, "");
  const actionKeywords = ["检查", "检测", "扫描", "探测", "排查", "check"];
  const targetKeywords = ["openclaw", "龙虾", "lynx"];
  const signalKeywords = ["服务", "进程", "网关", "ip", "端口", "地址",];

  return hasKeyword(compact, actionKeywords)
    && hasKeyword(compact, targetKeywords)
    && hasKeyword(compact, signalKeywords);
}

export async function resolveDiscoveryTargets(config: any): Promise<string[]> {
  const configuredTargets = normalizeStringList(config?.targets);
  if (configuredTargets.length > 0) {
    return [...new Set(configuredTargets)];
  }

  const discoveredTargets = new Set<string>();
  const ipInfo = await baseIpInfo();
  const port = typeof ipInfo?.port === "number" ? ipInfo.port : 18789;

  discoveredTargets.add(`127.0.0.1:${port}`);
  discoveredTargets.add(`localhost:${port}`);

  if (config?.localOnly === true) {
    return [...discoveredTargets];
  }

  if (typeof ipInfo?.ip === "string" && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ipInfo.ip)) {
    discoveredTargets.add(`${ipInfo.ip}:${port}`);
  }

  for (const target of listLocalSubnetCidrs()) {
    discoveredTargets.add(target);
  }

  return [...discoveredTargets];
}

export async function runDiscoveryAndNotify(
  log: any,
  _ctx: any,
  discoveryConfig: any,
  discoveryRuntimePath: string,
): Promise<string> {
  let fallbackReply = "OpenClaw 服务检测已执行，请查看日志明细。";
  try {
    const targets = await resolveDiscoveryTargets(discoveryConfig);
    if (targets.length === 0) {
      fallbackReply = "OpenClaw 服务检测已跳过：未能解析到可检测的目标。";
      return fallbackReply;
    }

    const scanMode = discoveryConfig.fullScan === true ? "全端口扫描" : "候选端口扫描";
    const startReply = `OpenClaw 服务检测已启动，模式: ${scanMode}\n配置文件: ${discoveryRuntimePath}\n目标: ${targets.join(", ")}`;
    fallbackReply = startReply;

    log.info(
      `[lynx-guardian] 手动触发 OpenClaw 服务检测，模式: ${scanMode}，配置文件: ${discoveryRuntimePath}，目标: ${targets.join(", ")}`,
    );

    const report = await discoverOpenClaw({
      ...discoveryConfig,
      enabled: true,
      targets,
    });

    fallbackReply = formatDiscoverySummary(report);
    log.info(fallbackReply);
    return fallbackReply;
  } catch (err: any) {
    log.error(`[lynx-guardian] 手动 OpenClaw 服务检测失败: ${err.message}`);
    fallbackReply = `OpenClaw 服务检测失败: ${err.message}`;
    return fallbackReply;
  }
}
