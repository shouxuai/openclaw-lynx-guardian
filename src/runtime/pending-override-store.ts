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
  const existing = pendingOverrides.get(sessionKey);
  if (existing && !isExpired(existing, now)) {
    // A pending override already exists for this key (another tool call in the same
    // agent run was also blocked). Merge the module lists so the eventual workflow
    // auth covers all blocked modules — but keep the original override object so
    // the first-blocked operation's fingerprint stays as the canonical confirmation target.
    const merged = [...new Set([...existing.matchedModules, ...override.matchedModules])];
    existing.matchedModules = merged;
    // Also union sourceKeys so cross-key lookups remain valid.
    existing.sourceKeys = [...new Set([...existing.sourceKeys, ...override.sourceKeys])];
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

/**
 * Fallback: find and consume the most recently created non-expired pending override
 * across ALL stored keys.
 *
 * Used when the confirmation arrives in a handler (message_received) whose ctx only
 * has channelId, while the override was saved in a handler (before_tool_call) that
 * only had sessionKey — so the normal key-based lookup returns undefined.
 *
 * Returns the override and removes every key that pointed to the same object.
 */
export function consumeMostRecentPendingOverride(): PendingOverride | undefined {
  const now = Date.now();
  pruneExpired(now);
  if (pendingOverrides.size === 0) return undefined;

  // Find the entry with the largest createdAt (most recent).
  let bestKey: string | undefined;
  let best: PendingOverride | undefined;
  for (const [key, override] of pendingOverrides) {
    if (!best || override.createdAt > best.createdAt) {
      best = override;
      bestKey = key;
    }
  }
  if (!best || !bestKey) return undefined;

  // Remove every key that points to the same object (covers multi-key saves).
  for (const [key, override] of pendingOverrides) {
    if (override === best) pendingOverrides.delete(key);
  }

  return best;
}
