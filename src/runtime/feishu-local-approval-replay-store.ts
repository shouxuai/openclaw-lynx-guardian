/**
 * Task 11 ownership: Feishu local approval replay bridge.
 * This remains a one-shot channel recovery store, not durable grant state.
 */
export type FeishuLocalApprovalReplay = {
  approvalToken: string;
  sessionKey?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  promptText: string;
  createdAt: number;
  expiresAt: number;
};

const replayByKey = new Map<string, FeishuLocalApprovalReplay>();

function buildReplayKey(input: {
  approvalToken?: string;
  sessionKey?: string;
}): string | undefined {
  const approvalToken = input.approvalToken?.trim().toLowerCase();
  if (!approvalToken) {
    return undefined;
  }

  return [input.sessionKey ?? "", approvalToken].join("::");
}

function prune(now: number = Date.now()): void {
  for (const [key, replay] of replayByKey) {
    if (replay.expiresAt <= now) {
      replayByKey.delete(key);
    }
  }
}

export function saveFeishuLocalApprovalReplay(replay: FeishuLocalApprovalReplay): void {
  const key = buildReplayKey(replay);
  if (!key) {
    return;
  }

  prune();
  replayByKey.set(key, { ...replay });
}

export function consumeFeishuLocalApprovalReplay(input: {
  approvalToken?: string;
  sessionKey?: string;
}): FeishuLocalApprovalReplay | undefined {
  const key = buildReplayKey(input);
  if (!key) {
    return undefined;
  }

  prune();
  const replay = replayByKey.get(key);
  if (!replay) {
    return undefined;
  }

  replayByKey.delete(key);
  return { ...replay };
}

export function clearFeishuLocalApprovalReplays(): void {
  replayByKey.clear();
}
