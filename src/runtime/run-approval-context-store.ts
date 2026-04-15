export type RunApprovalContext = {
  runId: string;
  sessionKey?: string;
  requesterId?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  isGroup: boolean;
  createdAt: number;
  expiresAt: number;
};

const runApprovalContexts = new Map<string, RunApprovalContext>();

function prune(now: number = Date.now()): void {
  for (const [runId, context] of runApprovalContexts) {
    if (context.expiresAt <= now) {
      runApprovalContexts.delete(runId);
    }
  }
}

export function saveRunApprovalContext(context: RunApprovalContext): void {
  prune();
  runApprovalContexts.set(context.runId, { ...context });
}

export function readRunApprovalContext(runId?: string): RunApprovalContext | undefined {
  if (!runId) {
    return undefined;
  }

  prune();
  return runApprovalContexts.get(runId);
}

export function clearRunApprovalContexts(): void {
  runApprovalContexts.clear();
}
