import type {
  ApprovalTransportProfile,
  ChannelProfile,
} from "../runtime/requester-provenance-store.js";

export {
  claimRequesterProvenance,
  clearRequesterProvenanceStore,
  readRequesterProvenance,
  rememberRequesterProvenance,
} from "../runtime/requester-provenance-store.js";

export type RunApprovalContext = {
  runId: string;
  sessionKey?: string;
  channelProfile?: ChannelProfile;
  approvalTransport?: ApprovalTransportProfile;
  requesterId?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  promptText?: string;
  threadId?: string | number;
  isGroup: boolean;
  createdAt: number;
  expiresAt: number;
};

const runApprovalContexts = new Map<string, RunApprovalContext>();

function pruneRunApprovalContexts(now: number = Date.now()): void {
  for (const [runId, context] of runApprovalContexts) {
    if (context.expiresAt <= now) {
      runApprovalContexts.delete(runId);
    }
  }
}

export function saveRunApprovalContext(context: RunApprovalContext): void {
  pruneRunApprovalContexts();
  runApprovalContexts.set(context.runId, { ...context });
}

export function readRunApprovalContext(runId?: string): RunApprovalContext | undefined {
  if (!runId) {
    return undefined;
  }

  pruneRunApprovalContexts();
  const context = runApprovalContexts.get(runId);
  return context ? { ...context } : undefined;
}

export function clearRunApprovalContexts(): void {
  runApprovalContexts.clear();
}
