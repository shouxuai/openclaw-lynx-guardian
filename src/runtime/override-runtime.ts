import { createHash } from "crypto";
import type { EventContext } from "../types.js";
import { savePendingOverride } from "./pending-override-store.js";
import type { PendingOverride } from "./pending-override-store.js";

const approvedOverrides = new Map<string, { operationFingerprint: string; expiresAt: number }>();

function pruneApprovedOverrides(now: number = Date.now()): void {
  for (const [sessionKey, approved] of approvedOverrides) {
    if (approved.expiresAt <= now) {
      approvedOverrides.delete(sessionKey);
    }
  }
}

export function buildOperationFingerprint(params: {
  sessionKey?: string;
  actionType: "input" | "tool" | "agent_start";
  payload: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(params))
    .digest("hex");
}

export function resolveOverrideKeys(ctx: EventContext): string[] {
  const keys = new Set<string>();
  if (ctx.sessionKey) keys.add(ctx.sessionKey);
  if (ctx.channelId) keys.add(ctx.channelId);
  return [...keys];
}

export function resolveOverrideKey(ctx: EventContext): string | undefined {
  return ctx.channelId ?? ctx.sessionKey;
}

export function savePendingOverrideFull(ctx: EventContext, override: PendingOverride): void {
  for (const key of resolveOverrideKeys(ctx)) {
    savePendingOverride(key, override);
  }
}

export function approvePendingOverrideFull(ctx: EventContext, pending: PendingOverride): void {
  const allKeys = new Set<string>([
    ...resolveOverrideKeys(ctx),
    ...pending.sourceKeys,
  ]);
  const entry = {
    operationFingerprint: pending.operationFingerprint,
    expiresAt: pending.expiresAt,
  };
  pruneApprovedOverrides();
  for (const key of allKeys) {
    approvedOverrides.set(key, entry);
  }
}

export function consumeApprovedOverrideFull(ctx: EventContext, fingerprint: string): boolean {
  pruneApprovedOverrides();
  for (const key of resolveOverrideKeys(ctx)) {
    const approved = approvedOverrides.get(key);
    if (approved?.operationFingerprint === fingerprint) {
      for (const candidateKey of resolveOverrideKeys(ctx)) {
        if (approvedOverrides.get(candidateKey)?.operationFingerprint === fingerprint) {
          approvedOverrides.delete(candidateKey);
        }
      }
      return true;
    }
  }
  return false;
}
