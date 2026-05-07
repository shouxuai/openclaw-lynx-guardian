import { DEFAULT_GATEWAY_CONTAINER } from "./dev-sync-lib.mjs";

export const DEFAULT_SCHEDULED_LYNX_CHECK_JOB_ID = "lynx-guardian-scheduled-lynx-check";
export const DEFAULT_LEGACY_CRON_STORE_ROOT = "/home/node/.openclaw";
export const DEFAULT_DOCKER_STATE_ROOT = "/home/node/.openclaw/docker-state";

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

export function extractContainerHealthStatus(healthText) {
  const text = String(healthText ?? "").trim();
  if (!text) {
    return "unknown";
  }

  if (text === "null") {
    return "none";
  }

  try {
    const parsed = JSON.parse(text);
    const status = typeof parsed?.Status === "string" ? parsed.Status.trim().toLowerCase() : "";
    return status || "unknown";
  } catch {
    return "unknown";
  }
}

const LYNX_PLUGIN_LOADING_PATTERN = /\[lynx-guardian\] Plugin loading\.\.\./;
const GATEWAY_READY_PATTERNS = [
  /listening on ws:\/\/\S+/i,
  /\[lynx-guardian\] Local console gateway routes registered at \/webview and \/lynx/,
  /\[lynx-guardian\] starting local console backend .*openclaw-lynx-guardian\/server\/backend\/lynx-server-/,
];

export function hasGatewayReadyMarkers(logText) {
  const text = String(logText ?? "");
  return LYNX_PLUGIN_LOADING_PATTERN.test(text)
    && GATEWAY_READY_PATTERNS.some((pattern) => pattern.test(text));
}

export function collectGatewayReadyMarkerLines(logText) {
  const text = String(logText ?? "");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => LYNX_PLUGIN_LOADING_PATTERN.test(line)
      || GATEWAY_READY_PATTERNS.some((pattern) => pattern.test(line)));
}

export function chooseReadyLogText(sinceLogText, tailLogText) {
  const primary = String(sinceLogText ?? "");
  if (hasGatewayReadyMarkers(primary)) {
    return primary;
  }

  return String(tailLogText ?? "");
}

export function buildReadySyncSuccessMessage({ containerName, startedAt }) {
  const resolvedContainer = String(containerName ?? "").trim() || DEFAULT_GATEWAY_CONTAINER;
  const resolvedStartedAt = String(startedAt ?? "").trim() || "unknown-start-time";
  return `[lynx-dev-ready] SUCCESS: ${resolvedContainer} restarted and ready at ${resolvedStartedAt}`;
}

export function buildPackageLocalConsoleServerArgs({
  packageScriptPath,
  repoRoot,
} = {}) {
  if (!packageScriptPath) {
    throw new Error("packageScriptPath is required.");
  }
  if (!repoRoot) {
    throw new Error("repoRoot is required.");
  }

  return [
    packageScriptPath,
    "--repo-root",
    repoRoot,
  ];
}

export function resolveCronStoreSyncPaths({
  legacyStateRoot = DEFAULT_LEGACY_CRON_STORE_ROOT,
  runtimeStateRoot = DEFAULT_DOCKER_STATE_ROOT,
  storeFileName = "jobs.json",
} = {}) {
  const sourceStoreDir = `${legacyStateRoot}/cron`;
  const targetStoreDir = `${runtimeStateRoot}/cron`;
  return {
    sourceStoreDir,
    sourceStorePath: `${sourceStoreDir}/${storeFileName}`,
    targetStoreDir,
    targetStorePath: `${targetStoreDir}/${storeFileName}`,
  };
}

export function buildCronStoreContainsJobShellCommand({
  storePath,
  jobId = DEFAULT_SCHEDULED_LYNX_CHECK_JOB_ID,
} = {}) {
  if (!storePath) {
    throw new Error("storePath is required.");
  }

  return [
    "set -eu",
    `test -f ${shellQuote(storePath)}`,
    `grep -F ${shellQuote(jobId)} ${shellQuote(storePath)} >/dev/null`,
  ].join(" && ");
}

export function buildCronStoreSyncShellCommand({
  sourceStorePath,
  targetStoreDir,
  targetStorePath,
} = {}) {
  if (!sourceStorePath) {
    throw new Error("sourceStorePath is required.");
  }
  if (!targetStoreDir) {
    throw new Error("targetStoreDir is required.");
  }
  if (!targetStorePath) {
    throw new Error("targetStorePath is required.");
  }

  return [
    "set -eu",
    `if [ ! -f ${shellQuote(sourceStorePath)} ]; then echo "missing source cron store: ${sourceStorePath}" >&2; exit 1; fi`,
    `mkdir -p ${shellQuote(targetStoreDir)}`,
    `cp ${shellQuote(sourceStorePath)} ${shellQuote(targetStorePath)}`,
    `chown node:node ${shellQuote(targetStorePath)}`,
    `chmod 600 ${shellQuote(targetStorePath)}`,
  ].join(" && ");
}
