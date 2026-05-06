import { randomBytes } from "crypto";
import { spawn, type ChildProcess } from "child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";
import { createServer } from "net";
import { basename, dirname, isAbsolute, join, resolve, sep } from "path";
import { fileURLToPath } from "url";

import { LOCAL_CONSOLE_API_BASE_PATH } from "../../shared/src/enums.js";
import type {
  AuditEventItem,
  IngestItemV1,
  QaRecordUpsertItem,
  SessionUpsertItem,
  TokenUsageItem,
  ToolCallUpsertItem,
} from "../../shared/src/ingest.js";
import type { LynxCheckRunIntent, LynxCheckRunResult } from "../lynx-check/lynx-check-bridge.js";
import type { Logger, PluginConfig } from "../types.js";
import { resolveRuntimeHomeDir } from "../runtime/plugin-runtime-helpers.js";
import type { LocalConsoleIngestClient } from "./ingest-client.js";
import {
  createLocalConsoleEventBuilder,
  type AgentEndInput,
  type BeforeAgentStartInput,
  type BeforeDispatchInput,
  type BeforeToolCallInput,
  type GatewayStartInput,
  type LocalConsoleEventBuilder,
  type LynxCheckSnapshotInput,
  type MessageReceivedInput,
  type MessageSendingInput,
  type MessageWriteInput,
  type SessionLifecycleInput,
  type ToolResultPersistInput,
  type AfterToolCallInput,
} from "./event-builder.js";

export const DEFAULT_LOCAL_CONSOLE_PORT = 31789;
export const DEFAULT_LOCAL_CONSOLE_PORT_CANDIDATE_COUNT = 21;

export interface LocalConsolePortConfigShape {
  host: string;
  port: number;
  preferredPort?: number;
  candidatePorts?: number[];
  baseUrl: string;
  healthUrl: string;
  ingestUrl: string;
}

export interface LocalConsolePortSelectionOptions {
  listenHost: string;
  candidatePorts: number[];
}

export function buildLocalConsoleBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

export function resolveLocalConsoleListenHost(host: string): string {
  const normalizedHost = host.trim().toLowerCase();
  if (
    normalizedHost === "127.0.0.1"
    || normalizedHost === "localhost"
    || normalizedHost === "::1"
    || normalizedHost === "::ffff:127.0.0.1"
  ) {
    return "0.0.0.0";
  }

  return host;
}

export function buildLocalConsoleHealthUrl(host: string, port: number): string {
  return `${buildLocalConsoleBaseUrl(host, port)}${LOCAL_CONSOLE_API_BASE_PATH}/health`;
}

export function buildLocalConsoleIngestUrl(host: string, port: number): string {
  return `${buildLocalConsoleBaseUrl(host, port)}${LOCAL_CONSOLE_API_BASE_PATH}/internal/v1/ingest/batch`;
}

export function buildLocalConsolePortCandidates(
  preferredPort: number,
  candidateCount = DEFAULT_LOCAL_CONSOLE_PORT_CANDIDATE_COUNT,
): number[] {
  const normalizedPreferredPort = Math.max(1, Math.trunc(preferredPort));
  const normalizedCandidateCount = Math.max(1, Math.trunc(candidateCount));
  return Array.from({ length: normalizedCandidateCount }, (_value, index) => normalizedPreferredPort + index);
}

export function applyLocalConsoleRuntimePort(
  config: LocalConsolePortConfigShape,
  port: number,
): void {
  config.port = port;
  config.baseUrl = buildLocalConsoleBaseUrl(config.host, port);
  config.healthUrl = buildLocalConsoleHealthUrl(config.host, port);
  config.ingestUrl = buildLocalConsoleIngestUrl(config.host, port);
}

export async function isLocalConsolePortAvailable(host: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();
    server.unref();

    server.once("error", () => {
      resolve(false);
    });

    server.listen({
      host,
      port,
      exclusive: true,
    }, () => {
      server.close((error) => {
        resolve(!error);
      });
    });
  });
}

export async function findAvailableLocalConsolePort(
  options: LocalConsolePortSelectionOptions,
): Promise<number | null> {
  for (const candidatePort of options.candidatePorts) {
    if (await isLocalConsolePortAvailable(options.listenHost, candidatePort)) {
      return candidatePort;
    }
  }

  return null;
}

// ---- runtime.ts ----
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

function readTrimmedFile(filePath: string): string {
  if (!existsSync(filePath)) {
    return "";
  }

  return readFileSync(filePath, "utf8").trim();
}

export function readLocalConsoleToken(tokenPath: string): string {
  return readTrimmedFile(tokenPath);
}

export function ensureLocalConsoleToken(tokenPath: string): string {
  const existingToken = readLocalConsoleToken(tokenPath);
  if (existingToken) {
    return existingToken;
  }

  mkdirSync(dirname(tokenPath), { recursive: true });
  const nextToken = randomBytes(24).toString("hex");
  writeFileSync(tokenPath, `${nextToken}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return nextToken;
}

export function createLocalConsoleTokenProvider(tokenPath: string): () => string {
  return () => readLocalConsoleToken(tokenPath);
}

function hasGoBackendExecutable(backendRoot: string): boolean {
  try {
    return readdirSync(backendRoot).some((entry) => /^lynx-server-(linux|win32|darwin)-/.test(entry));
  } catch {
    return false;
  }
}

function defaultInstallRunner(backendRoot: string): void {
  throw new Error(`lynx-server backend executable is missing in ${backendRoot}`);
}

export function resolveLocalConsoleBackendRoot(entryPath: string): string {
  if (/^lynx-server-(linux|win32|darwin)-/.test(basename(entryPath))) {
    return resolve(dirname(entryPath));
  }
  return resolve(dirname(entryPath));
}

export function hasLocalConsoleBackendRuntimeDeps(backendRoot: string): boolean {
  return hasGoBackendExecutable(backendRoot);
}

export async function ensureLocalConsoleBackendRuntimeDeps(options: {
  backendRoot: string;
  installRunner?: (backendRoot: string) => void | Promise<void>;
  logger: Pick<Logger, "info">;
}): Promise<void> {
  if (hasLocalConsoleBackendRuntimeDeps(options.backendRoot)) {
    return;
  }

  options.logger.info(
    `[lynx-guardian] checking lynx-server backend runtime in ${options.backendRoot}`,
  );

  const installRunner = options.installRunner ?? defaultInstallRunner;
  await installRunner(options.backendRoot);
}

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

const LOOPBACK_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const PASSTHROUGH_REQUEST_HEADERS = new Set([
  "accept",
  "accept-encoding",
  "accept-language",
  "cache-control",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "if-unmodified-since",
  "pragma",
  "user-agent",
]);

export type LocalConsoleGatewayRouteKind = "webview" | "query-api";

export interface LocalConsoleGatewayProxyOptions {
  config: Pick<LocalConsoleRuntimeConfig, "baseUrl" | "requestTimeoutMs">;
  supervisor: Pick<LocalConsoleSupervisor, "ensureRunning">;
  logger: Pick<Logger, "warn" | "error">;
  fetchImpl?: typeof fetch;
  trustedProxyIps?: string[];
  routeTablePath?: string;
}

export interface LocalConsoleGatewayRouteRegistration {
  path: string;
  auth: "plugin";
  match: "prefix";
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}

function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  return trimmed.startsWith("::ffff:") ? trimmed.slice("::ffff:".length) : trimmed;
}

function addTrustedAddress(addresses: Set<string>, candidate: string): void {
  const normalized = normalizeAddress(candidate);
  if (!normalized) {
    return;
  }

  addresses.add(normalized);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized)) {
    addresses.add(`::ffff:${normalized}`);
  }
}

function parseLinuxRouteGateway(gatewayHex: string): string | null {
  if (!/^[0-9a-fA-F]{8}$/.test(gatewayHex)) {
    return null;
  }

  const octets = gatewayHex.match(/../g);
  if (!octets || octets.length !== 4) {
    return null;
  }

  return octets
    .reverse()
    .map((octet) => Number.parseInt(octet, 16))
    .join(".");
}

export function parseLinuxDefaultGatewayAddresses(routeTable: string): string[] {
  const addresses = new Set<string>();

  for (const line of routeTable.split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 3) {
      continue;
    }

    const destination = columns[1];
    const gateway = columns[2];
    if (destination !== "00000000" || gateway === "00000000") {
      continue;
    }

    const parsedGateway = parseLinuxRouteGateway(gateway);
    if (parsedGateway) {
      addresses.add(parsedGateway);
    }
  }

  return [...addresses];
}

function resolveTrustedProxyIps(routeTablePath = "/proc/net/route"): string[] {
  if (!existsSync(routeTablePath)) {
    return [];
  }

  try {
    return parseLinuxDefaultGatewayAddresses(readFileSync(routeTablePath, "utf8"));
  } catch {
    return [];
  }
}

function buildTrustedAddressSet(trustedProxyIps: string[]): Set<string> {
  const addresses = new Set<string>(LOOPBACK_ADDRESSES);
  for (const proxyIp of trustedProxyIps) {
    addTrustedAddress(addresses, proxyIp);
  }
  return addresses;
}

function isTrustedRemoteAddress(remoteAddress: string | undefined, trustedAddresses: Set<string>): boolean {
  if (!remoteAddress) {
    return false;
  }

  return trustedAddresses.has(remoteAddress) || trustedAddresses.has(normalizeAddress(remoteAddress));
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }

  return pathname;
}

export function resolveLocalConsoleGatewayRouteKind(pathname: string): LocalConsoleGatewayRouteKind | null {
  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath === "/webview" || normalizedPath.startsWith("/webview/")) {
    return "webview";
  }

  if (normalizedPath === "/lynx" || normalizedPath.startsWith("/lynx/")) {
    if (normalizedPath === "/lynx/internal" || normalizedPath.startsWith("/lynx/internal/")) {
      return null;
    }
    return "query-api";
  }

  return null;
}

function buildForwardHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const forwarded: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (!PASSTHROUGH_REQUEST_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      forwarded[name] = value.join(", ");
      continue;
    }
    if (typeof value === "string") {
      forwarded[name] = value;
    }
  }

  return forwarded;
}

function applyResponseHeaders(res: ServerResponse, headers: Headers): void {
  headers.forEach((value, name) => {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      return;
    }
    res.setHeader(name, value);
  });
}

function sendTextResponse(
  res: ServerResponse,
  statusCode: number,
  message: string,
): true {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(message);
  return true;
}

function isGatewayProxyMethodAllowed(routeKind: LocalConsoleGatewayRouteKind, method: string): boolean {
  if (method === "GET" || method === "HEAD") {
    return true;
  }
  return routeKind === "query-api" && method === "POST";
}

function shouldForwardRequestBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

async function readRequestBody(req: IncomingMessage): Promise<ArrayBuffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const body = Buffer.concat(chunks);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

export function createLocalConsoleGatewayProxyHandler(
  options: LocalConsoleGatewayProxyOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("Local console gateway proxy requires fetch.");
  }

  const trustedAddresses = buildTrustedAddressSet(
    options.trustedProxyIps && options.trustedProxyIps.length > 0
      ? options.trustedProxyIps
      : resolveTrustedProxyIps(options.routeTablePath),
  );

  return async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    const routeKind = resolveLocalConsoleGatewayRouteKind(requestUrl.pathname);
    if (!routeKind) {
      return false;
    }

    const method = (req.method ?? "GET").toUpperCase();
    if (!isGatewayProxyMethodAllowed(routeKind, method)) {
      res.statusCode = 405;
      res.setHeader("Allow", routeKind === "query-api" ? "GET, HEAD, POST" : "GET, HEAD");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    if (!isTrustedRemoteAddress(req.socket.remoteAddress, trustedAddresses)) {
      return sendTextResponse(res, 403, "Local console only accepts loopback requests.");
    }

    const started = await options.supervisor.ensureRunning("gateway-http-route");
    if (!started) {
      return sendTextResponse(res, 503, "Local console backend is unavailable.");
    }

    const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, options.config.baseUrl).toString();
    const requestBody = shouldForwardRequestBody(method) ? await readRequestBody(req) : undefined;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(
      () => controller.abort(),
      Math.max(options.config.requestTimeoutMs * 4, 5000),
    );

    try {
      const upstreamResponse = await fetchImpl(upstreamUrl, {
        headers: buildForwardHeaders(req.headers),
        method,
        ...(requestBody ? { body: requestBody } : {}),
        signal: controller.signal,
      });

      res.statusCode = upstreamResponse.status;
      applyResponseHeaders(res, upstreamResponse.headers);
      if (method === "HEAD") {
        res.end();
        return true;
      }

      const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
      res.end(responseBody);
      return true;
    } catch (error) {
      options.logger.warn(
        `[lynx-guardian] local console gateway proxy failed (${routeKind}) ${method} ${requestUrl.pathname}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!res.headersSent) {
        return sendTextResponse(res, 502, "Local console gateway proxy failed.");
      }
      return true;
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}

export function createLocalConsoleGatewayRouteRegistrations(
  options: LocalConsoleGatewayProxyOptions,
): LocalConsoleGatewayRouteRegistration[] {
  const handler = createLocalConsoleGatewayProxyHandler(options);

  return [
    {
      path: "/webview",
      auth: "plugin",
      match: "prefix",
      handler,
    },
    {
      path: "/lynx",
      auth: "plugin",
      match: "prefix",
      handler,
    },
  ];
}

const SECURITY_ENFORCEMENT_ACTIONS = new Set(["block", "redact", "requireApproval"]);
const SECURITY_POLICY_DECISIONS = new Set(["deny", "confirm", "block", "requireApproval"]);
const ROUTINE_HEARTBEAT_PROMPT = "read heartbeat.md if it exists";
const ROUTINE_HEARTBEAT_REPLY = "heartbeat_ok";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  return "";
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readNestedText(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => readNestedText(entry)).filter(Boolean).join(" ");
  }
  if (isRecord(value)) {
    return Object.values(value).map((entry) => readNestedText(entry)).filter(Boolean).join(" ");
  }
  return "";
}

function isHeartbeatReadPath(text: string): boolean {
  const normalized = normalizeText(text).replace(/\\/g, "/");
  return normalized.includes("heartbeat.md") && (
    normalized.includes("/workspace/")
    || normalized.includes("/.openclaw/")
    || normalized.includes("/home/node/.openclaw/")
    || normalized.includes("/app/")
  );
}

function isRoutineHeartbeatText(value: unknown): boolean {
  const text = normalizeText(readNestedText(value));
  if (!text) {
    return false;
  }

  if (text === ROUTINE_HEARTBEAT_REPLY) {
    return true;
  }
  if (text.startsWith(ROUTINE_HEARTBEAT_PROMPT) && text.includes("workspace context")) {
    return true;
  }
  if (text.includes(ROUTINE_HEARTBEAT_PROMPT) && text.includes("reply heartbeat_ok")) {
    return true;
  }
  if (text.includes("# heartbeat.md template") && text.includes("skip heartbeat api calls")) {
    return true;
  }
  if (text.includes("enoent") && isHeartbeatReadPath(text)) {
    return true;
  }
  return false;
}

function isHeartbeatReadTool(toolName: unknown, payload: unknown): boolean {
  if (normalizeText(toolName) !== "read") {
    return false;
  }
  return isHeartbeatReadPath(stringifyValue(payload));
}

function hasSecuritySignal(item: IngestItemV1): boolean {
  if (item.kind === "approvalUpsert" || item.kind === "lynxCheckUpsert") {
    return true;
  }

  if (item.kind === "auditEvent") {
    const data = item.data;
    return Boolean(
      data.riskLevel
      || data.riskScore !== undefined
      || data.primaryModule
      || data.modules?.length
      || SECURITY_ENFORCEMENT_ACTIONS.has(data.enforcementAction)
      || (data.policyDecision && SECURITY_POLICY_DECISIONS.has(data.policyDecision)),
    );
  }

  if (item.kind === "toolCallUpsert") {
    const data = item.data;
    return Boolean(
      data.riskLevel
      || data.riskScore !== undefined
      || data.triggeredModules?.length
      || SECURITY_ENFORCEMENT_ACTIONS.has(data.enforcementAction),
    );
  }

  if (item.kind === "qaRecordUpsert") {
    const data = item.data;
    return Boolean(
      data.riskLevel
      || data.riskScore !== undefined
      || data.status === "blocked"
      || data.status === "failed",
    );
  }

  return false;
}

function isHeartbeatSession(item: SessionUpsertItem): boolean {
  return [
    item.data.channelProfile,
    item.data.channelId,
    item.data.accountId,
    item.data.conversationId,
    item.data.metadataJson,
  ].some((value) => normalizeText(readNestedText(value)) === "heartbeat");
}

function isRoutineHeartbeatAuditItem(item: AuditEventItem, heartbeatToolCallIds: Set<string>): boolean {
  const data = item.data;
  if (hasSecuritySignal(item)) {
    return false;
  }

  if (data.toolCallId && heartbeatToolCallIds.has(data.toolCallId)) {
    return true;
  }
  if (isRoutineHeartbeatText(data.contentExcerpt) || isRoutineHeartbeatText(data.payloadJson)) {
    return true;
  }
  if (data.hookName === "before_tool_call" || data.hookName === "after_tool_call" || data.hookName === "tool_result_persist") {
    return isHeartbeatReadTool(
      isRecord(data.payloadJson) ? data.payloadJson.toolName : undefined,
      data.payloadJson,
    );
  }
  return false;
}

function isRoutineHeartbeatToolCallItem(item: ToolCallUpsertItem): boolean {
  if (hasSecuritySignal(item)) {
    return false;
  }
  return isHeartbeatReadTool(item.data.toolName, [
    item.data.paramSummary,
    item.data.resultExcerpt,
    item.data.errorText,
    item.data.metadataJson,
  ]);
}

function isRoutineHeartbeatTokenUsageItem(item: TokenUsageItem): boolean {
  return isRoutineHeartbeatText(item.data.payloadJson);
}

function isRoutineHeartbeatQARecordItem(item: QaRecordUpsertItem): boolean {
  if (hasSecuritySignal(item)) {
    return false;
  }
  return [
    item.data.userPromptExcerpt,
    item.data.finalAnswerExcerpt,
    item.data.payloadJson,
  ].some((value) => isRoutineHeartbeatText(value));
}

function resolveHeartbeatToolCallIds(items: IngestItemV1[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.kind === "toolCallUpsert" && isRoutineHeartbeatToolCallItem(item)) {
      ids.add(item.data.toolCallId);
    }
  }
  return ids;
}

function isRoutineHeartbeatItem(item: IngestItemV1, heartbeatToolCallIds: Set<string>): boolean {
  switch (item.kind) {
    case "auditEvent":
      return isRoutineHeartbeatAuditItem(item, heartbeatToolCallIds);
    case "toolCallUpsert":
      return isRoutineHeartbeatToolCallItem(item);
    case "sessionUpsert":
      return isHeartbeatSession(item);
    case "tokenUsage":
      return isRoutineHeartbeatTokenUsageItem(item);
    case "qaRecordUpsert":
      return isRoutineHeartbeatQARecordItem(item);
    default:
      return false;
  }
}

export function filterRoutineHeartbeatIngestItems(items: IngestItemV1[]): IngestItemV1[] {
  const heartbeatToolCallIds = resolveHeartbeatToolCallIds(items);
  const retained = items.filter((item) => !isRoutineHeartbeatItem(item, heartbeatToolCallIds));
  const hasNonSessionItem = retained.some((item) => item.kind !== "sessionUpsert");

  return hasNonSessionItem ? retained : [];
}

function hasHeartbeatContext(ctx: unknown): boolean {
  if (!isRecord(ctx)) {
    return false;
  }

  return [
    ctx.messageProvider,
    ctx.trigger,
    ctx.channelId,
    ctx.channel,
    ctx.provider,
    ctx.surface,
  ].some((value) => normalizeText(value) === "heartbeat");
}

export function shouldSkipRoutineHeartbeatProbe(hookName: string, payload: unknown, ctx: unknown): boolean {
  const normalizedHook = normalizeText(hookName);
  if (hasHeartbeatContext(ctx) && (
    normalizedHook === "llm_output"
    || isRoutineHeartbeatText(payload)
    || isHeartbeatReadTool(isRecord(payload) ? payload.toolName : undefined, payload)
  )) {
    return true;
  }

  if (normalizedHook === "after_tool_call" || normalizedHook === "tool_result_persist") {
    return isHeartbeatReadTool(isRecord(payload) ? payload.toolName : undefined, payload);
  }

  return false;
}

type BuilderOverrides = Partial<LocalConsoleEventBuilder>;

export interface LocalConsoleHookHandlers {
  sessionStart(input: SessionLifecycleInput): void;
  sessionEnd(input: SessionLifecycleInput): void;
  gatewayStart(input: GatewayStartInput): void;
  beforeDispatch(input: BeforeDispatchInput): void;
  messageReceived(input: MessageReceivedInput): void;
  beforeAgentStart(input: BeforeAgentStartInput): void;
  agentEnd(input: AgentEndInput): void;
  beforeMessageWrite(input: MessageWriteInput): void;
  toolResultPersist(input: ToolResultPersistInput): void;
  messageSending(input: MessageSendingInput): void;
  beforeToolCall(input: BeforeToolCallInput): void;
  afterToolCall(input: AfterToolCallInput): void;
}

interface LocalConsoleHookHandlersOptions {
  client: Pick<LocalConsoleIngestClient, "enqueueMany">;
  logger: Pick<Logger, "warn" | "error">;
  builder?: BuilderOverrides;
}

type BuilderMethodName = keyof LocalConsoleEventBuilder;

export function createLocalConsoleHookHandlers(options: LocalConsoleHookHandlersOptions): LocalConsoleHookHandlers {
  const defaultBuilder = createLocalConsoleEventBuilder();
  const activeQaRecordBySession = new Map<string, string>();
  const builder: LocalConsoleEventBuilder = {
    ...defaultBuilder,
    ...(options.builder ?? {}),
  };

  function shouldInheritActiveQaRecord(methodName: BuilderMethodName): boolean {
    return methodName === "beforeMessageWrite"
      || methodName === "toolResultPersist"
      || methodName === "messageSending";
  }

  function withActiveQaRecord<K extends BuilderMethodName>(
    methodName: K,
    input: Parameters<LocalConsoleEventBuilder[K]>[0],
  ): Parameters<LocalConsoleEventBuilder[K]>[0] {
    if (!shouldInheritActiveQaRecord(methodName) || !isRecord(input)) {
      return input;
    }
    if (normalizeText(input.qaRecordId) || normalizeText(input.runId)) {
      return input;
    }
    const sessionKey = normalizeText(input.sessionKey);
    const qaRecordId = sessionKey ? activeQaRecordBySession.get(sessionKey) : undefined;
    return qaRecordId
      ? { ...input, qaRecordId } as Parameters<LocalConsoleEventBuilder[K]>[0]
      : input;
  }

  function rememberActiveQaRecord(methodName: BuilderMethodName, items: IngestItemV1[]): void {
    for (const item of items) {
      if (item.kind !== "qaRecordUpsert") {
        continue;
      }
      const sessionKey = item.data.sessionKey?.trim();
      if (!sessionKey) {
        continue;
      }
      if (methodName === "agentEnd") {
        activeQaRecordBySession.delete(sessionKey);
        continue;
      }
      activeQaRecordBySession.set(sessionKey, item.data.qaRecordId);
    }
  }

  function emit<K extends BuilderMethodName>(
    methodName: K,
    input: Parameters<LocalConsoleEventBuilder[K]>[0],
  ): void {
    try {
      const enrichedInput = withActiveQaRecord(methodName, input);
      const items = filterRoutineHeartbeatIngestItems(builder[methodName](enrichedInput as never));
      if (!items || items.length === 0) {
        return;
      }

      const acceptedCount = options.client.enqueueMany(items);
      rememberActiveQaRecord(methodName, items);
      if (acceptedCount < items.length) {
        options.logger.warn(
          `[lynx-guardian] local console accepted ${acceptedCount}/${items.length} items for ${String(methodName)}`,
        );
      }
    } catch (error) {
      options.logger.error(
        `[lynx-guardian] local console hook logging failed for ${String(methodName)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    sessionStart(input) {
      emit("sessionStart", input);
    },
    sessionEnd(input) {
      emit("sessionEnd", input);
    },
    gatewayStart(input) {
      emit("gatewayStart", input);
    },
    beforeDispatch(input) {
      emit("beforeDispatch", input);
    },
    messageReceived(input) {
      emit("messageReceived", input);
    },
    beforeAgentStart(input) {
      emit("beforeAgentStart", input);
    },
    agentEnd(input) {
      emit("agentEnd", input);
    },
    beforeMessageWrite(input) {
      emit("beforeMessageWrite", input);
    },
    toolResultPersist(input) {
      emit("toolResultPersist", input);
    },
    messageSending(input) {
      emit("messageSending", input);
    },
    beforeToolCall(input) {
      emit("beforeToolCall", input);
    },
    afterToolCall(input) {
      emit("afterToolCall", input);
    },
  };
}

export function buildLocalConsoleLynxCheckSnapshot(
  intent: LynxCheckRunIntent,
  result: LynxCheckRunResult,
): LynxCheckSnapshotInput {
  const reportMarkdown = readLynxCheckReportMarkdown(result.reportPath);
  return {
    requestId: intent.requestId,
    source: intent.source,
    trigger: intent.trigger,
    preferredTargetKind: intent.preferredTargetKind,
    sessionKey: intent.sessionKey,
    targetKey: intent.routeHint?.targetKey,
    channelId: intent.routeHint?.channelId,
    messageProvider: intent.routeHint?.messageProvider,
    status: result.status,
    sendAttempted: result.sendAttempted,
    sendSucceeded: result.sendSucceeded,
    transport: result.transport,
    reportPath: result.reportPath,
    reportMarkdown,
    errorMessage: result.errorMessage,
    deliveryAttemptsJson: result.deliveryAttempts?.map((attempt) => ({ ...attempt })),
    createdAtMs: intent.createdAtMs,
    completedAtMs: result.status === "completed" || result.status === "failed"
      ? result.completedAtMs
      : undefined,
  };
}

const LYNX_CHECK_REPORT_MARKDOWN_MAX_CHARS = 1_000_000;

function readLynxCheckReportMarkdown(reportPath: string | undefined): string | undefined {
  const trimmed = reportPath?.trim();
  if (!trimmed || !isAllowedLynxCheckReportPath(trimmed) || !existsSync(trimmed)) {
    return undefined;
  }

  try {
    const content = readFileSync(trimmed, "utf8");
    return content.length > LYNX_CHECK_REPORT_MARKDOWN_MAX_CHARS
      ? content.slice(0, LYNX_CHECK_REPORT_MARKDOWN_MAX_CHARS)
      : content;
  } catch {
    return undefined;
  }
}

function isAllowedLynxCheckReportPath(reportPath: string): boolean {
  const normalized = resolve(reportPath).replace(/\\/g, "/").toLowerCase();
  return basename(normalized).endsWith(".report.md")
    && normalized.includes("/.openclaw/lynx/check-runs/");
}

const DEFAULT_LOCAL_CONSOLE_WEBVIEW_URL = "http://127.0.0.1:18789/webview";
const LOCAL_CONSOLE_WEBVIEW_NOTE_MARKER = "[^lynx-log]";
const LYNX_GUARDIAN_L4_REPLY_PATTERNS = [
  /Lynx Guardian/i,
  /\bL4\b|L4\s*级|最高(?:等级|级别)?安全(?:拒绝|拦截|级别)?/,
  /拦截|拒绝|已拒绝|安全拒绝|blocked|denied|denial|intercepted/i,
];

export function buildLocalConsoleWebviewUrl(options: {
  host?: string;
  port?: number;
} = {}): string {
  const host = options.host?.trim() || "127.0.0.1";
  const port = Number.isFinite(options.port) && options.port ? Math.trunc(options.port) : 18789;
  return `http://${host}:${port}/webview`;
}

export function buildLocalConsoleWebviewFootnote(options: {
  url?: string;
} = {}): string {
  const url = options.url?.trim() || DEFAULT_LOCAL_CONSOLE_WEBVIEW_URL;
  return [
    "---",
    `${LOCAL_CONSOLE_WEBVIEW_NOTE_MARKER}: 本地日志页面 Webview：<${url}>。这里汇总 Lynx Guardian 记录的审计日志、工具调用、审批和 /lynx-check 结果，可用于追踪本次安全事件。`,
  ].join("\n");
}

export function appendLocalConsoleWebviewFootnote(
  content: string,
  options: { url?: string } = {},
): string {
  const base = content.trimEnd();
  if (!base || base.includes(LOCAL_CONSOLE_WEBVIEW_NOTE_MARKER)) {
    return base;
  }

  return `${base}\n\n${buildLocalConsoleWebviewFootnote(options)}`;
}

export function shouldAppendLocalConsoleWebviewFootnoteForL4Reply(content: string): boolean {
  const text = content.trim();
  if (!text || text.includes(LOCAL_CONSOLE_WEBVIEW_NOTE_MARKER)) {
    return false;
  }

  return LYNX_GUARDIAN_L4_REPLY_PATTERNS.every((pattern) => pattern.test(text));
}

export function appendLocalConsoleWebviewFootnoteForL4Reply(content: string): string {
  return shouldAppendLocalConsoleWebviewFootnoteForL4Reply(content)
    ? appendLocalConsoleWebviewFootnote(content)
    : content.trimEnd();
}
