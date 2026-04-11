import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type { RecentActiveDeliverySnapshot } from "./recent-active-delivery.js";
import { normalizeString, resolveRuntimeHomeDir } from "./plugin-runtime-helpers.js";

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
  reportPath?: string;
  errorMessage?: string;
  completedAtMs: number;
}

interface LynxCheckRunStoreOptions {
  rootDir?: string;
}

type CreateLynxCheckRunIntentInput = Omit<LynxCheckRunIntent, "requestId" | "createdAtMs" | "status"> & {
  requestId?: string;
  createdAtMs?: number;
};

type WriteLynxCheckRunResultInput = Omit<LynxCheckRunResult, "requestId" | "completedAtMs"> & {
  completedAtMs?: number;
};

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

function normalizeResult(value: unknown): LynxCheckRunResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  const requestId = normalizeString(parsed.requestId);
  const status = parsed.status;
  const transport = normalizeString(parsed.transport);
  const completedAtMs = parsed.completedAtMs;

  if (!requestId) {
    return null;
  }
  if (status !== "not_started" && status !== "running" && status !== "completed" && status !== "failed") {
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
    reportPath: normalizeString(parsed.reportPath) || undefined,
    errorMessage: normalizeString(parsed.errorMessage) || undefined,
    completedAtMs,
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

  return writeIntent(
    {
      ...existing,
      status,
    },
    options,
  );
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
  });

  if (!result) {
    throw new Error("Invalid LynxCheckRunResult");
  }

  writeJson(buildResultPath(requestId, options), result);
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
    return normalizeResult(JSON.parse(readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}
