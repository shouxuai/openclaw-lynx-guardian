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

interface RecentActiveDeliveryState {
  version: 2;
  targets: RecentActiveDeliverySnapshot[];
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

function normalizeSnapshot(value: unknown): RecentActiveDeliverySnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  const targetKey = normalizeString(parsed.targetKey);
  if (!targetKey) {
    return null;
  }

  return {
    targetKey,
    sessionKey: normalizeString(parsed.sessionKey) || undefined,
    channelId: normalizeString(parsed.channelId) || undefined,
    messageProvider: normalizeString(parsed.messageProvider) || undefined,
    senderId: normalizeString(parsed.senderId) || undefined,
    bindingId: normalizeString(parsed.bindingId) || undefined,
    updatedAtMs: typeof parsed.updatedAtMs === "number" ? parsed.updatedAtMs : 0,
  };
}

function sortSnapshots(snapshots: RecentActiveDeliverySnapshot[]): RecentActiveDeliverySnapshot[] {
  return [...snapshots].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
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

export function readRecentActiveDeliverySnapshot(customPath?: string): RecentActiveDeliverySnapshot | null {
  return readRecentActiveDeliverySnapshots(customPath)[0] ?? null;
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
