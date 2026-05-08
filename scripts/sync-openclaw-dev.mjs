#!/usr/bin/env node

import { spawnSync } from "child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import { fileURLToPath } from "url";
import {
  DEFAULT_GATEWAY_CONTAINER,
  DEFAULT_PLUGIN_NAME,
  assessGatewayLogs,
  buildContainerSubprojectPath,
  buildDevSyncPlan,
  buildInstallLocalConsoleRuntimeDepsShellCommand,
  buildPruneOpenClawRuntimeDepsLocksShellCommand,
  findStalePluginManagedDirectories,
  pickGatewayContainer,
  resolveOpenClawHome,
  shouldStagePath,
} from "./dev-sync-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const defaultRepoRoot = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const options = {
    containerOverride: "",
    dryRun: false,
    logs: 200,
    openclawHomeOverride: "",
    pluginName: DEFAULT_PLUGIN_NAME,
    repoRoot: defaultRepoRoot,
    skipRestart: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--container":
        options.containerOverride = String(argv[index + 1] ?? "").trim();
        index += 1;
        break;
      case "--openclaw-home":
        options.openclawHomeOverride = String(argv[index + 1] ?? "").trim();
        index += 1;
        break;
      case "--plugin-name":
        options.pluginName = String(argv[index + 1] ?? "").trim() || DEFAULT_PLUGIN_NAME;
        index += 1;
        break;
      case "--repo-root":
        options.repoRoot = path.resolve(String(argv[index + 1] ?? "").trim() || defaultRepoRoot);
        index += 1;
        break;
      case "--logs":
        options.logs = parseCount(arg, argv[index + 1]);
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--skip-restart":
        options.skipRestart = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseCount(flag, value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer value.`);
  }
  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/sync-openclaw-dev.mjs [options]

Options:
  --container <name>        Override the gateway container name
  --openclaw-home <path>    Override the host OpenClaw home directory
  --plugin-name <name>      Override the plugin directory name
  --repo-root <path>        Use a different repo root (for worktrees)
  --logs <count>            Tail this many container log lines after restart (default: 200)
  --dry-run                 Print the sync plan and runtime-deps command without changing files
  --skip-restart            Stage files and install runtime deps but do not restart the gateway
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
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}${stderr ? `: ${stderr}` : ""}`,
    );
  }

  return {
    status: result.status ?? 0,
    stdout: capture ? (result.stdout || "") : "",
    stderr: capture ? (result.stderr || "") : "",
  };
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

function listContainerNames() {
  const result = runCommand("docker", ["ps", "--format", "{{.Names}}"], {
    capture: true,
    allowFailure: true,
  });

  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveContainerName(override) {
  if (override) {
    return override;
  }

  return pickGatewayContainer(listContainerNames()) || DEFAULT_GATEWAY_CONTAINER;
}

function listNamedDirectories(dirPath) {
  if (!existsSync(dirPath)) {
    return [];
  }

  return readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function copyNamedDirectories(sourceRoot, targetRoot, { dryRun = false } = {}) {
  const sourceNames = listNamedDirectories(sourceRoot);
  const targetNames = listNamedDirectories(targetRoot);
  const staleNames = findStalePluginManagedDirectories({
    sourceNames,
    targetNames,
  });

  console.log(`[lynx-dev-sync] source ${sourceRoot}`);
  console.log(`[lynx-dev-sync] target ${targetRoot}`);

  if (sourceNames.length === 0) {
    console.log("[lynx-dev-sync] no managed directories to sync.");
    return;
  }

  if (staleNames.length > 0) {
    console.log(`[lynx-dev-sync] stale managed directories: ${staleNames.join(", ")}`);
  }

  if (dryRun) {
    console.log(`[lynx-dev-sync] dry-run directories: ${sourceNames.join(", ")}`);
    return;
  }

  mkdirSync(targetRoot, { recursive: true });

  for (const staleName of staleNames) {
    rmSync(path.join(targetRoot, staleName), { recursive: true, force: true });
  }

  for (const name of sourceNames) {
    const sourcePath = path.join(sourceRoot, name);
    const targetPath = path.join(targetRoot, name);
    rmSync(targetPath, { recursive: true, force: true });
    cpSync(sourcePath, targetPath, { recursive: true, force: true });
    console.log(`[lynx-dev-sync] synced ${name}`);
  }
}

function stagePlugin(repoRoot, pluginName, { dryRun = false } = {}) {
  const stageRoot = mkdtempSync(path.join(tmpdir(), `${pluginName}-dev-sync-`));
  const stagePluginPath = path.join(stageRoot, pluginName);

  if (dryRun) {
    console.log(`[lynx-dev-sync] dry-run stage path ${stagePluginPath}`);
    return { stageRoot, stagePluginPath };
  }

  cpSync(repoRoot, stagePluginPath, {
    recursive: true,
    force: true,
    filter(sourcePath) {
      const relativePath = path.relative(repoRoot, sourcePath);
      return shouldStagePath(relativePath);
    },
  });

  return { stageRoot, stagePluginPath };
}

function prepareContainerPluginPath(plan) {
  runCommand("docker", [
    "exec",
    "-u",
    "0:0",
    plan.containerName,
    "sh",
    "-lc",
    [
      "set -eu",
      `mkdir -p ${shellQuote(plan.containerExtensionsRoot)}`,
      `rm -rf ${shellQuote(plan.containerPluginPath)}`,
    ].join(" && "),
  ]);
}

function copyPluginIntoContainer(plan, stagePluginPath) {
  runCommand("docker", ["cp", stagePluginPath, `${plan.containerName}:${plan.containerExtensionsRoot}/`]);
  runCommand("docker", [
    "exec",
    "-u",
    "0:0",
    plan.containerName,
    "sh",
    "-lc",
    [
      "set -eu",
      `chown -R node:node ${shellQuote(plan.containerPluginPath)}`,
      `chmod -R u=rwX,go=rX ${shellQuote(plan.containerPluginPath)}`,
    ].join(" && "),
  ]);
}

function containerDirectoryExists(containerName, dirPath) {
  const result = runCommand("docker", [
    "exec",
    "-u",
    "0:0",
    containerName,
    "sh",
    "-lc",
    `test -d ${shellQuote(dirPath)}`,
  ], {
    capture: true,
    allowFailure: true,
  });

  return result.status === 0;
}

function mirrorPluginIntoBundledPath(plan, stagePluginPath, { dryRun = false } = {}) {
  const bundledPath = plan.containerBundledPluginPath;
  const bundledRoot = plan.containerBundledExtensionsRoot;
  if (!bundledPath || !bundledRoot) {
    return;
  }

  if (dryRun) {
    console.log(`[lynx-dev-sync] dry-run bundled mirror path ${bundledPath}`);
    return;
  }

  if (!containerDirectoryExists(plan.containerName, bundledPath)) {
    console.log(`[lynx-dev-sync] bundled plugin path not present; skip mirror ${bundledPath}`);
    return;
  }

  runCommand("docker", [
    "exec",
    "-u",
    "0:0",
    plan.containerName,
    "sh",
    "-lc",
    [
      "set -eu",
      `mkdir -p ${shellQuote(bundledRoot)}`,
      `rm -rf ${shellQuote(bundledPath)}`,
    ].join(" && "),
  ]);
  runCommand("docker", ["cp", stagePluginPath, `${plan.containerName}:${bundledRoot}/`]);
  runCommand("docker", [
    "exec",
    "-u",
    "0:0",
    plan.containerName,
    "sh",
    "-lc",
    [
      "set -eu",
      `chown -R node:node ${shellQuote(bundledPath)}`,
      `chmod -R u=rwX,go=rX ${shellQuote(bundledPath)}`,
    ].join(" && "),
  ]);
  console.log(`[lynx-dev-sync] mirrored plugin into bundled path ${bundledPath}`);
}

function installLocalConsoleRuntimeDeps(plan, { dryRun = false } = {}) {
  const backendContainerPath = buildContainerSubprojectPath(plan.containerPluginPath, "server/backend");
  const shellCommand = buildInstallLocalConsoleRuntimeDepsShellCommand({
    containerPluginPath: plan.containerPluginPath,
  });

  if (dryRun) {
    console.log(
      `[lynx-dev-sync] dry-run runtime deps: docker exec -u node:node ${plan.containerName} sh -lc ${shellQuote(shellCommand)}`,
    );
    return;
  }

  console.log(`[lynx-dev-sync] checking lynx-server backend runtime at ${backendContainerPath}`);
  runCommand("docker", [
    "exec",
    "-u",
    "node:node",
    plan.containerName,
    "sh",
    "-lc",
    shellCommand,
  ]);
}

function pruneOpenClawRuntimeDepsLocks(plan, { dryRun = false } = {}) {
  const shellCommand = buildPruneOpenClawRuntimeDepsLocksShellCommand();

  if (dryRun) {
    console.log(
      `[lynx-dev-sync] dry-run stale runtime lock cleanup: docker exec -u 0:0 ${plan.containerName} sh -lc ${shellQuote(shellCommand)}`,
    );
    return;
  }

  console.log("[lynx-dev-sync] pruning stale OpenClaw runtime-deps locks before restart");
  runCommand("docker", [
    "exec",
    "-u",
    "0:0",
    plan.containerName,
    "sh",
    "-lc",
    shellCommand,
  ]);
}

function restartGateway(containerName) {
  runCommand("docker", ["restart", containerName]);
}

async function printRecentLogs(containerName, count, { sinceEpochSeconds } = {}) {
  if (count <= 0) {
    return;
  }

  const deadline = Date.now() + 30_000;
  let logText = "";
  let lastAssessment = null;
  let blockedAssessment = null;
  let readyAssessment = null;

  while (Date.now() <= deadline) {
    const logArgs = ["logs"];
    if (sinceEpochSeconds !== undefined) {
      logArgs.push("--since", String(sinceEpochSeconds));
    }
    logArgs.push("--tail", String(count), containerName);

    const result = runCommand("docker", logArgs, {
      capture: true,
      allowFailure: true,
    });
    logText = [result.stdout, result.stderr].filter(Boolean).join("\n");
    lastAssessment = assessGatewayLogs(logText);
    if (lastAssessment.status === "ready") {
      readyAssessment = lastAssessment;
      break;
    }
    if (lastAssessment.status === "blocked") {
      blockedAssessment = lastAssessment;
    }
    await delay(1_000);
  }

  if (logText.trim().length > 0) {
    process.stdout.write(logText.endsWith("\n") ? logText : `${logText}\n`);
  }

  const finalAssessment = readyAssessment ?? blockedAssessment ?? lastAssessment ?? assessGatewayLogs(logText);
  console.log(`[lynx-dev-sync] gateway log assessment: ${finalAssessment.status} - ${finalAssessment.reason}`);
  if (finalAssessment.status === "blocked") {
    throw new Error(finalAssessment.reason);
  }
}

function logPlan(plan, options) {
  console.log("[lynx-dev-sync] plan");
  console.log(`  repoRoot: ${plan.repoRoot}`);
  console.log(`  openclawHome: ${plan.openclawHome}`);
  console.log(`  containerName: ${plan.containerName}`);
  console.log(`  hostHooksPath: ${plan.hostHooksPath}`);
  console.log(`  hostSkillsPath: ${plan.hostSkillsPath}`);
  console.log(`  containerPluginPath: ${plan.containerPluginPath}`);
  console.log(`  containerBundledPluginPath: ${plan.containerBundledPluginPath}`);
  console.log(`  localConsoleBackendPath: ${buildContainerSubprojectPath(plan.containerPluginPath, "server/backend")}`);
  console.log(`  dryRun: ${options.dryRun}`);
  console.log(`  skipRestart: ${options.skipRestart}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const openclawHome = resolveOpenClawHome({ override: options.openclawHomeOverride });
  const containerName = resolveContainerName(options.containerOverride);
  const plan = buildDevSyncPlan({
    repoRoot: options.repoRoot,
    pluginName: options.pluginName,
    openclawHome,
    containerName,
  });

  logPlan(plan, options);

  copyNamedDirectories(path.join(plan.repoRoot, "hooks"), plan.hostHooksPath, { dryRun: options.dryRun });
  copyNamedDirectories(path.join(plan.repoRoot, "skills"), plan.hostSkillsPath, { dryRun: options.dryRun });

  const { stageRoot, stagePluginPath } = stagePlugin(plan.repoRoot, plan.pluginName, {
    dryRun: options.dryRun,
  });

  try {
    if (options.dryRun) {
      installLocalConsoleRuntimeDeps(plan, { dryRun: true });
      mirrorPluginIntoBundledPath(plan, stagePluginPath, { dryRun: true });
      pruneOpenClawRuntimeDepsLocks(plan, { dryRun: true });
      console.log("[lynx-dev-sync] dry-run finished");
      return;
    }

    prepareContainerPluginPath(plan);
    copyPluginIntoContainer(plan, stagePluginPath);
    mirrorPluginIntoBundledPath(plan, stagePluginPath);
    installLocalConsoleRuntimeDeps(plan);
    pruneOpenClawRuntimeDepsLocks(plan);

    if (options.skipRestart) {
      console.log("[lynx-dev-sync] sync finished without restart (--skip-restart)");
      return;
    }

    const restartSinceEpochSeconds = Math.floor(Date.now() / 1000) - 2;
    restartGateway(plan.containerName);
    await printRecentLogs(plan.containerName, options.logs, { sinceEpochSeconds: restartSinceEpochSeconds });
    console.log("[lynx-dev-sync] sync finished");
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[lynx-dev-sync] failed:", message);
  process.exit(1);
}
