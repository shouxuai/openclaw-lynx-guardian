#!/usr/bin/env node

import { relative, resolve } from "path";
import { spawnSync } from "child_process";

import { packageLocalConsoleServer } from "./package-local-console-server-lib.mjs";

function withWindowsComSpec(env = process.env) {
  if (process.platform !== "win32" || env.ComSpec) {
    return env;
  }
  return {
    ...env,
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
  };
}

function parseArgs(argv) {
  const options = {
    outputDir: "",
    repoRoot: process.cwd(),
    skipBuild: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--repo-root":
        options.repoRoot = resolve(String(argv[index + 1] ?? "").trim() || process.cwd());
        index += 1;
        break;
      case "--output-dir":
        options.outputDir = resolve(String(argv[index + 1] ?? "").trim() || "server");
        index += 1;
        break;
      case "--skip-build":
        options.skipBuild = true;
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
  node scripts/package-local-console-server.mjs [options]

Options:
  --repo-root <path>   Override the repo root
  --output-dir <path>  Override the generated server directory
  --skip-build         Reuse existing backend/frontend build outputs
`);
}

function runBuild(repoRoot) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:lynx-server"], {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: withWindowsComSpec(),
  });

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function logResult(repoRoot, outputDir) {
  const displayOutputDir = relative(repoRoot, outputDir) || ".";
  console.log(`[package-local-console-server] output: ${displayOutputDir}`);
  console.log("[package-local-console-server] includes:");
  console.log("  - backend");
  console.log("  - frontend/dist");
  console.log("  - README.md");
}

try {
  const options = parseArgs(process.argv.slice(2));

  if (!options.skipBuild) {
    runBuild(options.repoRoot);
  }

  const result = packageLocalConsoleServer({
    repoRoot: options.repoRoot,
    outputDir: options.outputDir || undefined,
  });
  logResult(options.repoRoot, result.outputDir);
} catch (error) {
  console.error(
    `[package-local-console-server] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
