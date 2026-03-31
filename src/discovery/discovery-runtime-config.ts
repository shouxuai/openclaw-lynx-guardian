import type { OpenClawDiscoveryConfig } from "./openclaw-discovery.js";

export const DISCOVERY_CONFIG_SOURCE_PATH = "openclaw.plugin.json";

const DEFAULT_DISCOVERY_RUNTIME_CONFIG: OpenClawDiscoveryConfig = {
  enabled: true,
  runOnStartup: false,
  fullScan: false,
  localOnly: false,
};

export function loadDiscoveryRuntimeConfig(
  inlineConfig?: OpenClawDiscoveryConfig,
): OpenClawDiscoveryConfig {
  return {
    ...DEFAULT_DISCOVERY_RUNTIME_CONFIG,
    ...(inlineConfig && typeof inlineConfig === "object" && !Array.isArray(inlineConfig)
      ? inlineConfig
      : {}),
  };
}
