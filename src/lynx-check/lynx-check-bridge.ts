/**
 * Task 11 ownership: Go owns /lynx-check task state.
 * Local intent/result files stay as runtime artifacts and delivery fallback.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import type { LynxReportDeliveryAttempt } from "../types.js";
import { GoControlPlaneClient } from "../api/go-control-plane.js";
import type { RecentActiveDeliverySnapshot } from "../runtime/recent-active-delivery.js";
import { assertManagedLynxAuditBoundary } from "../runtime/lynx-audit-runtime.js";
import { normalizeString, resolveRuntimeHomeDir } from "../runtime/plugin-runtime-helpers.js";

export interface LynxCheckRunIntent {
  requestId: string;
  source: "manual" | "scheduled";
  trigger: "lynx_command" | "scheduled_lynx_check";
  preferredTargetKind: "current" | "recent";
  sessionKey?: string;
  routeHint?: RecentActiveDeliverySnapshot;
  createdAtMs: number;
  status: "pending" | "running" | "completed" | "failed";
}

export interface LynxCheckRunResult {
  requestId: string;
  status: "not_started" | "running" | "completed" | "failed";
  sendAttempted: boolean;
  sendSucceeded: boolean;
  transport: string;
  deliveryAttempts?: LynxReportDeliveryAttempt[];
  reportPath?: string;
  errorMessage?: string;
  completedAtMs: number;
}

interface LynxCheckRunStoreOptions {
  rootDir?: string;
}

interface WaitForLynxCheckRunResultOptions extends LynxCheckRunStoreOptions {
  maxWaitMs?: number;
  pollIntervalMs?: number;
}

export interface LynxCheckTaskControlPlaneConfig {
  baseUrl: string;
  getToken?: () => string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn">;
}

type CreateLynxCheckRunIntentInput = Omit<LynxCheckRunIntent, "requestId" | "createdAtMs" | "status"> & {
  requestId?: string;
  createdAtMs?: number;
};

type WriteLynxCheckRunResultInput = Omit<LynxCheckRunResult, "requestId" | "completedAtMs"> & {
  completedAtMs?: number;
};

let taskControlPlaneConfig: LynxCheckTaskControlPlaneConfig | null = null;

export function configureLynxCheckTaskControlPlane(config?: LynxCheckTaskControlPlaneConfig | null): void {
  taskControlPlaneConfig = config?.baseUrl ? config : null;
}

export interface ManagedLynxCheckAuthorization {
  scope: "manual-and-scheduled";
  source: "scheduled-job-create" | "plugin-startup" | "manual-bootstrap";
  grantedAtMs: number;
  grantedByPlugin: true;
}

interface ManagedLynxCheckAuthorizationStoreOptions {
  filePath?: string;
}

function getDefaultAuthorizationPath(): string {
  return join(resolveRuntimeHomeDir(), ".openclaw", "lynx", "managed-lynx-check-authorization.json");
}

function resolveAuthorizationPath(customPath?: string): string {
  const trimmed = normalizeString(customPath);
  if (!trimmed) {
    return getDefaultAuthorizationPath();
  }
  if (trimmed.startsWith("~")) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, resolveRuntimeHomeDir()));
  }
  return resolve(trimmed);
}

function writeAuthorization(
  record: ManagedLynxCheckAuthorization,
  options?: ManagedLynxCheckAuthorizationStoreOptions,
): ManagedLynxCheckAuthorization {
  const filePath = resolveAuthorizationPath(options?.filePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");
  return record;
}

export function readManagedLynxCheckAuthorization(
  options?: ManagedLynxCheckAuthorizationStoreOptions,
): ManagedLynxCheckAuthorization | null {
  const filePath = resolveAuthorizationPath(options?.filePath);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (
      record.scope !== "manual-and-scheduled"
      || (
        record.source !== "scheduled-job-create"
        && record.source !== "plugin-startup"
        && record.source !== "manual-bootstrap"
      )
      || typeof record.grantedAtMs !== "number"
      || record.grantedByPlugin !== true
    ) {
      return null;
    }

    return {
      scope: "manual-and-scheduled",
      source: record.source,
      grantedAtMs: record.grantedAtMs,
      grantedByPlugin: true,
    };
  } catch {
    return null;
  }
}

export function grantManagedLynxCheckAuthorization(
  input: {
    scope: "manual-and-scheduled";
    source: ManagedLynxCheckAuthorization["source"];
  },
  options?: ManagedLynxCheckAuthorizationStoreOptions,
): ManagedLynxCheckAuthorization {
  assertManagedLynxAuditBoundary({
    action: "authorize_run",
    target: input.source,
    managed: true,
  });

  return writeAuthorization({
    scope: input.scope,
    source: input.source,
    grantedAtMs: Date.now(),
    grantedByPlugin: true,
  }, options);
}

export function hasManagedLynxCheckAuthorization(
  options?: ManagedLynxCheckAuthorizationStoreOptions,
): boolean {
  return readManagedLynxCheckAuthorization(options)?.grantedByPlugin === true;
}

export function clearManagedLynxCheckAuthorization(
  options?: ManagedLynxCheckAuthorizationStoreOptions,
): void {
  const filePath = resolveAuthorizationPath(options?.filePath);
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function resolveRootDir(customRootDir?: string): string {
  const trimmed = normalizeString(customRootDir);
  if (!trimmed) {
    return join(resolveRuntimeHomeDir(), ".openclaw", "lynx", "check-runs");
  }
  if (trimmed.startsWith("~")) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, resolveRuntimeHomeDir()));
  }
  return resolve(trimmed);
}

function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function buildIntentPath(requestId: string, options?: LynxCheckRunStoreOptions): string {
  return join(resolveRootDir(options?.rootDir), `${requestId}.intent.json`);
}

function buildResultPath(requestId: string, options?: LynxCheckRunStoreOptions): string {
  return join(resolveRootDir(options?.rootDir), `${requestId}.result.json`);
}

export function getLynxCheckRunResultPath(requestId: string, options?: LynxCheckRunStoreOptions): string {
  return buildResultPath(requestId, options);
}

export function getLynxCheckRunReportPath(requestId: string, options?: LynxCheckRunStoreOptions): string {
  return join(resolveRootDir(options?.rootDir), `${requestId}.report.md`);
}

function buildRequestId(now: number): string {
  return `lynx-check-${now}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRouteHint(value: unknown): RecentActiveDeliverySnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const parsed = value as Record<string, unknown>;
  const targetKey = normalizeString(parsed.targetKey);
  if (!targetKey) {
    return undefined;
  }

  return {
    targetKey,
    sessionKey: normalizeString(parsed.sessionKey) || undefined,
    channelId: normalizeString(parsed.channelId) || undefined,
    messageProvider: normalizeString(parsed.messageProvider) || undefined,
    senderId: normalizeString(parsed.senderId) || undefined,
    bindingId: normalizeString(parsed.bindingId) || undefined,
    updatedAtMs: typeof parsed.updatedAtMs === "number" && Number.isFinite(parsed.updatedAtMs)
      ? parsed.updatedAtMs
      : 0,
  };
}

function normalizeIntent(value: unknown): LynxCheckRunIntent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  const requestId = normalizeString(parsed.requestId);
  const source = parsed.source;
  const trigger = parsed.trigger;
  const preferredTargetKind = parsed.preferredTargetKind;
  const status = parsed.status;
  const createdAtMs = parsed.createdAtMs;

  if (!requestId) {
    return null;
  }
  if (source !== "manual" && source !== "scheduled") {
    return null;
  }
  if (trigger !== "lynx_command" && trigger !== "scheduled_lynx_check") {
    return null;
  }
  if (preferredTargetKind !== "current" && preferredTargetKind !== "recent") {
    return null;
  }
  if (status !== "pending" && status !== "running" && status !== "completed" && status !== "failed") {
    return null;
  }
  if (typeof createdAtMs !== "number" || !Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    return null;
  }

  return {
    requestId,
    source,
    trigger,
    preferredTargetKind,
    sessionKey: normalizeString(parsed.sessionKey) || undefined,
    routeHint: normalizeRouteHint(parsed.routeHint),
    createdAtMs,
    status,
  };
}

function isPathWithinRoot(candidatePath: string, rootDir: string): boolean {
  const resolvedCandidate = resolve(candidatePath);
  const resolvedRoot = resolve(rootDir);
  const normalizeForCompare = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
  const candidateComparable = normalizeForCompare(resolvedCandidate);
  const rootComparable = normalizeForCompare(resolvedRoot);

  return candidateComparable === rootComparable || candidateComparable.startsWith(`${rootComparable}\\`) || candidateComparable.startsWith(`${rootComparable}/`);
}

function normalizeResultPath(value: unknown, options?: LynxCheckRunStoreOptions): string | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }
  const rootDir = resolveRootDir(options?.rootDir);
  let resolvedPath: string;

  if (normalized.startsWith("~")) {
    resolvedPath = resolve(normalized.replace(/^~(?=$|[\\/])/, resolveRuntimeHomeDir()));
  } else if (normalized.startsWith(".openclaw") || normalized.startsWith(".\\openclaw") || normalized.startsWith("./.openclaw")) {
    resolvedPath = resolve(resolveRuntimeHomeDir(), normalized);
  } else if (isAbsolute(normalized)) {
    resolvedPath = resolve(normalized);
  } else {
    resolvedPath = resolve(rootDir, normalized);
  }

  if (!isPathWithinRoot(resolvedPath, rootDir)) {
    return undefined;
  }
  return resolvedPath;
}

function normalizeResult(
  value: unknown,
  options?: { coerceUnsupportedStatus?: boolean; rootDir?: string },
): LynxCheckRunResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  const requestId = normalizeString(parsed.requestId);
  const rawStatus = normalizeString(parsed.status);
  const transport = normalizeString(parsed.transport);
  const completedAtMs = parsed.completedAtMs;
  let status: LynxCheckRunResult["status"] | null = null;
  let statusErrorMessage: string | undefined;

  if (!requestId) {
    return null;
  }
  if (rawStatus === "not_started" || rawStatus === "running" || rawStatus === "completed" || rawStatus === "failed") {
    status = rawStatus;
  } else if (options?.coerceUnsupportedStatus && rawStatus) {
    status = "failed";
    statusErrorMessage = `Unsupported run result status: ${rawStatus}`;
  } else {
    return null;
  }
  if (typeof parsed.sendAttempted !== "boolean" || typeof parsed.sendSucceeded !== "boolean") {
    return null;
  }
  if (!transport) {
    return null;
  }
  if (typeof completedAtMs !== "number" || !Number.isFinite(completedAtMs) || completedAtMs < 0) {
    return null;
  }

  return {
    requestId,
    status,
    sendAttempted: parsed.sendAttempted,
    sendSucceeded: parsed.sendSucceeded,
    transport,
    deliveryAttempts: normalizeDeliveryAttempts(parsed.deliveryAttempts),
    reportPath: normalizeResultPath(parsed.reportPath, { rootDir: options?.rootDir }),
    errorMessage: statusErrorMessage ?? (normalizeString(parsed.errorMessage) || undefined),
    completedAtMs,
  };
}

function normalizeDeliveryAttempts(value: unknown): LynxReportDeliveryAttempt[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((item) => normalizeDeliveryAttempt(item))
    .filter((item: LynxReportDeliveryAttempt | null): item is LynxReportDeliveryAttempt => Boolean(item));

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeDeliveryAttempt(value: unknown): LynxReportDeliveryAttempt | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  const targetKey = normalizeString(parsed.targetKey);
  const transport = normalizeString(parsed.transport);
  if (!targetKey || !transport || typeof parsed.delivered !== "boolean") {
    return null;
  }

  return {
    targetKey,
    sessionKey: normalizeString(parsed.sessionKey) || undefined,
    channelId: normalizeString(parsed.channelId) || undefined,
    messageProvider: normalizeString(parsed.messageProvider) || undefined,
    senderId: normalizeString(parsed.senderId) || undefined,
    bindingId: normalizeString(parsed.bindingId) || undefined,
    delivered: parsed.delivered,
    transport,
    errorMessage: normalizeString(parsed.errorMessage) || undefined,
  };
}

function writeJson(filePath: string, value: unknown): void {
  ensureParentDirectory(filePath);
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function listIntentFiles(options?: LynxCheckRunStoreOptions): string[] {
  const rootDir = resolveRootDir(options?.rootDir);
  if (!existsSync(rootDir)) {
    return [];
  }

  return readdirSync(rootDir)
    .filter((fileName) => fileName.endsWith(".intent.json"))
    .map((fileName) => join(rootDir, fileName));
}

function writeIntent(intent: LynxCheckRunIntent, options?: LynxCheckRunStoreOptions): LynxCheckRunIntent {
  writeJson(buildIntentPath(intent.requestId, options), intent);
  return intent;
}

function startTaskTrigger(intent: LynxCheckRunIntent): "manual" | "scheduled" {
  return intent.source === "scheduled" || intent.trigger === "scheduled_lynx_check"
    ? "scheduled"
    : "manual";
}

function mapIntentStatusToTaskStatus(status: LynxCheckRunIntent["status"]): string {
  switch (status) {
    case "running":
      return "collecting";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "pending":
    default:
      return "created";
  }
}

function mapResultStatusToTaskStatus(status: LynxCheckRunResult["status"]): string | null {
  switch (status) {
    case "running":
      return "collecting";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "not_started":
    default:
      return null;
  }
}

function sendTaskControlPlanePayload(
  operation: (client: GoControlPlaneClient) => Promise<unknown>,
): void {
  const config = taskControlPlaneConfig;
  if (!config) {
    return;
  }

  let client: GoControlPlaneClient;
  try {
    client = new GoControlPlaneClient(config);
  } catch (error) {
    config.logger?.warn?.(
      `[lynx-guardian] Failed to prepare /lynx-check task control plane client: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  void operation(client).catch((error) => {
    config.logger?.warn?.(
      `[lynx-guardian] Failed to sync /lynx-check task state to Go: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

function syncTaskStart(intent: LynxCheckRunIntent): void {
  const body = {
    requestId: intent.requestId,
    trigger: startTaskTrigger(intent),
    source: intent.trigger,
    sessionKey: intent.sessionKey,
    targetKey: intent.routeHint?.targetKey ?? intent.preferredTargetKind,
    requesterId: intent.routeHint?.senderId,
    facts: {
      preferredTargetKind: intent.preferredTargetKind,
      routeHint: intent.routeHint,
      createdAtMs: intent.createdAtMs,
    },
  };
  sendTaskControlPlanePayload((client) => client.startLynxCheckTask(body));
}

function syncTaskIntentStatus(intent: LynxCheckRunIntent): void {
  sendTaskControlPlanePayload((client) => client.appendLynxCheckTaskEvent(intent.requestId, {
    status: mapIntentStatusToTaskStatus(intent.status),
  }));
}

function syncTaskRunResult(result: LynxCheckRunResult): void {
  const status = mapResultStatusToTaskStatus(result.status);
  if (!status) {
    return;
  }

  const deliveredAttempt = result.deliveryAttempts?.find((attempt) => attempt.delivered);
  sendTaskControlPlanePayload((client) => client.appendLynxCheckTaskEvent(result.requestId, {
    status,
    deliveryChannel: result.transport !== "pending" ? result.transport : undefined,
    deliveryTarget: deliveredAttempt?.targetKey ?? result.deliveryAttempts?.[0]?.targetKey,
    deliveryStatus: result.sendAttempted
      ? result.sendSucceeded ? "sent" : "failed"
      : undefined,
    errorMessage: result.errorMessage,
    evidenceBundle: {
      deliveryAttempts: result.deliveryAttempts ?? [],
      reportPath: result.reportPath,
      completedAtMs: result.completedAtMs,
    },
  }));
}

export function createLynxCheckRunIntent(
  input: CreateLynxCheckRunIntentInput,
  options?: LynxCheckRunStoreOptions,
): LynxCheckRunIntent {
  const createdAtMs = typeof input.createdAtMs === "number" && Number.isFinite(input.createdAtMs)
    ? input.createdAtMs
    : Date.now();
  const requestId = normalizeString(input.requestId) || buildRequestId(createdAtMs);
  const intent = normalizeIntent({
    ...input,
    requestId,
    createdAtMs,
    status: "pending",
  });

  if (!intent) {
    throw new Error("Invalid LynxCheckRunIntent");
  }

  writeIntent(intent, options);
  writeLynxCheckRunResult(requestId, {
    status: "not_started",
    sendAttempted: false,
    sendSucceeded: false,
    transport: "pending",
    reportPath: getLynxCheckRunReportPath(requestId, options),
  }, options);
  syncTaskStart(intent);
  return intent;
}

export function readLynxCheckRunIntent(
  requestId: string,
  options?: LynxCheckRunStoreOptions,
): LynxCheckRunIntent | null {
  const filePath = buildIntentPath(requestId, options);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return normalizeIntent(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}

export function updateLynxCheckRunIntentStatus(
  requestId: string,
  status: LynxCheckRunIntent["status"],
  options?: LynxCheckRunStoreOptions,
): LynxCheckRunIntent | null {
  const existing = readLynxCheckRunIntent(requestId, options);
  if (!existing) {
    return null;
  }

  const updated = writeIntent(
    {
      ...existing,
      status,
    },
    options,
  );
  syncTaskIntentStatus(updated);
  return updated;
}

export function markLynxCheckRunCompleted(
  requestId: string,
  options?: LynxCheckRunStoreOptions,
): LynxCheckRunIntent | null {
  return updateLynxCheckRunIntentStatus(requestId, "completed", options);
}

export function readLatestPendingLynxCheckRunIntent(
  sessionKey?: string,
  options?: LynxCheckRunStoreOptions,
): LynxCheckRunIntent | null {
  const normalizedSessionKey = normalizeString(sessionKey);
  const intents = listIntentFiles(options)
    .map((filePath) => {
      try {
        return normalizeIntent(JSON.parse(readFileSync(filePath, "utf8")));
      } catch {
        return null;
      }
    })
    .filter((intent): intent is LynxCheckRunIntent => Boolean(intent))
    .filter((intent) => intent.status === "pending" || intent.status === "running")
    .filter((intent) => !normalizedSessionKey || intent.sessionKey === normalizedSessionKey)
    .sort((left, right) => right.createdAtMs - left.createdAtMs);

  return intents[0] ?? null;
}

export function writeLynxCheckRunResult(
  requestId: string,
  input: WriteLynxCheckRunResultInput,
  options?: LynxCheckRunStoreOptions,
): LynxCheckRunResult {
  const completedAtMs = typeof input.completedAtMs === "number" && Number.isFinite(input.completedAtMs)
    ? input.completedAtMs
    : input.status === "not_started"
      ? 0
      : Date.now();
  const result = normalizeResult({
    ...input,
    requestId,
    completedAtMs,
  }, { coerceUnsupportedStatus: false, rootDir: options?.rootDir });

  if (!result) {
    throw new Error("Invalid LynxCheckRunResult");
  }

  writeJson(buildResultPath(requestId, options), result);
  syncTaskRunResult(result);
  return result;
}

export function readLynxCheckRunResult(
  requestId: string,
  options?: LynxCheckRunStoreOptions,
): LynxCheckRunResult | null {
  const filePath = buildResultPath(requestId, options);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return normalizeResult(JSON.parse(readFileSync(filePath, "utf8")), {
      coerceUnsupportedStatus: true,
      rootDir: options?.rootDir,
    });
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

export async function waitForLynxCheckRunResultSettled(
  requestId: string,
  options?: WaitForLynxCheckRunResultOptions,
): Promise<LynxCheckRunResult | null> {
  const maxWaitMs = Math.max(0, Math.floor(options?.maxWaitMs ?? 250));
  const pollIntervalMs = Math.max(1, Math.floor(options?.pollIntervalMs ?? 25));
  const deadlineMs = Date.now() + maxWaitMs;

  let latest = readLynxCheckRunResult(requestId, options);
  while (Date.now() < deadlineMs) {
    if (latest && (latest.status === "completed" || latest.status === "failed")) {
      return latest;
    }
    if (latest && latest.status !== "not_started" && latest.status !== "running") {
      return latest;
    }

    const remainingMs = Math.max(0, deadlineMs - Date.now());
    await delay(Math.min(pollIntervalMs, remainingMs));
    latest = readLynxCheckRunResult(requestId, options);
  }

  return latest;
}
