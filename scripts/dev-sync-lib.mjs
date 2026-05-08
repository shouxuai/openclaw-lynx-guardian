import path from "path";

export const DEFAULT_GATEWAY_CONTAINER = "openclaw-openclaw-gateway-1";
export const DEFAULT_PLUGIN_NAME = "openclaw-lynx-guardian";
export const DEFAULT_CONTAINER_EXTENSIONS_ROOT = "/app/extensions";
export const PLUGIN_MANAGED_RESOURCE_PREFIX = "lynx-guardian-";

const DEFAULT_STAGE_EXCLUDES = new Set([
  ".git",
  ".worktrees",
  "dist",
  "node_modules",
  "test-temp",
]);

function normalizeRelativePath(relativePath) {
  return String(relativePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

export function shouldStagePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) {
    return true;
  }

  const [topLevel] = normalized.split("/");
  return !DEFAULT_STAGE_EXCLUDES.has(topLevel);
}

export function findStalePluginManagedDirectories({
  sourceNames = [],
  targetNames = [],
  managedPrefix = PLUGIN_MANAGED_RESOURCE_PREFIX,
} = {}) {
  const normalizedSourceNames = new Set(
    (Array.isArray(sourceNames) ? sourceNames : [])
      .map((name) => String(name ?? "").trim())
      .filter(Boolean),
  );

  return (Array.isArray(targetNames) ? targetNames : [])
    .map((name) => String(name ?? "").trim())
    .filter((name) => name.startsWith(managedPrefix) && !normalizedSourceNames.has(name))
    .sort();
}

export function resolveOpenClawHome({ platform = process.platform, env = process.env, override } = {}) {
  if (override) {
    return override;
  }

  const homeBase = platform === "win32"
    ? (env.USERPROFILE || env.HOME)
    : (env.HOME || env.USERPROFILE);

  if (!homeBase) {
    throw new Error("Unable to resolve the current user's home directory for OpenClaw.");
  }

  return path.join(homeBase, ".openclaw");
}

export function pickGatewayContainer(containerNames) {
  const names = Array.isArray(containerNames) ? containerNames.filter(Boolean) : [];
  const exact = names.find((name) => name === DEFAULT_GATEWAY_CONTAINER);
  if (exact) {
    return exact;
  }

  const fuzzy = names.find((name) => /openclaw/i.test(name) && /gateway/i.test(name));
  return fuzzy || DEFAULT_GATEWAY_CONTAINER;
}

export function buildDevSyncPlan({
  repoRoot,
  pluginName = DEFAULT_PLUGIN_NAME,
  openclawHome,
  containerName = DEFAULT_GATEWAY_CONTAINER,
  containerExtensionsRoot = DEFAULT_CONTAINER_EXTENSIONS_ROOT,
} = {}) {
  if (!repoRoot) {
    throw new Error("repoRoot is required.");
  }
  if (!openclawHome) {
    throw new Error("openclawHome is required.");
  }

  return {
    repoRoot,
    pluginName,
    openclawHome,
    containerName,
    containerExtensionsRoot,
    containerPluginPath: `${containerExtensionsRoot}/${pluginName}`,
    hostHooksPath: path.join(openclawHome, "hooks"),
    hostSkillsPath: path.join(openclawHome, "skills"),
  };
}

export function assessGatewayLogs(logText) {
  const text = String(logText ?? "");

  if (/blocked plugin candidate: world-writable path .*openclaw-lynx-guardian/i.test(text)) {
    return {
      status: "blocked",
      reason: "OpenClaw 仍然把插件目录识别为 world-writable，需要改用容器内安全路径。",
    };
  }

  if (text.includes("[lynx-guardian] Plugin loading...")) {
    return {
      status: "ready",
      reason: "Lynx Guardian 已经从容器内安全路径开始加载。",
    };
  }

  return {
    status: "unknown",
    reason: "最近日志里没有看到明确的 Lynx Guardian 启动标记。",
  };
}
