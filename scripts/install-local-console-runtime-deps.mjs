#!/usr/bin/env node

import { spawnSync } from "child_process";
import {
  DEFAULT_CONTAINER_EXTENSIONS_ROOT,
  DEFAULT_GATEWAY_CONTAINER,
  DEFAULT_PLUGIN_NAME,
  buildInstallLocalConsoleRuntimeDepsShellCommand,
  pickGatewayContainer,
} from "./dev-sync-lib.mjs";

function parseArgs(argv) {
  const options = {
    containerOverride: "",
    containerExtensionsRoot: DEFAULT_CONTAINER_EXTENSIONS_ROOT,
    dryRun: false,
    pluginName: DEFAULT_PLUGIN_NAME,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--container":
        options.containerOverride = String(argv[index + 1] ?? "").trim();
        index += 1;
        break;
      case "--container-extensions-root":
        options.containerExtensionsRoot = String(argv[index + 1] ?? "").trim() || DEFAULT_CONTAINER_EXTENSIONS_ROOT;
        index += 1;
        break;
      case "--plugin-name":
        options.pluginName = String(argv[index + 1] ?? "").trim() || DEFAULT_PLUGIN_NAME;
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
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

function printHelp() {
  console.log(`
Usage:
  node scripts/install-local-console-runtime-deps.mjs [options]

Options:
  --container <name>                  Override the gateway container name
  --container-extensions-root <path>  Override the container extensions root
  --plugin-name <name>                Override the plugin directory name
  --dry-run                           Print the docker exec command without running it
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

function resolveContainerPluginPath(containerExtensionsRoot, pluginName) {
  const root = String(containerExtensionsRoot ?? "").trim().replace(/\/+$/, "");
  const name = String(pluginName ?? "").trim().replace(/^\/+/, "");

  if (!root) {
    throw new Error("containerExtensionsRoot is required.");
  }
  if (!name) {
    throw new Error("pluginName is required.");
  }

  return `${root}/${name}`;
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const containerName = resolveContainerName(options.containerOverride);
  const containerPluginPath = resolveContainerPluginPath(options.containerExtensionsRoot, options.pluginName);
  const shellCommand = buildInstallLocalConsoleRuntimeDepsShellCommand({
    containerPluginPath,
  });

  console.log(`[lynx-runtime-deps] container: ${containerName}`);
  console.log(`[lynx-runtime-deps] plugin path: ${containerPluginPath}`);

  if (options.dryRun) {
    console.log(`[lynx-runtime-deps] dry-run command: docker exec -u node:node ${containerName} sh -lc ${shellQuote(shellCommand)}`);
    return;
  }

  runCommand("docker", [
    "exec",
    "-u",
    "node:node",
    containerName,
    "sh",
    "-lc",
    shellCommand,
  ]);
  console.log("[lynx-runtime-deps] install finished");
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[lynx-runtime-deps] failed:", message);
  process.exit(1);
}
