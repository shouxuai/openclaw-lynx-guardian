/**
 * Task 11 ownership: Feishu local-chat approval bridge.
 * Preserve until Go-backed channel delivery parity is proven in runtime logs.
 */
import type { ApprovalRiskLevel } from "./approval-grant-store.js";
import type { ChannelProfile } from "./requester-provenance-store.js";

export type FeishuLocalApprovalGrant = {
  grantId: string;
  channelProfile: "feishu";
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  requestFingerprint: string;
  grantedByOuId?: string;
  createdAt: number;
  expiresAt: number;
  sourceApprovalId: string;
};

const grantsBySource = new Map<string, FeishuLocalApprovalGrant[]>();

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
  module: string;
  requestFingerprint: string;
}): string | undefined {
  if (input.channelProfile !== "feishu") {
    return undefined;
  }

  return [
    input.channelId ?? "",
    input.accountId ?? "",
    input.conversationId ?? "",
    input.requesterOuId ?? "",
    input.module,
    input.requestFingerprint,
  ].join("::");
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

export function saveFeishuLocalApprovalGrant(grant: FeishuLocalApprovalGrant): void {
  prune();

  const sourceKey = buildSourceKey(grant);
  if (!sourceKey) {
    return;
  }

  const current = grantsBySource.get(sourceKey) ?? [];
  grantsBySource.set(sourceKey, [...current, { ...grant }]);
}

function findMatchingGrant(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  requestFingerprint: string;
}): { grants: FeishuLocalApprovalGrant[]; match: FeishuLocalApprovalGrant | undefined; matchIndex: number; sourceKey?: string } {
  const sourceKey = buildSourceKey(input);
  if (!sourceKey) {
    return {
      grants: [],
      match: undefined,
      matchIndex: -1,
      sourceKey,
    };
  }

  prune();
  const grants = grantsBySource.get(sourceKey) ?? [];
  const matchIndex = grants.findIndex(
    (grant) => RISK_ORDER[grant.maxRiskLevel] >= RISK_ORDER[input.riskLevel],
  );
  const match = matchIndex >= 0 ? grants[matchIndex] : undefined;

  return {
    grants,
    match,
    matchIndex,
    sourceKey,
  };
}

export function readFeishuLocalApprovalGrant(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  requestFingerprint: string;
}): FeishuLocalApprovalGrant | undefined {
  const { match } = findMatchingGrant(input);
  return match ? { ...match } : undefined;
}

export function consumeFeishuLocalApprovalGrant(input: {
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  requestFingerprint: string;
}): FeishuLocalApprovalGrant | undefined {
  const { grants, match, matchIndex, sourceKey } = findMatchingGrant(input);
  if (!match || matchIndex < 0 || !sourceKey) {
    return undefined;
  }

  const next = grants.filter((_, candidateIndex) => candidateIndex !== matchIndex);

  if (next.length === 0) {
    grantsBySource.delete(sourceKey);
  } else {
    grantsBySource.set(sourceKey, next);
  }

  return { ...match };
}

export function clearFeishuLocalApprovalGrants(): void {
  grantsBySource.clear();
}
