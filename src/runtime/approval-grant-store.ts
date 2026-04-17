import type { ChannelProfile } from "./requester-provenance-store.js";

export type ApprovalRiskLevel = "L2" | "L3";

export type ApprovalGrant = {
  grantId: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  createdAt: number;
  expiresAt: number;
  sourceApprovalId: string;
};

const grantsBySource = new Map<string, ApprovalGrant[]>();

const RISK_ORDER: Record<ApprovalRiskLevel, number> = {
  L2: 2,
  L3: 3,
};

function buildSourceKey(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
}): string | undefined {
  const sourceParts = [
    input.channelProfile ?? "",
    input.channelId ?? "",
    input.accountId ?? "",
    input.conversationId ?? "",
    input.requesterOuId ?? "",
  ];
  if (sourceParts.every((part) => part.length === 0)) {
    return undefined;
  }
  return sourceParts.join("::");
}

function prune(now: number = Date.now()): void {
  for (const [sourceKey, grants] of grantsBySource) {
    const active = grants.filter((grant) => grant.expiresAt > now);
    if (active.length === 0) {
      grantsBySource.delete(sourceKey);
      continue;
    }
    grantsBySource.set(sourceKey, active);
  }
}

export function saveApprovalGrant(grant: ApprovalGrant): void {
  prune();

  const sourceKey = buildSourceKey(grant);
  if (!sourceKey) {
    return;
  }

  const current = grantsBySource.get(sourceKey) ?? [];
  const next = [
    ...current.filter((entry) => entry.module !== grant.module),
    { ...grant },
  ];
  grantsBySource.set(sourceKey, next);
}

export function matchApprovalGrant(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
}): ApprovalGrant | undefined {
  const sourceKey = buildSourceKey(input);
  if (!sourceKey) {
    return undefined;
  }

  prune();
  const candidates = grantsBySource.get(sourceKey) ?? [];
  return candidates.find(
    (grant) =>
      grant.module === input.module
      && RISK_ORDER[grant.maxRiskLevel] >= RISK_ORDER[input.riskLevel],
  );
}

export function clearApprovalGrants(): void {
  grantsBySource.clear();
}
