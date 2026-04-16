import type { ToolApprovalResolution } from "../types.js";
import type { ApprovalRiskLevel } from "./approval-grant-store.js";

export type PendingToolApproval = {
  pendingId: string;
  runId: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  createdAt: number;
  expiresAt: number;
  wait: () => Promise<ToolApprovalResolution>;
  settle: (resolution: ToolApprovalResolution) => void;
};

type PendingToolApprovalEntry = {
  pendingId: string;
  runId: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  createdAt: number;
  expiresAt: number;
  promise: Promise<ToolApprovalResolution>;
  resolvePromise: (resolution: ToolApprovalResolution) => void;
  timer: ReturnType<typeof setTimeout>;
  settled: boolean;
};

const pendingByRunId = new Map<string, PendingToolApprovalEntry[]>();
const pendingById = new Map<string, PendingToolApprovalEntry>();

const RISK_ORDER: Record<ApprovalRiskLevel, number> = {
  L2: 2,
  L3: 3,
};

function removePendingEntry(entry: PendingToolApprovalEntry): void {
  pendingById.delete(entry.pendingId);

  const current = pendingByRunId.get(entry.runId) ?? [];
  const next = current.filter((candidate) => candidate.pendingId !== entry.pendingId);
  if (next.length === 0) {
    pendingByRunId.delete(entry.runId);
    return;
  }
  pendingByRunId.set(entry.runId, next);
}

function settlePendingEntry(
  entry: PendingToolApprovalEntry,
  resolution: ToolApprovalResolution,
): void {
  if (entry.settled) {
    return;
  }

  entry.settled = true;
  clearTimeout(entry.timer);
  removePendingEntry(entry);
  entry.resolvePromise(resolution);
}

function toPublicPending(entry: PendingToolApprovalEntry): PendingToolApproval {
  return {
    pendingId: entry.pendingId,
    runId: entry.runId,
    requesterOuId: entry.requesterOuId,
    module: entry.module,
    maxRiskLevel: entry.maxRiskLevel,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    wait: () => entry.promise,
    settle: (resolution) => {
      settlePendingEntry(entry, resolution);
    },
  };
}

function prune(now: number = Date.now()): void {
  for (const entry of pendingById.values()) {
    if (entry.expiresAt <= now) {
      settlePendingEntry(entry, "timeout");
    }
  }
}

function matchPendingEntry(input: {
  runId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
}): PendingToolApprovalEntry | undefined {
  if (!input.runId) {
    return undefined;
  }

  prune();
  const candidates = pendingByRunId.get(input.runId) ?? [];
  return candidates.find(
    (entry) =>
      !entry.settled
      && entry.requesterOuId === input.requesterOuId
      && entry.module === input.module
      && RISK_ORDER[entry.maxRiskLevel] >= RISK_ORDER[input.riskLevel],
  );
}

export function getOrCreatePendingToolApproval(params: {
  runId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  timeoutMs: number;
  pendingId: string;
}): { created: boolean; pending?: PendingToolApproval } {
  if (!params.runId) {
    return { created: false };
  }

  const existing = matchPendingEntry(params);
  if (existing) {
    return {
      created: false,
      pending: toPublicPending(existing),
    };
  }

  const createdAt = Date.now();
  let resolvePromise!: (resolution: ToolApprovalResolution) => void;
  const promise = new Promise<ToolApprovalResolution>((resolve) => {
    resolvePromise = resolve;
  });

  const entry: PendingToolApprovalEntry = {
    pendingId: params.pendingId,
    runId: params.runId,
    requesterOuId: params.requesterOuId,
    module: params.module,
    maxRiskLevel: params.riskLevel,
    createdAt,
    expiresAt: createdAt + params.timeoutMs,
    promise,
    resolvePromise,
    timer: null as unknown as ReturnType<typeof setTimeout>,
    settled: false,
  };

  entry.timer = setTimeout(() => {
    settlePendingEntry(entry, "timeout");
  }, params.timeoutMs);

  pendingById.set(entry.pendingId, entry);
  const current = pendingByRunId.get(entry.runId) ?? [];
  pendingByRunId.set(entry.runId, [...current, entry]);

  return {
    created: true,
    pending: toPublicPending(entry),
  };
}

export function clearPendingToolApprovals(): void {
  for (const entry of pendingById.values()) {
    clearTimeout(entry.timer);
  }
  pendingByRunId.clear();
  pendingById.clear();
}
