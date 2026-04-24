import { spawn, type ChildProcess } from "child_process";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";

import type { LocalConsoleRuntimeConfig } from "./local-console-config.js";

export interface LocalConsoleLaunchPlan {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  entryPath: string;
}

export function resolveLocalConsoleBackendEntryPath(baseUrl = import.meta.url): string {
  const relativeCandidates = [
    "./server/backend/dist/main.js",
    "../server/backend/dist/main.js",
    "../../server/backend/dist/main.js",
    "./backend/dist/main.js",
    "../backend/dist/main.js",
    "../../backend/dist/main.js",
  ];

  const candidates = relativeCandidates.map((relativePath) => fileURLToPath(new URL(relativePath, baseUrl)));
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function buildLocalConsoleLaunchPlan(config: LocalConsoleRuntimeConfig): LocalConsoleLaunchPlan {
  const entryPath = resolveLocalConsoleBackendEntryPath();
  if (!existsSync(entryPath)) {
    throw new Error(`Local console backend entry is missing: ${entryPath}`);
  }

  const cwd = dirname(entryPath);
  return {
    command: process.execPath,
    args: [entryPath],
    cwd,
    entryPath,
    env: {
      ...process.env,
      LYNX_LOCAL_CONSOLE_HOST: config.host,
      LYNX_LOCAL_CONSOLE_LISTEN_HOST: config.listenHost,
      LYNX_LOCAL_CONSOLE_PORT: String(config.port),
      LYNX_LOCAL_CONSOLE_DATA_DIR: config.paths.dataDir,
      LYNX_LOCAL_CONSOLE_DB_PATH: config.paths.databasePath,
      LYNX_LOCAL_CONSOLE_TOKEN_PATH: config.paths.tokenPath,
    },
  };
}

export function launchLocalConsoleBackend(
  plan: LocalConsoleLaunchPlan,
  config: LocalConsoleRuntimeConfig,
): ChildProcess {
  mkdirSync(dirname(config.paths.logPath), { recursive: true });

  const stdoutStream = createWriteStream(config.paths.logPath, { flags: "a" });
  const stderrStream = createWriteStream(config.paths.logPath, { flags: "a" });
  const child = spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: plan.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.pipe(stdoutStream);
  child.stderr?.pipe(stderrStream);
  child.once("close", () => {
    stdoutStream.end();
    stderrStream.end();
  });

  return child;
}
