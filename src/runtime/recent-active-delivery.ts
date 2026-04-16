import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import type { EventContext, Message } from "../types.js";
import { normalizeString, resolveRuntimeHomeDir } from "./plugin-runtime-helpers.js";

export type ScheduledLynxDeliveryMode = "recent-active" | "announce";

export interface RecentActiveRouteHint {
  targetKey: string;
  sessionKey?: string;
  channelId?: string;
  messageProvider?: string;
  senderId?: string;
  bindingId?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
  updatedAtMs: number;
}

export interface RecentActiveDeliverySnapshot extends RecentActiveRouteHint {}

export interface RecentActiveDeliveryTarget extends RecentActiveRouteHint {
  sendMessage: (message: Message) => Promise<void>;
}

interface RecentActiveDeliveryState {
  version: 2;
  targets: RecentActiveDeliverySnapshot[];
}

interface SessionStoreEntryOrigin {
  provider?: unknown;
  surface?: unknown;
  from?: unknown;
  to?: unknown;
  accountId?: unknown;
  threadId?: unknown;
}

interface SessionStoreEntryDeliveryContext {
  channel?: unknown;
  to?: unknown;
  accountId?: unknown;
  threadId?: unknown;
}

interface SessionStoreEntry {
  updatedAt?: unknown;
  origin?: SessionStoreEntryOrigin;
  deliveryContext?: SessionStoreEntryDeliveryContext;
}

const liveTargets = new Map<string, RecentActiveDeliveryTarget["sendMessage"]>();
const DEFAULT_SESSION_STORE_RELATIVE_PATHS = [
  [".openclaw", "docker-state", "agents", "main", "sessions", "sessions.json"],
  [".openclaw", "agents", "main", "sessions", "sessions.json"],
];

function getDefaultRecentActiveDeliveryPath(): string {
  return join(resolveRuntimeHomeDir(), ".openclaw", "lynx", "recent-active-delivery.json");
}

function resolveRecentActiveDeliveryPath(customPath?: string): string {
  const trimmed = normalizeString(customPath);
  if (!trimmed) {
    return getDefaultRecentActiveDeliveryPath();
  }
  if (trimmed.startsWith("~")) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, resolveRuntimeHomeDir()));
  }
  return resolve(trimmed);
}

function resolveSessionStorePaths(): string[] {
  const homeDir = resolveRuntimeHomeDir();
  return DEFAULT_SESSION_STORE_RELATIVE_PATHS.map((parts) => join(homeDir, ...parts));
}

function buildTargetKey(parts: {
  sessionKey?: string;
  channelId?: string;
  messageProvider?: string;
  senderId?: string;
  bindingId?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
}): string {
  if (parts.sessionKey) {
    return parts.sessionKey;
  }

  const directTarget = normalizeString(parts.to) || normalizeString(parts.bindingId);
  if (directTarget) {
    return [parts.messageProvider, parts.channelId, directTarget]
      .map((item) => normalizeString(item))
      .filter(Boolean)
      .join(":");
  }

  const accountId = normalizeString(parts.accountId);
  const threadId = normalizeThreadId(parts.threadId);
  if (accountId && threadId !== undefined) {
    return [parts.messageProvider, parts.channelId, accountId, String(threadId)]
      .map((item) => normalizeString(item))
      .filter(Boolean)
      .join(":");
  }

  return [parts.messageProvider, parts.channelId, parts.senderId]
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .join(":");
}

const SYSTEM_ONLY_DELIVERY_VALUES = new Set(["heartbeat"]);

function normalizeThreadId(value: unknown): string | number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : normalizeString(value) || undefined;
}

export function isSystemOnlyDeliveryValue(value: unknown): boolean {
  const normalized = normalizeString(value).toLowerCase();
  return normalized.length > 0 && SYSTEM_ONLY_DELIVERY_VALUES.has(normalized);
}

export function isSystemOnlyDeliveryRoute(route?: Partial<RecentActiveRouteHint> | null): boolean {
  if (!route) {
    return false;
  }

  return [
    route.messageProvider,
    route.channelId,
    route.senderId,
    route.bindingId,
    route.to,
  ].some((candidate) => isSystemOnlyDeliveryValue(candidate));
}

export function hasConcreteDeliveryTarget(route?: Partial<RecentActiveRouteHint> | null): boolean {
  if (!route || isSystemOnlyDeliveryRoute(route)) {
    return false;
  }

  if (normalizeString(route.to)) {
    return true;
  }

  if (normalizeString(route.bindingId)) {
    return true;
  }

  const accountId = normalizeString(route.accountId);
  const threadId = normalizeThreadId(route.threadId);
  return Boolean(accountId && threadId !== undefined);
}

function normalizeSnapshot(value: unknown): RecentActiveDeliverySnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  const targetKey = normalizeString(parsed.targetKey);
  if (!targetKey) {
    return null;
  }

  const snapshot: RecentActiveDeliverySnapshot = {
    targetKey,
    sessionKey: normalizeString(parsed.sessionKey) || undefined,
    channelId: normalizeString(parsed.channelId) || undefined,
    messageProvider: normalizeString(parsed.messageProvider) || undefined,
    senderId: normalizeString(parsed.senderId) || undefined,
    bindingId: normalizeString(parsed.bindingId) || undefined,
    to: normalizeString(parsed.to) || undefined,
    accountId: normalizeString(parsed.accountId) || undefined,
    threadId: normalizeThreadId(parsed.threadId),
    updatedAtMs: typeof parsed.updatedAtMs === "number" ? parsed.updatedAtMs : 0,
  };

  if (isSystemOnlyDeliveryRoute(snapshot)) {
    return null;
  }

  return snapshot;
}

function resolveThreadId(origin: SessionStoreEntryOrigin, deliveryContext: SessionStoreEntryDeliveryContext, deliveryMatchesOrigin: boolean): string | number | undefined {
  if (deliveryMatchesOrigin) {
    return normalizeThreadId(deliveryContext?.threadId)
      ?? normalizeThreadId(origin?.threadId);
  }

  return normalizeThreadId(origin?.threadId);
}

function resolveTo(origin: SessionStoreEntryOrigin, deliveryContext: SessionStoreEntryDeliveryContext, deliveryMatchesOrigin: boolean): string | undefined {
  return deliveryMatchesOrigin
    ? normalizeString(deliveryContext?.to) || normalizeString(origin?.to) || undefined
    : normalizeString(origin?.to) || undefined;
}

function resolveAccountId(origin: SessionStoreEntryOrigin, deliveryContext: SessionStoreEntryDeliveryContext, deliveryMatchesOrigin: boolean): string | undefined {
  return deliveryMatchesOrigin
    ? normalizeString(deliveryContext?.accountId) || normalizeString(origin?.accountId) || undefined
    : normalizeString(origin?.accountId) || undefined;
}

function normalizeSessionStoreRoute(
  normalizedSessionKey: string,
  entry: SessionStoreEntry,
): RecentActiveDeliverySnapshot | null {
  const origin = entry.origin;
  const deliveryContext = entry.deliveryContext;
  const messageProvider = normalizeString(origin?.provider) || normalizeString(origin?.surface) || undefined;
  const channelId = normalizeString(origin?.surface) || normalizeString(origin?.provider) || undefined;
  const senderId = normalizeString(origin?.from) || normalizeString(origin?.to) || undefined;
  const normalizedDeliveryChannel = normalizeString(deliveryContext?.channel) || undefined;
  const deliveryMatchesOrigin =
    normalizedDeliveryChannel != null
    && [messageProvider, channelId]
      .filter((candidate): candidate is string => Boolean(candidate))
      .some((candidate) => candidate === normalizedDeliveryChannel);
  const snapshot: RecentActiveDeliverySnapshot = {
    targetKey: normalizedSessionKey,
    sessionKey: normalizedSessionKey,
    channelId,
    messageProvider,
    senderId,
    to: resolveTo(origin ?? {}, deliveryContext ?? {}, deliveryMatchesOrigin),
    accountId: resolveAccountId(origin ?? {}, deliveryContext ?? {}, deliveryMatchesOrigin),
    threadId: resolveThreadId(origin ?? {}, deliveryContext ?? {}, deliveryMatchesOrigin),
    updatedAtMs: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
  };

  if ((!messageProvider && !channelId && !senderId) || isSystemOnlyDeliveryRoute(snapshot)) {
    return null;
  }

  return snapshot;
}

function normalizeSessionStoreSnapshot(
  sessionKey: string,
  value: unknown,
): RecentActiveDeliverySnapshot | null {
  const normalizedSessionKey = normalizeString(sessionKey);
  if (!normalizedSessionKey || normalizedSessionKey.includes(":cron:")) {
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as SessionStoreEntry;
  return normalizeSessionStoreRoute(normalizedSessionKey, entry);
}

function sortSnapshots(snapshots: RecentActiveDeliverySnapshot[]): RecentActiveDeliverySnapshot[] {
  return [...snapshots].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

function buildLiveTargetSender(
  ctx: EventContext,
  snapshot: RecentActiveRouteHint,
): ((message: Message) => Promise<void>) | undefined {
  if (typeof ctx.sendMessage === "function") {
    return ctx.sendMessage;
  }

  const resolveMessageTarget = ctx.resolveMessageTarget;
  const sharedSend = ctx.sharedMessageSender?.send;
  if (typeof resolveMessageTarget !== "function" || typeof sharedSend !== "function") {
    return undefined;
  }

  return async (message: Message) => {
    const resolvedTarget = await resolveMessageTarget({
      targetKey: snapshot.targetKey,
      sessionKey: snapshot.sessionKey,
    channelId: snapshot.channelId,
    messageProvider: snapshot.messageProvider,
    senderId: snapshot.senderId,
    bindingId: snapshot.bindingId,
    to: snapshot.to,
    accountId: snapshot.accountId,
    threadId: snapshot.threadId,
  });
    if (!resolvedTarget) {
      throw new Error(`No delivery transport resolved for target ${snapshot.targetKey}`);
    }

    await sharedSend({
      target: resolvedTarget,
      message,
      metadata: {
        source: "lynx-guardian",
        transport: "remembered-shared-target",
        deliveryTargetKey: snapshot.targetKey,
      },
    });
  };
}

function buildSnapshot(ctx: EventContext, now: number): RecentActiveRouteHint | null {
  return buildSnapshotWithOptions(ctx, now, false);
}

function buildSnapshotWithOptions(
  ctx: EventContext,
  now: number,
  allowRouteOnly: boolean,
): RecentActiveRouteHint | null {
  if (!ctx) {
    return null;
  }

  if (normalizeString((ctx as any).subsystem).toLowerCase() === "plugins") {
    return null;
  }

  const snapshot: RecentActiveRouteHint = {
    sessionKey: normalizeString(ctx.sessionKey) || undefined,
    channelId: normalizeString((ctx as any).channelId ?? (ctx as any).channel) || undefined,
    messageProvider: normalizeString((ctx as any).messageProvider ?? (ctx as any).source) || undefined,
    senderId: normalizeString((ctx as any).senderId ?? (ctx as any).userId) || undefined,
    bindingId: normalizeString((ctx as any).bindingId) || undefined,
    to: normalizeString((ctx as any).to ?? (ctx as any).recipientId ?? (ctx as any).conversationId) || undefined,
    accountId: normalizeString((ctx as any).accountId) || undefined,
    threadId:
      typeof (ctx as any).messageThreadId === "number" && Number.isFinite((ctx as any).messageThreadId)
        ? (ctx as any).messageThreadId
        : typeof (ctx as any).threadId === "number" && Number.isFinite((ctx as any).threadId)
          ? (ctx as any).threadId
          : normalizeString((ctx as any).messageThreadId ?? (ctx as any).threadId) || undefined,
    updatedAtMs: now,
    targetKey: "",
  };

  if (isSystemOnlyDeliveryRoute(snapshot)) {
    return null;
  }

  snapshot.targetKey = buildTargetKey(snapshot);
  if (!snapshot.targetKey) {
    return null;
  }

  if (!allowRouteOnly && !buildLiveTargetSender(ctx, snapshot)) {
    return null;
  }

  return snapshot;
}

function writeSnapshots(filePath: string, snapshots: RecentActiveDeliverySnapshot[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const state: RecentActiveDeliveryState = {
    version: 2,
    targets: sortSnapshots(snapshots),
  };
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

export function readRecentActiveDeliverySnapshots(customPath?: string): RecentActiveDeliverySnapshot[] {
  const filePath = resolveRecentActiveDeliveryPath(customPath);
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as any).targets)) {
      return sortSnapshots(
        (parsed as any).targets
          .map((item: unknown) => normalizeSnapshot(item))
          .filter((item: RecentActiveDeliverySnapshot | null): item is RecentActiveDeliverySnapshot => Boolean(item)),
      );
    }

    const legacySnapshot = normalizeSnapshot(parsed);
    return legacySnapshot ? [legacySnapshot] : [];
  } catch {
    return [];
  }
}

export function readSessionStoreDeliverySnapshots(): RecentActiveDeliverySnapshot[] {
  for (const sessionStorePath of resolveSessionStorePaths()) {
    if (!existsSync(sessionStorePath)) {
      continue;
    }

    try {
      const raw = readFileSync(sessionStorePath, "utf8");
      if (!raw) {
        continue;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      return sortSnapshots(
        Object.entries(parsed as Record<string, unknown>)
          .map(([sessionKey, entry]) => normalizeSessionStoreSnapshot(sessionKey, entry))
          .filter((snapshot: RecentActiveDeliverySnapshot | null): snapshot is RecentActiveDeliverySnapshot => Boolean(snapshot)),
      );
    } catch {
      continue;
    }
  }

  return [];
}

export function readRecentActiveDeliverySnapshot(customPath?: string): RecentActiveDeliverySnapshot | null {
  return readRecentActiveDeliverySnapshots(customPath)[0] ?? null;
}

export function rememberRecentActiveDeliveryTarget(
  ctx: EventContext,
  options?: { path?: string; now?: number; allowRouteOnly?: boolean },
): RecentActiveDeliverySnapshot | null {
  const now = typeof options?.now === "number" ? options.now : Date.now();
  const snapshot = options?.allowRouteOnly === true
    ? buildSnapshotWithOptions(ctx, now, true)
    : buildSnapshot(ctx, now);
  if (!snapshot) {
    return null;
  }

  const liveTargetSender = buildLiveTargetSender(ctx, snapshot);
  if (liveTargetSender) {
    liveTargets.set(snapshot.targetKey, liveTargetSender);
  }

  const nextSnapshots = readRecentActiveDeliverySnapshots(options?.path)
    .filter((item) => item.targetKey !== snapshot.targetKey);
  nextSnapshots.push(snapshot);
  writeSnapshots(resolveRecentActiveDeliveryPath(options?.path), nextSnapshots);
  return snapshot;
}

export function getRecentActiveDeliveryTargets(customPath?: string): RecentActiveDeliveryTarget[] {
  return readRecentActiveDeliverySnapshots(customPath)
    .map((snapshot) => {
      const sendMessage = liveTargets.get(snapshot.targetKey);
      if (typeof sendMessage !== "function") {
        return null;
      }

      return {
        ...snapshot,
        sendMessage,
      };
    })
    .filter((target: RecentActiveDeliveryTarget | null): target is RecentActiveDeliveryTarget => Boolean(target));
}

export function getRecentActiveDeliveryTarget(customPath?: string): RecentActiveDeliveryTarget | null {
  return getRecentActiveDeliveryTargets(customPath)[0] ?? null;
}

export function clearRecentActiveDeliveryTargetForContext(ctx: EventContext, customPath?: string): void {
  const candidates = new Set<string>();

  const sessionKey = normalizeString(ctx?.sessionKey);
  if (sessionKey) {
    candidates.add(sessionKey);
  }

  const channelId = normalizeString((ctx as any)?.channelId ?? (ctx as any)?.channel);
  const messageProvider = normalizeString((ctx as any)?.messageProvider ?? (ctx as any)?.source);
  const senderId = normalizeString((ctx as any)?.senderId ?? (ctx as any)?.userId);
  const targetKey = buildTargetKey({ sessionKey, channelId, messageProvider, senderId });
  if (targetKey) {
    candidates.add(targetKey);
  }

  for (const candidate of candidates) {
    liveTargets.delete(candidate);
  }

  const currentSnapshots = readRecentActiveDeliverySnapshots(customPath);
  if (currentSnapshots.length === 0) {
    return;
  }

  const nextSnapshots = currentSnapshots.filter((snapshot) => {
    if (candidates.has(snapshot.targetKey)) {
      return false;
    }
    if (sessionKey.length > 0 && snapshot.sessionKey === sessionKey) {
      return false;
    }
    return true;
  });

  const filePath = resolveRecentActiveDeliveryPath(customPath);
  if (nextSnapshots.length === 0) {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return;
  }

  writeSnapshots(filePath, nextSnapshots);
}

export function shouldPreferRecentActiveDelivery(
  ctx: EventContext,
  deliveryMode: ScheduledLynxDeliveryMode,
): boolean {
  return deliveryMode === "recent-active"
    && normalizeString((ctx as any)?.subsystem).toLowerCase() === "plugins";
}

export function resetRecentActiveDeliveryTargets(customPath?: string): void {
  liveTargets.clear();
  const filePath = resolveRecentActiveDeliveryPath(customPath);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
