import { isAbsolute, join, resolve, sep } from "path";

import type { PluginConfig } from "../types.js";
import {
  buildLocalConsoleBaseUrl,
  buildLocalConsoleHealthUrl,
  buildLocalConsoleIngestUrl,
  buildLocalConsolePortCandidates,
  DEFAULT_LOCAL_CONSOLE_PORT,
  resolveLocalConsoleListenHost,
} from "./local-console-port.js";
import { resolveRuntimeHomeDir } from "./plugin-runtime-helpers.js";

export interface LocalConsoleRuntimePaths {
  dataDir: string;
  databasePath: string;
  tokenPath: string;
  pidPath: string;
  logPath: string;
}

export interface LocalConsoleRuntimeConfig {
  enabled: boolean;
  autoStart: boolean;
  host: string;
  listenHost: string;
  port: number;
  preferredPort: number;
  candidatePorts: number[];
  requestTimeoutMs: number;
  flushIntervalMs: number;
  maxBatchItems: number;
  maxQueueItems: number;
  baseUrl: string;
  healthUrl: string;
  ingestUrl: string;
  paths: LocalConsoleRuntimePaths;
}

type LocalConsoleConfigInput = PluginConfig | PluginConfig["localConsole"] | undefined;

function normalizeString(value: unknown, fallback: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

function normalizeInteger(value: unknown, fallback: number, minimum: number): number {
  const candidate = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(candidate)) {
    return fallback;
  }
  return Math.max(minimum, Math.trunc(candidate));
}

function expandHomePlaceholder(value: string, homeDir: string): string {
  return value.replace(/%USERPROFILE%/gi, homeDir);
}

function normalizePathSeparators(value: string): string {
  return value.replace(/[\\/]+/g, sep);
}

function extractLocalConsoleConfig(input: LocalConsoleConfigInput): PluginConfig["localConsole"] {
  if (!input || typeof input !== "object") {
    return undefined;
  }

  if ("localConsole" in input) {
    return input.localConsole;
  }

  return input;
}

export function resolveLocalConsoleRuntimeConfig(
  input: LocalConsoleConfigInput,
  options: { homeDir?: string } = {},
): LocalConsoleRuntimeConfig {
  const localConsoleConfig = extractLocalConsoleConfig(input);
  const homeDir = options.homeDir ?? resolveRuntimeHomeDir();
  const rawDataDir = normalizeString(localConsoleConfig?.dataDir, "%USERPROFILE%\\.openclaw\\lynx\\data");
  const expandedDataDir = normalizePathSeparators(expandHomePlaceholder(rawDataDir, homeDir));
  const dataDir = isAbsolute(expandedDataDir)
    ? resolve(expandedDataDir)
    : resolve(homeDir, expandedDataDir);
  const host = normalizeString(localConsoleConfig?.host, "127.0.0.1");
  const preferredPort = normalizeInteger(localConsoleConfig?.port, DEFAULT_LOCAL_CONSOLE_PORT, 1);

  return {
    enabled: localConsoleConfig?.enabled !== false,
    autoStart: localConsoleConfig?.autoStart !== false,
    host,
    listenHost: resolveLocalConsoleListenHost(host),
    port: preferredPort,
    preferredPort,
    candidatePorts: buildLocalConsolePortCandidates(preferredPort),
    requestTimeoutMs: normalizeInteger(localConsoleConfig?.requestTimeoutMs, 1500, 100),
    flushIntervalMs: normalizeInteger(localConsoleConfig?.flushIntervalMs, 1000, 100),
    maxBatchItems: normalizeInteger(localConsoleConfig?.maxBatchItems, 50, 1),
    maxQueueItems: normalizeInteger(localConsoleConfig?.maxQueueItems, 500, 1),
    baseUrl: buildLocalConsoleBaseUrl(host, preferredPort),
    healthUrl: buildLocalConsoleHealthUrl(host, preferredPort),
    ingestUrl: buildLocalConsoleIngestUrl(host, preferredPort),
    paths: {
      dataDir,
      databasePath: join(dataDir, "lynx.db"),
      tokenPath: join(dataDir, "console.token"),
      pidPath: join(dataDir, "console.pid"),
      logPath: join(dataDir, "console.log"),
    },
  };
}
