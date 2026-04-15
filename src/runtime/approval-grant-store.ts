export type ApprovalRiskLevel = "L2" | "L3";

export type ApprovalGrant = {
  grantId: string;
  runId: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  createdAt: number;
  expiresAt: number;
  sourceApprovalId: string;
};

const grantsByRunId = new Map<string, ApprovalGrant[]>();

const RISK_ORDER: Record<ApprovalRiskLevel, number> = {
  L2: 2,
  L3: 3,
};

function prune(now: number = Date.now()): void {
  for (const [runId, grants] of grantsByRunId) {
    const active = grants.filter((grant) => grant.expiresAt > now);
    if (active.length === 0) {
      grantsByRunId.delete(runId);
      continue;
    }
    grantsByRunId.set(runId, active);
  }
}

export function saveApprovalGrant(grant: ApprovalGrant): void {
  prune();

  const current = grantsByRunId.get(grant.runId) ?? [];
  const next = [
    ...current.filter((entry) => entry.module !== grant.module),
    { ...grant },
  ];
  grantsByRunId.set(grant.runId, next);
}

export function matchApprovalGrant(input: {
  runId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
}): ApprovalGrant | undefined {
  if (!input.runId) {
    return undefined;
  }

  prune();
  const candidates = grantsByRunId.get(input.runId) ?? [];
  return candidates.find(
    (grant) =>
      grant.requesterOuId === input.requesterOuId
      && grant.module === input.module
      && RISK_ORDER[grant.maxRiskLevel] >= RISK_ORDER[input.riskLevel],
  );
}

export function clearApprovalGrants(): void {
  grantsByRunId.clear();
}
