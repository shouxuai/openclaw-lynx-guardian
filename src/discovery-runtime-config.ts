import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import type { OpenClawDiscoveryConfig } from "./openclaw-discovery.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface DiscoveryRuntimeConfigLoadResult {
  config: OpenClawDiscoveryConfig;
  path: string;
  created: boolean;
  warnings: string[];
}

const DEFAULT_DISCOVERY_RUNTIME_CONFIG: { openclawDiscovery: OpenClawDiscoveryConfig } = {
  openclawDiscovery: {
    enabled: true,
    runOnStartup: false,
    fullScan: false,
    localOnly: false,
  },
};

function findPluginRoot(): string {
  const candidates = [
    resolve(__dirname),
    resolve(__dirname, ".."),
    resolve(__dirname, "..", ".."),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "openclaw.plugin.json"))) {
      return candidate;
    }
  }

  return resolve(__dirname, "..");
}

export function getDiscoveryRuntimeConfigPath(): string {
  return join(findPluginRoot(), "lynx-discovery.config.json");
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeDefaultConfig(filePath: string): boolean {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify(DEFAULT_DISCOVERY_RUNTIME_CONFIG, null, 2),
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

export function loadDiscoveryRuntimeConfig(): DiscoveryRuntimeConfigLoadResult {
  const configPath = getDiscoveryRuntimeConfigPath();
  const warnings: string[] = [];
  let created = false;

  if (!existsSync(configPath)) {
    created = writeDefaultConfig(configPath);
    if (!created) {
      warnings.push(`无法在插件目录生成默认检测配置文件: ${configPath}`);
    }
  }

  const raw = readJsonFile<{ openclawDiscovery?: OpenClawDiscoveryConfig }>(configPath);
  if (raw?.openclawDiscovery && typeof raw.openclawDiscovery === "object") {
    return {
      config: {
        ...DEFAULT_DISCOVERY_RUNTIME_CONFIG.openclawDiscovery,
        ...raw.openclawDiscovery,
      },
      path: configPath,
      created,
      warnings,
    };
  }

  if (existsSync(configPath)) {
    warnings.push(`检测配置文件格式无效，将回退到默认配置: ${configPath}`);
  }

  return {
    config: { ...DEFAULT_DISCOVERY_RUNTIME_CONFIG.openclawDiscovery },
    path: configPath,
    created,
    warnings,
  };
}
