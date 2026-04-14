export type PolicyDecisionKind =
  | "deny"
  | "block"
  | "confirm"
  | "workflow_auth"
  | "warn"
  | "allow";

export type RiskLevelLabel = "L0" | "L1" | "L2" | "L3" | "L4";

export interface ResolvedRiskLevel {
  riskLevelLabel: RiskLevelLabel;
  riskLevelValue: 0 | 1 | 2 | 3 | 4;
}

export interface PolicyDecision {
  kind: PolicyDecisionKind;
}

export interface SessionSecuritySnapshot {
  sessionKey: string;
  trustedObjective: string;
  recentTurns: number;
  suspiciousTurns: number;
  safeTurnsSinceLastSuspicion: number;
  workflowAuthorized: boolean;
  lastUpdatedAt: number;
}
