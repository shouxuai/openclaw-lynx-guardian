/**
 * Task 11 ownership: plugin-side approval bridge.
 * This store holds ephemeral resolver callbacks that cannot live in Go.
 */
import type { ToolApprovalResolution } from "../types.js";
import type { ApprovalRiskLevel } from "./approval-grant-store.js";
import type { ChannelProfile } from "./requester-provenance-store.js";

export type LocalToolApproval = {
  approvalToken: string;
  pendingId: string;
  sessionKey?: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  requesterOuId?: string;
  requestFingerprint?: string;
  approverOuIds: string[];
  conversationId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  toolName: string;
  promptText?: string;
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

function buildDedupKey(input: {
  sessionKey?: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  requestFingerprint?: string;
  module: string;
}): string | undefined {
  if (input.channelProfile === "feishu") {
    const requestFingerprint = input.requestFingerprint?.trim();
    if (!requestFingerprint) {
      return undefined;
    }

    return [
      input.channelProfile,
      input.channelId ?? "",
      input.accountId ?? "",
      input.conversationId ?? "",
      input.requesterOuId ?? "",
      requestFingerprint,
      input.module,
    ].join("::");
  }

  const sourceParts = [
    input.channelProfile ?? "",
    input.channelId ?? "",
    input.accountId ?? "",
    input.conversationId ?? "",
    input.requesterOuId ?? "",
  ];
  if (sourceParts.some((part) => part.length > 0)) {
    return [...sourceParts, input.module].join("::");
  }

  if (input.sessionKey) {
    return [input.sessionKey, input.module].join("::");
  }

  return undefined;
}

let approvalSequence = 0;

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
    sessionKey: entry.sessionKey,
    channelProfile: entry.channelProfile,
    channelId: entry.channelId,
    accountId: entry.accountId,
    requesterOuId: entry.requesterOuId,
    requestFingerprint: entry.requestFingerprint,
    approverOuIds: [...entry.approverOuIds],
    conversationId: entry.conversationId,
    module: entry.module,
    maxRiskLevel: entry.maxRiskLevel,
    toolName: entry.toolName,
    promptText: entry.promptText,
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
  sessionKey?: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  requesterOuId?: string;
  requestFingerprint?: string;
  approverOuIds?: string[];
  conversationId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  toolName: string;
  promptText?: string;
  timeoutMs: number;
  onResolution: (resolution: ToolApprovalResolution) => void;
}): { created: boolean; approval?: LocalToolApproval } {
  const dedupKey = buildDedupKey({
    sessionKey: params.sessionKey,
    channelProfile: params.channelProfile,
    channelId: params.channelId,
    accountId: params.accountId,
    conversationId: params.conversationId,
    requesterOuId: params.requesterOuId,
    requestFingerprint: params.requestFingerprint,
    module: params.module,
  });
  if (!dedupKey) {
    return { created: false };
  }

  prune();
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
    sessionKey: params.sessionKey,
    channelProfile: params.channelProfile,
    channelId: params.channelId,
    accountId: params.accountId,
    requesterOuId: params.requesterOuId,
    requestFingerprint: params.requestFingerprint,
    approverOuIds: [...(params.approverOuIds ?? [])],
    conversationId: params.conversationId,
    module: params.module,
    maxRiskLevel: params.riskLevel,
    toolName: params.toolName,
    promptText: params.promptText,
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
    .filter((entry) => !entry.settled && entry.sessionKey === input.sessionKey)
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
