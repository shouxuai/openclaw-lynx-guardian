export type RequesterProvenance = {
  sessionKey?: string;
  channelId?: string;
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
}

export function rememberRequesterProvenance(record: RequesterProvenance): void {
  prune();

  const normalized = { ...record };
  if (normalized.sessionKey) {
    provenanceBySession.set(normalized.sessionKey, normalized);
  }
  if (normalized.channelId) {
    provenanceByChannel.set(normalized.channelId, normalized);
  }
}

export function readRequesterProvenance(input: {
  sessionKey?: string;
  channelId?: string;
}): RequesterProvenance | undefined {
  prune();

  const sessionHit = input.sessionKey ? provenanceBySession.get(input.sessionKey) : undefined;
  const channelHit = input.channelId ? provenanceByChannel.get(input.channelId) : undefined;

  if (!sessionHit) {
    return channelHit;
  }
  if (!channelHit) {
    return sessionHit;
  }
  return sessionHit.timestamp >= channelHit.timestamp ? sessionHit : channelHit;
}

export function clearRequesterProvenanceStore(): void {
  provenanceBySession.clear();
  provenanceByChannel.clear();
}
