import type { RiskLevel } from "../guard/safety-guard.js";

export interface PendingOverride {
  operationFingerprint: string;
  createdAt: number;
  expiresAt: number;
  actionType: "input" | "tool" | "agent_start";
  replayPayload: unknown;
  riskScore: number;
  riskLevel: RiskLevel;
  matchedModules: string[];
  sourceKeys: string[];
}

const pendingOverrides = new Map<string, PendingOverride>();

function isExpired(override: PendingOverride, now: number): boolean {
  return override.expiresAt <= now;
}

function pruneExpired(now: number): void {
  for (const [sessionKey, override] of pendingOverrides) {
    if (isExpired(override, now)) {
      pendingOverrides.delete(sessionKey);
    }
  }
}

export function savePendingOverride(sessionKey: string, override: PendingOverride): void {
  if (!sessionKey) {
    return;
  }
  const now = Date.now();
  pruneExpired(now);
  if (isExpired(override, now)) {
    pendingOverrides.delete(sessionKey);
    return;
  }
  const existing = pendingOverrides.get(sessionKey);
  const existingSourceKeys = Array.isArray(existing?.sourceKeys) ? existing.sourceKeys : null;
  const nextSourceKeys = Array.isArray(override.sourceKeys) ? override.sourceKeys : null;

  if (existing && !isExpired(existing, now) && existingSourceKeys && nextSourceKeys) {
    const merged = [...new Set([...existing.matchedModules, ...override.matchedModules])];
    existing.matchedModules = merged;
    existing.sourceKeys = [...new Set([...existingSourceKeys, ...nextSourceKeys])];
    return;
  }

  pendingOverrides.set(
    sessionKey,
    nextSourceKeys
      ? { ...override, sourceKeys: nextSourceKeys }
      : ({ ...override } as PendingOverride),
  );
}

export function getPendingOverride(sessionKey: string): PendingOverride | undefined {
  if (!sessionKey) {
    return undefined;
  }
  const now = Date.now();
  pruneExpired(now);
  const override = pendingOverrides.get(sessionKey);
  if (!override) {
    return undefined;
  }
  if (isExpired(override, now)) {
    pendingOverrides.delete(sessionKey);
    return undefined;
  }
  return override;
}

export function consumePendingOverride(sessionKey: string): PendingOverride | undefined {
  if (!sessionKey) {
    return undefined;
  }
  const now = Date.now();
  pruneExpired(now);
  const override = pendingOverrides.get(sessionKey);
  if (!override) {
    return undefined;
  }
  pendingOverrides.delete(sessionKey);
  if (isExpired(override, now)) {
    return undefined;
  }
  return override;
}

export function clearPendingOverride(sessionKey: string): void {
  if (!sessionKey) {
    return;
  }
  pendingOverrides.delete(sessionKey);
}

export function consumeMostRecentPendingOverride(): PendingOverride | undefined {
  const now = Date.now();
  pruneExpired(now);
  if (pendingOverrides.size === 0) return undefined;

  let bestKey: string | undefined;
  let best: PendingOverride | undefined;
  for (const [key, override] of pendingOverrides) {
    if (!best || override.createdAt > best.createdAt) {
      best = override;
      bestKey = key;
    }
  }
  if (!best || !bestKey) return undefined;

  for (const [key, override] of pendingOverrides) {
    if (override === best) pendingOverrides.delete(key);
  }

  return best;
}
