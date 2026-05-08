import path from "path";

export const DEFAULT_GATEWAY_CONTAINER = "openclaw-openclaw-gateway-1";
export const DEFAULT_PLUGIN_NAME = "openclaw-lynx-guardian";
export const DEFAULT_CONTAINER_EXTENSIONS_ROOT = "/app/extensions";
export const DEFAULT_CONTAINER_BUNDLED_EXTENSIONS_ROOT = "/app/dist/extensions";
export const DEFAULT_OPENCLAW_RUNTIME_DEPS_ROOT = "/home/node/.openclaw/plugin-runtime-deps";
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
  containerBundledExtensionsRoot = DEFAULT_CONTAINER_BUNDLED_EXTENSIONS_ROOT,
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
    containerBundledExtensionsRoot,
    containerPluginPath: `${containerExtensionsRoot}/${pluginName}`,
    containerBundledPluginPath: `${containerBundledExtensionsRoot}/${pluginName}`,
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

export function buildPruneOpenClawRuntimeDepsLocksShellCommand({
  runtimeDepsRoot = DEFAULT_OPENCLAW_RUNTIME_DEPS_ROOT,
  minAgeSeconds = 120,
} = {}) {
  const resolvedMinAgeSeconds = Math.max(0, Math.floor(Number(minAgeSeconds) || 0));
  const minAgeMs = resolvedMinAgeSeconds * 1000;

  return [
    "set -eu",
    `OPENCLAW_RUNTIME_DEPS_ROOT=${shellQuote(runtimeDepsRoot)} LYNX_RUNTIME_LOCK_MIN_AGE_MS=${shellQuote(String(minAgeMs))} node <<'NODE'`,
    String.raw`const fs = require("fs");
const path = require("path");

const root = process.env.OPENCLAW_RUNTIME_DEPS_ROOT || "/home/node/.openclaw/plugin-runtime-deps";
const minAgeMs = Number(process.env.LYNX_RUNTIME_LOCK_MIN_AGE_MS || "120000");
const lockNames = [".openclaw-runtime-deps.lock", ".openclaw-runtime-mirror.lock"];
const now = Date.now();

function readProcessCommands() {
  try {
    return fs.readdirSync("/proc", { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => {
        const pid = Number(entry.name);
        try {
          const cmd = fs.readFileSync("/proc/" + entry.name + "/cmdline", "utf8")
            .replace(/\0/g, " ")
            .trim();
          return { pid, cmd };
        } catch {
          return { pid, cmd: "" };
        }
      });
  } catch {
    return [];
  }
}

const processCommands = readProcessCommands();

function commandForPid(pid) {
  return processCommands.find((entry) => entry.pid === pid)?.cmd || "";
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hasActiveRuntimeDepsInstaller() {
  return processCommands.some(({ cmd }) => (
    /\b(?:npm|npm-cli\.js)\b/.test(cmd) &&
    /\binstall\b/.test(cmd) &&
    (cmd.includes(root) || cmd.includes("plugin-runtime-deps") || cmd.includes("runtime-deps"))
  ));
}

function readOwner(lockDir) {
  const ownerPath = path.join(lockDir, "owner.json");
  try {
    const ownerStat = fs.lstatSync(ownerPath);
    if (ownerStat.isSymbolicLink()) {
      return { symlink: true, value: null };
    }
    const parsed = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    return { symlink: false, value: parsed && typeof parsed === "object" ? parsed : null };
  } catch {
    return { symlink: false, value: null };
  }
}

function shouldRemoveLock(lockDir) {
  let lockStat;
  try {
    lockStat = fs.lstatSync(lockDir);
  } catch {
    return { remove: false, reason: "missing" };
  }
  if (!lockStat.isDirectory()) {
    return { remove: false, reason: "not-directory" };
  }

  const ageMs = now - lockStat.mtimeMs;
  if (ageMs < minAgeMs) {
    return { remove: false, reason: "young ageMs=" + Math.round(ageMs) };
  }

  const owner = readOwner(lockDir);
  if (owner.symlink) {
    return { remove: false, reason: "owner-symlink" };
  }

  if (hasActiveRuntimeDepsInstaller()) {
    return { remove: false, reason: "active-installer" };
  }

  const pid = typeof owner.value?.pid === "number" ? owner.value.pid : null;
  if (pid === null) {
    return { remove: true, reason: "no-owner ageMs=" + Math.round(ageMs) };
  }

  const alive = isPidAlive(pid);
  const cmd = commandForPid(pid);
  if (!alive) {
    return { remove: true, reason: "dead-owner pid=" + pid + " ageMs=" + Math.round(ageMs) };
  }

  if (/\bopenclaw(?:-gateway)?\b/.test(cmd)) {
    return { remove: true, reason: "gateway-owner pid=" + pid + " ageMs=" + Math.round(ageMs) };
  }

  return { remove: false, reason: "live-owner pid=" + pid };
}

let removed = 0;
let inspected = 0;

if (!fs.existsSync(root)) {
  console.log("[lynx-dev-sync] runtime deps root not found; skip stale lock cleanup: " + root);
  process.exit(0);
}

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  for (const lockName of lockNames) {
    const lockDir = path.join(root, entry.name, lockName);
    if (!fs.existsSync(lockDir)) {
      continue;
    }
    inspected += 1;
    const decision = shouldRemoveLock(lockDir);
    if (!decision.remove) {
      console.log("[lynx-dev-sync] kept runtime deps lock: " + lockDir + " (" + decision.reason + ")");
      continue;
    }
    fs.rmSync(lockDir, { recursive: true, force: true });
    removed += 1;
    console.log("[lynx-dev-sync] removed stale runtime deps lock: " + lockDir + " (" + decision.reason + ")");
  }
}

console.log("[lynx-dev-sync] runtime deps lock cleanup: inspected=" + inspected + " removed=" + removed);
NODE`,
  ].join("\n");
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
