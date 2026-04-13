#!/usr/bin/env node

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { setTimeout as delay } from "timers/promises";
import {
  DEFAULT_GATEWAY_CONTAINER,
  pickGatewayContainer,
} from "./dev-sync-lib.mjs";
import {
  buildReadySyncSuccessMessage,
  buildCronStoreContainsJobShellCommand,
  buildCronStoreSyncShellCommand,
  collectGatewayReadyMarkerLines,
  DEFAULT_SCHEDULED_LYNX_CHECK_JOB_ID,
  extractContainerHealthStatus,
  hasGatewayReadyMarkers,
  resolveCronStoreSyncPaths,
} from "./ready-sync-lib.mjs";

const PASSTHROUGH_VALUE_ARGS = new Set([
  "--container",
  "--openclaw-home",
  "--plugin-name",
  "--repo-root",
  "--logs",
]);

function parseArgs(argv) {
  const options = {
    dryRun: false,
    forwardArgs: [],
    healthTimeoutMs: 90_000,
    pollMs: 1_000,
    readyTimeoutMs: 90_000,
    skipRestart: false,
    skipVerify: false,
    containerOverride: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--health-timeout-ms":
        options.healthTimeoutMs = parsePositiveInt(arg, argv[index + 1]);
        index += 1;
        break;
      case "--ready-timeout-ms":
        options.readyTimeoutMs = parsePositiveInt(arg, argv[index + 1]);
        index += 1;
        break;
      case "--poll-ms":
        options.pollMs = parsePositiveInt(arg, argv[index + 1]);
        index += 1;
        break;
      case "--skip-verify":
        options.skipVerify = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        options.forwardArgs.push(arg);
        if (arg === "--dry-run") {
          options.dryRun = true;
        }
        if (arg === "--skip-restart") {
          options.skipRestart = true;
        }
        if (arg === "--container") {
          const value = argv[index + 1] || "";
          options.forwardArgs.push(value);
          options.containerOverride = value;
          index += 1;
          break;
        }
        if (PASSTHROUGH_VALUE_ARGS.has(arg)) {
          const value = argv[index + 1] || "";
          options.forwardArgs.push(value);
          index += 1;
        }
        break;
    }
  }

  if (options.skipRestart && !options.dryRun) {
    throw new Error("--skip-restart is not supported by sync-openclaw-dev-ready; use sync-openclaw-dev.mjs directly.");
  }

  return options;
}

function parsePositiveInt(flag, value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer value.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  node scripts-dev/sync-openclaw-dev-ready.mjs [options]

Wrapper behavior:
  1. Runs verify-dev-sync.mjs
  2. Runs sync-openclaw-dev.mjs
  3. Waits for the gateway container to become healthy
  4. Waits for Lynx Guardian startup markers
  5. Prints a clear SUCCESS callback

Wrapper options:
  --health-timeout-ms <ms>   Timeout for waiting on container health (default: 90000)
  --ready-timeout-ms <ms>    Timeout for waiting on startup markers (default: 90000)
  --poll-ms <ms>             Poll interval for health/log checks (default: 1000)
  --skip-verify              Skip verify-dev-sync.mjs

Forwarded options:
  --container <name>
  --openclaw-home <path>
  --plugin-name <name>
  --repo-root <path>
  --logs <count>
  --dry-run
`);
}

function runCommand(command, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !allowFailure) {
    const stderr = capture ? (result.stderr || "").trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${stderr ? `: ${stderr}` : ""}`);
  }

  return {
    status: result.status ?? 0,
    stdout: capture ? (result.stdout || "") : "",
    stderr: capture ? (result.stderr || "") : "",
  };
}

function listContainerNames() {
  const result = runCommand("docker", ["ps", "--format", "{{.Names}}"], { capture: true, allowFailure: true });
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveContainerName(containerOverride) {
  if (containerOverride) {
    return containerOverride;
  }

  return pickGatewayContainer(listContainerNames()) || DEFAULT_GATEWAY_CONTAINER;
}

function readContainerStartedAt(containerName) {
  const result = runCommand("docker", ["inspect", "-f", "{{.State.StartedAt}}", containerName], { capture: true });
  return result.stdout.trim();
}

function readContainerStateStatus(containerName) {
  const result = runCommand("docker", ["inspect", "-f", "{{.State.Status}}", containerName], { capture: true });
  return result.stdout.trim().toLowerCase();
}

function readContainerHealthStatus(containerName) {
  const result = runCommand("docker", ["inspect", "-f", "{{json .State.Health}}", containerName], { capture: true });
  return extractContainerHealthStatus(result.stdout);
}

function readLogsSince(containerName, startedAt) {
  const result = runCommand("docker", ["logs", "--since", startedAt, containerName], {
    capture: true,
    allowFailure: true,
  });
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

function runContainerShell(containerName, shellCommand, { capture = false, allowFailure = false } = {}) {
  return runCommand("docker", [
    "exec",
    "-u",
    "0:0",
    containerName,
    "sh",
    "-lc",
    shellCommand,
  ], { capture, allowFailure });
}

async function waitForHealth(containerName, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";

  while (Date.now() <= deadline) {
    const healthStatus = readContainerHealthStatus(containerName);
    const lifecycleStatus = readContainerStateStatus(containerName);
    const visibleStatus = healthStatus === "none"
      ? `${lifecycleStatus} (no healthcheck)`
      : `${healthStatus} (${lifecycleStatus})`;

    if (visibleStatus !== lastStatus) {
      console.log(`[lynx-dev-ready] health status: ${visibleStatus}`);
      lastStatus = visibleStatus;
    }

    if (healthStatus === "healthy") {
      return {
        healthStatus,
        lifecycleStatus,
      };
    }

    if (healthStatus === "none" && lifecycleStatus === "running") {
      return {
        healthStatus,
        lifecycleStatus,
      };
    }

    await delay(pollMs);
  }

  throw new Error(`Timed out waiting for ${containerName} health after ${timeoutMs}ms (last=${lastStatus || "unknown"}).`);
}

async function waitForReadyMarkers(containerName, startedAt, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const logText = readLogsSince(containerName, startedAt);
    if (hasGatewayReadyMarkers(logText)) {
      return {
        logText,
        markerLines: collectGatewayReadyMarkerLines(logText),
      };
    }

    await delay(pollMs);
  }

  throw new Error(`Timed out waiting for Lynx Guardian startup markers after ${timeoutMs}ms.`);
}

async function waitForGatewayReady(containerName, healthTimeoutMs, readyTimeoutMs, pollMs) {
  const startedAt = readContainerStartedAt(containerName);
  await waitForHealth(containerName, healthTimeoutMs, pollMs);
  const ready = await waitForReadyMarkers(containerName, startedAt, readyTimeoutMs, pollMs);
  return {
    startedAt,
    ready,
  };
}

function verifyCronStoreContainsJob(containerName, storePath, jobId = DEFAULT_SCHEDULED_LYNX_CHECK_JOB_ID) {
  runContainerShell(
    containerName,
    buildCronStoreContainsJobShellCommand({ storePath, jobId }),
    { capture: false },
  );
}

function syncCronStore(containerName, paths) {
  runContainerShell(
    containerName,
    buildCronStoreSyncShellCommand(paths),
    { capture: false },
  );
}

async function restartGatewayAndWait(containerName, healthTimeoutMs, readyTimeoutMs, pollMs) {
  runCommand("docker", ["restart", containerName], { capture: false });
  return await waitForGatewayReady(containerName, healthTimeoutMs, readyTimeoutMs, pollMs);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const containerName = resolveContainerName(options.containerOverride);
  const verifyScriptPath = fileURLToPath(new URL("./verify-dev-sync.mjs", import.meta.url));
  const syncScriptPath = fileURLToPath(new URL("./sync-openclaw-dev.mjs", import.meta.url));
  const cronStorePaths = resolveCronStoreSyncPaths();

  console.log("[lynx-dev-ready] step 1/6: verify dev sync assertions");
  if (options.skipVerify) {
    console.log("[lynx-dev-ready] verify step skipped by --skip-verify");
  } else {
    runCommand(process.execPath, [verifyScriptPath], { capture: false });
  }

  console.log("[lynx-dev-ready] step 2/6: sync plugin files and restart gateway");
  runCommand(process.execPath, [syncScriptPath, ...options.forwardArgs], { capture: false });

  if (options.dryRun) {
    console.log("[lynx-dev-ready] dry-run finished; readiness wait skipped.");
    return;
  }

  console.log(`[lynx-dev-ready] step 3/6: wait for ${containerName} after the first restart`);
  const initialReady = await waitForGatewayReady(
    containerName,
    options.healthTimeoutMs,
    options.readyTimeoutMs,
    options.pollMs,
  );
  console.log("[lynx-dev-ready] first-start markers:");
  for (const line of initialReady.ready.markerLines) {
    console.log(line);
  }

  console.log(`[lynx-dev-ready] step 4/6: verify legacy cron store contains ${DEFAULT_SCHEDULED_LYNX_CHECK_JOB_ID}`);
  verifyCronStoreContainsJob(containerName, cronStorePaths.sourceStorePath);
  console.log(`[lynx-dev-ready] cron source verified: ${cronStorePaths.sourceStorePath}`);

  console.log(`[lynx-dev-ready] step 5/6: sync cron store -> docker-state`);
  syncCronStore(containerName, cronStorePaths);
  console.log(`[lynx-dev-ready] cron store synced: ${cronStorePaths.sourceStorePath} -> ${cronStorePaths.targetStorePath}`);

  console.log(`[lynx-dev-ready] step 6/6: restart gateway again so cron reloads ${cronStorePaths.targetStorePath}`);
  const finalReady = await restartGatewayAndWait(
    containerName,
    options.healthTimeoutMs,
    options.readyTimeoutMs,
    options.pollMs,
  );
  console.log("[lynx-dev-ready] final-start markers:");
  for (const line of finalReady.ready.markerLines) {
    console.log(line);
  }
  verifyCronStoreContainsJob(containerName, cronStorePaths.targetStorePath);
  console.log(`[lynx-dev-ready] cron target verified: ${cronStorePaths.targetStorePath}`);
  console.log(buildReadySyncSuccessMessage({ containerName, startedAt: finalReady.startedAt }));
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[lynx-dev-ready] failed:", message);
  process.exit(1);
}
