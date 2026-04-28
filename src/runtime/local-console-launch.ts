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

export function buildLynxServerExecutableName(
  platform = process.platform,
  arch = process.arch,
): string {
  return `lynx-server-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function resolveLocalConsoleBackendEntryPath(
  baseUrl = import.meta.url,
  runtime: { platform?: NodeJS.Platform; arch?: NodeJS.Architecture } = {},
): string {
  const executableName = buildLynxServerExecutableName(runtime.platform, runtime.arch);
  const relativeCandidates = [
    `./server/backend/${executableName}`,
    `../server/backend/${executableName}`,
    `../../server/backend/${executableName}`,
    `./backend/dist/${executableName}`,
    `../backend/dist/${executableName}`,
    `../../backend/dist/${executableName}`,
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
  const command = process.platform === "win32" ? entryPath : "sh";
  const args = process.platform === "win32"
    ? []
    : ["-lc", `chmod +x ${shellQuote(entryPath)} 2>/dev/null || true; exec ${shellQuote(entryPath)}`];

  return {
    command,
    args,
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
