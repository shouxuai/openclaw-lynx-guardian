/**
 * Task 11 ownership: Feishu continuation bridge.
 * This store is a short local window for channel approval replay only.
 */
import type { ApprovalRiskLevel } from "./approval-grant-store.js";
import type { ChannelProfile } from "./requester-provenance-store.js";

export type FeishuRunContinuation = {
  runId: string;
  channelProfile: "feishu";
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  createdAt: number;
  expiresAt: number;
};

const continuationByRunId = new Map<string, FeishuRunContinuation[]>();

const RISK_ORDER: Record<ApprovalRiskLevel, number> = {
  L2: 2,
  L3: 3,
};

function prune(now: number = Date.now()): void {
  for (const [runId, windows] of continuationByRunId) {
    const active = windows.filter((window) => window.expiresAt > now);
    if (active.length === 0) {
      continuationByRunId.delete(runId);
      continue;
    }
    continuationByRunId.set(runId, active);
  }
}

export function saveFeishuRunContinuation(window: FeishuRunContinuation): void {
  if (window.channelProfile !== "feishu") {
    return;
  }

  prune();
  const current = continuationByRunId.get(window.runId) ?? [];
  const next = current.filter(
    (entry) => !(entry.module === window.module && entry.requesterOuId === window.requesterOuId),
  );
  continuationByRunId.set(window.runId, [...next, { ...window }]);
}

export function matchFeishuRunContinuation(input: {
  runId?: string;
  channelProfile?: ChannelProfile;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
}): FeishuRunContinuation | undefined {
  if (!input.runId || input.channelProfile !== "feishu") {
    return undefined;
  }

  prune();
  const windows = continuationByRunId.get(input.runId) ?? [];
  const matched = windows.find(
    (window) =>
      window.requesterOuId === input.requesterOuId
      && window.module === input.module
      && RISK_ORDER[window.maxRiskLevel] >= RISK_ORDER[input.riskLevel],
  );
  return matched ? { ...matched } : undefined;
}

export function clearFeishuRunContinuations(): void {
  continuationByRunId.clear();
}
