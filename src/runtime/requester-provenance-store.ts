export type ChannelProfile = "webchat" | "feishu" | "other";
export type ApprovalTransportProfile = "native" | "local-chat" | "none";

export type RequesterProvenance = {
  sessionKey?: string;
  channelId?: string;
  channelProfile?: ChannelProfile;
  approvalTransport?: ApprovalTransportProfile;
  requesterId?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  isGroup: boolean;
  timestamp: number;
};

export const REQUESTER_PROVENANCE_TTL_MS = 10 * 60 * 1000;

const provenanceBySession = new Map<string, RequesterProvenance>();
const provenanceByChannel = new Map<string, RequesterProvenance>();
const provenanceByConversation = new Map<string, RequesterProvenance>();
const pendingProvenanceBySession = new Map<string, RequesterProvenance[]>();

function buildConversationKey(input: {
  channelId?: string;
  accountId?: string;
  conversationId?: string;
}): string | undefined {
  if (!input.conversationId) {
    return undefined;
  }

  return [
    input.channelId ?? "",
    input.accountId ?? "",
    input.conversationId,
  ].join("::");
}

function isExpired(record: RequesterProvenance, now: number): boolean {
  return record.timestamp + REQUESTER_PROVENANCE_TTL_MS <= now;
}

function prune(now: number = Date.now()): void {
  for (const [key, record] of provenanceBySession) {
    if (isExpired(record, now)) {
      provenanceBySession.delete(key);
    }
  }

  for (const [key, record] of provenanceByChannel) {
    if (isExpired(record, now)) {
      provenanceByChannel.delete(key);
    }
  }

  for (const [key, record] of provenanceByConversation) {
    if (isExpired(record, now)) {
      provenanceByConversation.delete(key);
    }
  }
  for (const [key, records] of pendingProvenanceBySession) {
    const active = records.filter((record) => !isExpired(record, now));
    if (active.length === 0) {
      pendingProvenanceBySession.delete(key);
      continue;
    }
    pendingProvenanceBySession.set(key, active);
  }
}

export function rememberRequesterProvenance(record: RequesterProvenance): void {
  prune();

  const normalized = { ...record };
  if (normalized.sessionKey) {
    provenanceBySession.set(normalized.sessionKey, normalized);
    const current = pendingProvenanceBySession.get(normalized.sessionKey) ?? [];
    pendingProvenanceBySession.set(normalized.sessionKey, [...current, normalized]);
  }
  if (normalized.channelId) {
    provenanceByChannel.set(normalized.channelId, normalized);
  }
  const conversationKey = buildConversationKey(normalized);
  if (conversationKey) {
    provenanceByConversation.set(conversationKey, normalized);
  }
}

export function claimRequesterProvenance(input: {
  sessionKey?: string;
}): RequesterProvenance | undefined {
  prune();

  if (!input.sessionKey) {
    return undefined;
  }

  const current = pendingProvenanceBySession.get(input.sessionKey) ?? [];
  if (current.length === 0) {
    pendingProvenanceBySession.delete(input.sessionKey);
    return undefined;
  }

  const [claimed, ...remaining] = current;
  if (remaining.length === 0) {
    pendingProvenanceBySession.delete(input.sessionKey);
  } else {
    pendingProvenanceBySession.set(input.sessionKey, remaining);
  }

  return claimed;
}

export function readRequesterProvenance(input: {
  sessionKey?: string;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
}): RequesterProvenance | undefined {
  prune();

  const sessionHit = input.sessionKey ? provenanceBySession.get(input.sessionKey) : undefined;
  const channelHit = input.channelId ? provenanceByChannel.get(input.channelId) : undefined;
  const conversationKey = buildConversationKey(input);
  const conversationHit = conversationKey ? provenanceByConversation.get(conversationKey) : undefined;

  return [sessionHit, conversationHit, channelHit]
    .filter((record): record is RequesterProvenance => Boolean(record))
    .sort((left, right) => right.timestamp - left.timestamp)[0];
}

export function clearRequesterProvenanceStore(): void {
  provenanceBySession.clear();
  provenanceByChannel.clear();
  provenanceByConversation.clear();
  pendingProvenanceBySession.clear();
}
