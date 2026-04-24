import { type ChildProcess } from "child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";

import type { Logger } from "../types.js";
import { ensureLocalConsoleToken } from "./local-console-auth.js";
import type { LocalConsoleRuntimeConfig } from "./local-console-config.js";
import {
  buildLocalConsoleLaunchPlan,
  launchLocalConsoleBackend,
  type LocalConsoleLaunchPlan,
} from "./local-console-launch.js";
import {
  applyLocalConsoleRuntimePort,
  buildLocalConsoleHealthUrl,
  findAvailableLocalConsolePort,
} from "./local-console-port.js";
import {
  ensureLocalConsoleBackendRuntimeDeps,
  resolveLocalConsoleBackendRoot,
} from "./local-console-runtime-deps.js";

export interface LocalConsoleSupervisor {
  ensureRunning(reason: string): Promise<boolean>;
  probeHealth(): Promise<boolean>;
}

interface LocalConsoleSupervisorOptions {
  config: LocalConsoleRuntimeConfig;
  logger: Pick<Logger, "info" | "warn" | "error">;
  fetchImpl?: typeof fetch;
  ensureRuntimeDeps?: (plan: LocalConsoleLaunchPlan) => void | Promise<void>;
  launchPlanFactory?: (config: LocalConsoleRuntimeConfig) => LocalConsoleLaunchPlan;
  launcher?: (plan: LocalConsoleLaunchPlan, config: LocalConsoleRuntimeConfig) => ChildProcess;
  selectPort?: (config: LocalConsoleRuntimeConfig) => Promise<number | null>;
}

function readPidFile(pidPath: string): number | null {
  if (!existsSync(pidPath)) {
    return null;
  }

  const raw = readFileSync(pidPath, "utf8").trim();
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writePidFile(pidPath: string, pid: number): void {
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, `${pid}\n`, "utf8");
}

function removePidFile(pidPath: string): void {
  rmSync(pidPath, { force: true });
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

export function createLocalConsoleSupervisor(options: LocalConsoleSupervisorOptions): LocalConsoleSupervisor {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("Local console supervisor requires fetch.");
  }

  const launchPlanFactory = options.launchPlanFactory ?? buildLocalConsoleLaunchPlan;
  const ensureRuntimeDeps = options.ensureRuntimeDeps ?? (async (plan: LocalConsoleLaunchPlan) => {
    await ensureLocalConsoleBackendRuntimeDeps({
      backendRoot: resolveLocalConsoleBackendRoot(plan.entryPath),
      logger: options.logger,
    });
  });
  const launcher = options.launcher ?? launchLocalConsoleBackend;
  const selectPort = options.selectPort ?? (async (config) => await findAvailableLocalConsolePort({
    listenHost: config.listenHost,
    candidatePorts: config.candidatePorts,
  }));
  let activeChild: ChildProcess | null = null;
  let startPromise: Promise<boolean> | null = null;

  async function probeHealthAtUrl(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), options.config.requestTimeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          signal: controller.signal,
        });
        return response.ok;
      } finally {
        clearTimeout(timeoutHandle);
      }
    } catch {
      return false;
    }
  }

  async function probeHealth(): Promise<boolean> {
    return await probeHealthAtUrl(options.config.healthUrl);
  }

  async function waitForHealthy(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await probeHealth()) {
        return true;
      }
      await sleep(250);
    }
    return false;
  }

  function rememberChild(child: ChildProcess): void {
    activeChild = child;
    if (typeof child.pid === "number") {
      writePidFile(options.config.paths.pidPath, child.pid);
    }

    child.once("exit", () => {
      if (activeChild === child) {
        activeChild = null;
      }

      const recordedPid = readPidFile(options.config.paths.pidPath);
      if (typeof child.pid === "number" && recordedPid === child.pid) {
        removePidFile(options.config.paths.pidPath);
      }
    });
  }

  async function ensureRunning(reason: string): Promise<boolean> {
    if (!options.config.enabled) {
      return false;
    }

    if (await probeHealth()) {
      return true;
    }

    if (startPromise) {
      return startPromise;
    }

    startPromise = (async () => {
      const recordedPid = readPidFile(options.config.paths.pidPath);
      if (recordedPid && processExists(recordedPid)) {
        options.logger.info(
          `[lynx-guardian] local console waiting for existing backend pid=${recordedPid} (${reason})`,
        );
        if (await waitForHealthy(options.config.requestTimeoutMs * 4)) {
          return true;
        }
      } else if (recordedPid) {
        removePidFile(options.config.paths.pidPath);
      }

      ensureLocalConsoleToken(options.config.paths.tokenPath);
      mkdirSync(dirname(options.config.paths.logPath), { recursive: true });

      const selectedPort = await selectPort(options.config);
      if (selectedPort === null) {
        options.logger.error(
          `[lynx-guardian] no available local console port found in ${options.config.candidatePorts.join(", ")}`,
        );
        return false;
      }

      if (selectedPort !== options.config.port) {
        options.logger.warn(
          `[lynx-guardian] local console preferred port ${options.config.preferredPort} unavailable; using ${selectedPort}`,
        );
      }

      applyLocalConsoleRuntimePort(options.config, selectedPort);

      const launchPlan = launchPlanFactory(options.config);
      try {
        await ensureRuntimeDeps(launchPlan);
      } catch (error) {
        options.logger.error(
          `[lynx-guardian] failed to prepare local console backend runtime dependencies: ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
      options.logger.info(
        `[lynx-guardian] starting local console backend (${reason}) entry=${launchPlan.entryPath} port=${selectedPort}`,
      );
      const child = launcher(launchPlan, options.config);
      rememberChild(child);

      const healthy = await waitForHealthy(options.config.requestTimeoutMs * 4);
      if (!healthy) {
        const childStillRunning = typeof child.pid === "number" ? processExists(child.pid) : false;
        if (!childStillRunning) {
          options.logger.warn(
            `[lynx-guardian] local console backend failed to start on port ${selectedPort}; process exited before health check`,
          );
          return false;
        }
        options.logger.warn(
          `[lynx-guardian] local console backend did not become healthy before timeout on port ${selectedPort}`,
        );
      }
      return healthy;
    })().finally(() => {
      startPromise = null;
    });

    return startPromise;
  }

  return {
    ensureRunning,
    probeHealth,
  };
}
