import { baseIpInfo, listLocalSubnetCidrs } from "../utils.js";
import { discoverOpenClaw, formatDiscoverySummary } from "./openclaw-discovery.js";
import { normalizeStringList } from "../runtime/plugin-runtime-helpers.js";
import { classifyLynxCheckTrigger } from "./lynx-check-trigger.js";

export function isManualCompositeLynxCheckRequest(text: string): boolean {
  return classifyLynxCheckTrigger(text).kind === "lynx_command";
}

export function isManualDiscoveryRequest(text: string): boolean {
  return classifyLynxCheckTrigger(text).kind === "keyword_request";
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
  let fallbackReply = "OpenClaw service discovery has completed. Please check logs for details.";
  try {
    const targets = await resolveDiscoveryTargets(discoveryConfig);
    if (targets.length === 0) {
      fallbackReply = "OpenClaw service discovery skipped: no discoverable targets resolved.";
      return fallbackReply;
    }

    const scanMode = discoveryConfig.fullScan === true ? "full-port scan" : "candidate-port scan";
    const startReply = `OpenClaw service discovery started, mode: ${scanMode}\nconfig: ${discoveryRuntimePath}\ntargets: ${targets.join(", ")}`;
    fallbackReply = startReply;

    log.info(
      `[lynx-guardian] Manual OpenClaw discovery triggered, mode=${scanMode}, config=${discoveryRuntimePath}, targets=${targets.join(", ")}`,
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
    log.error(`[lynx-guardian] Manual OpenClaw discovery failed: ${err.message}`);
    fallbackReply = `OpenClaw service discovery failed: ${err.message}`;
    return fallbackReply;
  }
}
