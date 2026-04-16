import type { ToolApprovalResolution } from "../types.js";
import type { ApprovalRiskLevel } from "./approval-grant-store.js";

export type LocalToolApproval = {
  approvalToken: string;
  pendingId: string;
  runId: string;
  sessionKey?: string;
  channelId?: string;
  requesterOuId?: string;
  approverOuIds: string[];
  conversationId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  toolName: string;
  createdAt: number;
  expiresAt: number;
  resolve: (resolution: ToolApprovalResolution) => void;
};

type LocalToolApprovalEntry = Omit<LocalToolApproval, "resolve"> & {
  dedupKey: string;
  settled: boolean;
  timer: ReturnType<typeof setTimeout>;
  executeResolution: (resolution: ToolApprovalResolution) => void;
};

const approvalsByToken = new Map<string, LocalToolApprovalEntry>();
const latestTokenByDedupKey = new Map<string, string>();

const RISK_ORDER: Record<ApprovalRiskLevel, number> = {
  L2: 2,
  L3: 3,
};

let approvalSequence = 0;

function buildDedupKey(input: {
  runId: string;
  sessionKey?: string;
  requesterOuId?: string;
  module: string;
}): string {
  return [
    input.runId,
    input.sessionKey ?? "",
    input.requesterOuId ?? "",
    input.module,
  ].join(":");
}

function nextApprovalToken(): string {
  approvalSequence += 1;
  return approvalSequence.toString(36).padStart(6, "0");
}

function removeApprovalEntry(entry: LocalToolApprovalEntry): void {
  approvalsByToken.delete(entry.approvalToken);
  if (latestTokenByDedupKey.get(entry.dedupKey) === entry.approvalToken) {
    latestTokenByDedupKey.delete(entry.dedupKey);
  }
}

function settleApprovalEntry(
  entry: LocalToolApprovalEntry,
  resolution: ToolApprovalResolution,
): void {
  if (entry.settled) {
    return;
  }

  entry.settled = true;
  clearTimeout(entry.timer);
  removeApprovalEntry(entry);
  entry.executeResolution(resolution);
}

function toPublicApproval(entry: LocalToolApprovalEntry): LocalToolApproval {
  return {
    approvalToken: entry.approvalToken,
    pendingId: entry.pendingId,
    runId: entry.runId,
    sessionKey: entry.sessionKey,
    channelId: entry.channelId,
    requesterOuId: entry.requesterOuId,
    approverOuIds: [...entry.approverOuIds],
    conversationId: entry.conversationId,
    module: entry.module,
    maxRiskLevel: entry.maxRiskLevel,
    toolName: entry.toolName,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    resolve: (resolution) => {
      settleApprovalEntry(entry, resolution);
    },
  };
}

function prune(now: number = Date.now()): void {
  for (const entry of approvalsByToken.values()) {
    if (entry.expiresAt <= now) {
      settleApprovalEntry(entry, "timeout");
    }
  }
}

export function registerLocalToolApproval(params: {
  pendingId: string;
  runId?: string;
  sessionKey?: string;
  channelId?: string;
  requesterOuId?: string;
  approverOuIds?: string[];
  conversationId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  toolName: string;
  timeoutMs: number;
  onResolution: (resolution: ToolApprovalResolution) => void;
}): { created: boolean; approval?: LocalToolApproval } {
  if (!params.runId || !params.sessionKey) {
    return { created: false };
  }

  prune();
  const dedupKey = buildDedupKey({
    runId: params.runId,
    sessionKey: params.sessionKey,
    requesterOuId: params.requesterOuId,
    module: params.module,
  });

  const existingToken = latestTokenByDedupKey.get(dedupKey);
  if (existingToken) {
    const existing = approvalsByToken.get(existingToken);
    if (
      existing
      && !existing.settled
      && RISK_ORDER[existing.maxRiskLevel] >= RISK_ORDER[params.riskLevel]
    ) {
      return {
        created: false,
        approval: toPublicApproval(existing),
      };
    }
  }

  const createdAt = Date.now();
  const approvalToken = nextApprovalToken();
  const entry: LocalToolApprovalEntry = {
    approvalToken,
    pendingId: params.pendingId,
    runId: params.runId,
    sessionKey: params.sessionKey,
    channelId: params.channelId,
    requesterOuId: params.requesterOuId,
    approverOuIds: [...(params.approverOuIds ?? [])],
    conversationId: params.conversationId,
    module: params.module,
    maxRiskLevel: params.riskLevel,
    toolName: params.toolName,
    createdAt,
    expiresAt: createdAt + params.timeoutMs,
    dedupKey,
    settled: false,
    timer: null as unknown as ReturnType<typeof setTimeout>,
    executeResolution: params.onResolution,
  };

  entry.timer = setTimeout(() => {
    settleApprovalEntry(entry, "timeout");
  }, params.timeoutMs);

  approvalsByToken.set(entry.approvalToken, entry);
  latestTokenByDedupKey.set(dedupKey, entry.approvalToken);

  return {
    created: true,
    approval: toPublicApproval(entry),
  };
}

export function readLocalToolApprovalByToken(token?: string): LocalToolApproval | undefined {
  prune();

  if (!token) {
    return undefined;
  }

  const approval = approvalsByToken.get(token.toLowerCase());
  return approval ? toPublicApproval(approval) : undefined;
}

export function listLocalToolApprovalsForSession(input: {
  sessionKey?: string;
}): LocalToolApproval[] {
  prune();

  if (!input.sessionKey) {
    return [];
  }

  return [...approvalsByToken.values()]
    .filter(
      (entry) =>
        !entry.settled
        && entry.sessionKey === input.sessionKey,
    )
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((entry) => toPublicApproval(entry));
}

export function discardLocalToolApproval(token?: string): void {
  prune();

  if (!token) {
    return;
  }

  const entry = approvalsByToken.get(token.toLowerCase());
  if (!entry) {
    return;
  }

  clearTimeout(entry.timer);
  removeApprovalEntry(entry);
}
export function clearLocalToolApprovals(): void {
  for (const entry of approvalsByToken.values()) {
    clearTimeout(entry.timer);
  }
  approvalsByToken.clear();
  latestTokenByDedupKey.clear();
  approvalSequence = 0;
}
