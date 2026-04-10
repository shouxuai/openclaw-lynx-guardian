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
  updatedAtMs: number;
}

export interface RecentActiveDeliverySnapshot extends RecentActiveRouteHint {}

export interface RecentActiveDeliveryTarget extends RecentActiveRouteHint {
  sendMessage: (message: Message) => Promise<void>;
}

const liveTargets = new Map<string, RecentActiveDeliveryTarget["sendMessage"]>();

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

function buildTargetKey(parts: {
  sessionKey?: string;
  channelId?: string;
  messageProvider?: string;
  senderId?: string;
}): string {
  if (parts.sessionKey) {
    return parts.sessionKey;
  }

  return [parts.messageProvider, parts.channelId, parts.senderId]
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .join(":");
}

function buildSnapshot(ctx: EventContext, now: number): RecentActiveRouteHint | null {
  if (!ctx || typeof ctx.sendMessage !== "function") {
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
    updatedAtMs: now,
    targetKey: "",
  };

  snapshot.targetKey = buildTargetKey(snapshot);
  if (!snapshot.targetKey) {
    return null;
  }

  return snapshot;
}

function writeSnapshot(filePath: string, snapshot: RecentActiveRouteHint): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(snapshot), "utf8");
}

export function readRecentActiveDeliverySnapshot(customPath?: string): RecentActiveDeliverySnapshot | null {
  const filePath = resolveRecentActiveDeliveryPath(customPath);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const snapshot: RecentActiveRouteHint = {
      targetKey: normalizeString((parsed as any).targetKey),
      sessionKey: normalizeString((parsed as any).sessionKey) || undefined,
      channelId: normalizeString((parsed as any).channelId) || undefined,
      messageProvider: normalizeString((parsed as any).messageProvider) || undefined,
      senderId: normalizeString((parsed as any).senderId) || undefined,
      bindingId: normalizeString((parsed as any).bindingId) || undefined,
      updatedAtMs: typeof (parsed as any).updatedAtMs === "number" ? (parsed as any).updatedAtMs : 0,
    };

    if (!snapshot.targetKey) {
      return null;
    }

    return snapshot;
  } catch {
    return null;
  }
}

export function rememberRecentActiveDeliveryTarget(
  ctx: EventContext,
  options?: { path?: string; now?: number },
): RecentActiveDeliverySnapshot | null {
  const now = typeof options?.now === "number" ? options.now : Date.now();
  const snapshot = buildSnapshot(ctx, now);
  if (!snapshot) {
    return null;
  }

  liveTargets.set(snapshot.targetKey, ctx.sendMessage!);
  writeSnapshot(resolveRecentActiveDeliveryPath(options?.path), snapshot);
  return snapshot;
}

export function getRecentActiveDeliveryTarget(customPath?: string): RecentActiveDeliveryTarget | null {
  const snapshot = readRecentActiveDeliverySnapshot(customPath);
  if (!snapshot) {
    return null;
  }

  const sendMessage = liveTargets.get(snapshot.targetKey);
  if (typeof sendMessage !== "function") {
    return null;
  }

  return {
    ...snapshot,
    sendMessage,
  };
}

export function clearRecentActiveDeliveryTargetForContext(ctx: EventContext, customPath?: string): void {
  const current = readRecentActiveDeliverySnapshot(customPath);
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

  if (!current) {
    return;
  }

  const matchesCurrent = candidates.has(current.targetKey)
    || (sessionKey.length > 0 && current.sessionKey === sessionKey);

  if (!matchesCurrent) {
    return;
  }

  const filePath = resolveRecentActiveDeliveryPath(customPath);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
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
