import path from "path";

export const DEFAULT_GATEWAY_CONTAINER = "openclaw-openclaw-gateway-1";
export const DEFAULT_PLUGIN_NAME = "openclaw-lynx-guardian";
export const DEFAULT_CONTAINER_EXTENSIONS_ROOT = "/app/extensions";
export const PLUGIN_MANAGED_RESOURCE_PREFIX = "lynx-guardian-";

const DEFAULT_TOP_LEVEL_STAGE_EXCLUDES = new Set([
  ".git",
  ".worktrees",
  "dist",
]);

const DEFAULT_ANY_LEVEL_STAGE_EXCLUDES = new Set([
  "node_modules",
  "vendor",
  ".vite",
  "coverage",
  "test-temp",
]);

function normalizeRelativePath(relativePath) {
  return String(relativePath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

export function shouldStagePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) {
    return true;
  }

  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return true;
  }

  if (DEFAULT_TOP_LEVEL_STAGE_EXCLUDES.has(segments[0])) {
    return false;
  }

  if (segments[0] === "backend" && segments[1] === "dist") {
    return false;
  }

  return !segments.some((segment) => DEFAULT_ANY_LEVEL_STAGE_EXCLUDES.has(segment));
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

export function buildContainerSubprojectPath(containerPluginPath, relativeSubprojectPath) {
  const pluginPath = String(containerPluginPath ?? "").trim().replace(/\/+$/, "");
  const subprojectPath = normalizeRelativePath(relativeSubprojectPath);

  if (!pluginPath) {
    throw new Error("containerPluginPath is required.");
  }
  if (!subprojectPath) {
    throw new Error("relativeSubprojectPath is required.");
  }

  return `${pluginPath}/${subprojectPath}`;
}

export function buildInstallLocalConsoleRuntimeDepsShellCommand({
  containerPluginPath,
} = {}) {
  const goBackendPath = buildContainerSubprojectPath(containerPluginPath, "server/backend");

  return [
    "set -eu",
    `if find ${shellQuote(goBackendPath)} -maxdepth 1 -type f -name 'lynx-server-*' 2>/dev/null | grep -q .; then echo "lynx-server backend present; skip runtime dependency install"; exit 0; fi`,
    `echo "lynx-server backend missing: ${goBackendPath}/lynx-server-*" >&2`,
    "exit 1",
  ].join(" && ");
}

export function assessGatewayLogs(logText) {
  const text = String(logText ?? "");

  if (text.includes("[lynx-guardian] Plugin loading...")) {
    return {
      status: "ready",
      reason: "Lynx Guardian started from the in-container staged path.",
    };
  }

  if (/blocked plugin candidate: world-writable path .*openclaw-lynx-guardian/i.test(text)) {
    return {
      status: "blocked",
      reason: "OpenClaw still treats the plugin path as world-writable; use the in-container staged copy.",
    };
  }

  return {
    status: "unknown",
    reason: "Recent logs do not contain a clear Lynx Guardian startup marker yet.",
  };
}
