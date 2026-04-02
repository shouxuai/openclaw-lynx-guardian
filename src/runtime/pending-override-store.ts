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
  /**
   * All keys under which this override was saved (e.g. sessionKey + channelId).
   * Stored so that when the user confirms in a handler where only one key is
   * available (e.g. channelId in message_received), the approval can be
   * registered under every key the tool handler might later look up.
   */
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
  pendingOverrides.set(sessionKey, override);
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
