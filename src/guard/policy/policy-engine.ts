import type { AttackGraphState } from "./attack-graph.js";
import type { DimensionScores } from "./evidence-scorer.js";
import type { PolicyDecision, ResolvedRiskLevel, RiskLevelLabel } from "./policy-types.js";

export interface ResolveRiskLevelInput {
  summaryHeat: number;
  dimensionScores: Partial<DimensionScores> & Record<string, number>;
  chainProgress?: AttackGraphState | null;
  isAuditWhitelisted: boolean;
}

export interface DecidePolicyInput extends ResolvedRiskLevel {
  workflowCandidate?: boolean;
  workflowAuthorized?: boolean;
  isAuditWhitelisted: boolean;
  auditBoundaryExceeded?: boolean;
}

function toRiskLabel(value: 0 | 1 | 2 | 3 | 4): RiskLevelLabel {
  switch (value) {
    case 4:
      return "L4";
    case 3:
      return "L3";
    case 2:
      return "L2";
    case 1:
      return "L1";
    default:
      return "L0";
  }
}

function baseRiskValueFromHeat(summaryHeat: number): 0 | 1 | 2 | 3 | 4 {
  if (summaryHeat >= 5) {
    return 4;
  }
  if (summaryHeat >= 4) {
    return 3;
  }
  if (summaryHeat >= 3) {
    return 2;
  }
  if (summaryHeat >= 2) {
    return 1;
  }
  return 0;
}

function promoteRisk(
  current: 0 | 1 | 2 | 3 | 4,
  minimum: 0 | 1 | 2 | 3 | 4,
): 0 | 1 | 2 | 3 | 4 {
  return current >= minimum ? current : minimum;
}

export function resolveRiskLevel(input: ResolveRiskLevelInput): ResolvedRiskLevel {
  const auth = input.dimensionScores.auth ?? 0;
  const harm = input.dimensionScores.harm ?? 0;
  const chain = input.dimensionScores.chain ?? 0;
  const taint = input.dimensionScores.taint ?? 0;
  let riskLevelValue = baseRiskValueFromHeat(input.summaryHeat);

  if (!input.isAuditWhitelisted) {
    switch (input.chainProgress?.stage) {
      case "exfiltration_ready":
        riskLevelValue = promoteRisk(riskLevelValue, 4);
        break;
      case "execution_ready":
        riskLevelValue = promoteRisk(riskLevelValue, Math.max(auth, harm, chain, taint) >= 4 ? 3 : 2);
        break;
      case "artifact_prepared":
        riskLevelValue = promoteRisk(riskLevelValue, chain >= 4 || taint >= 4 ? 3 : 2);
        break;
      case "sensitive_scope_entered":
        riskLevelValue = promoteRisk(riskLevelValue, auth >= 4 || harm >= 3 ? 2 : 1);
        break;
      default:
        break;
    }

    if (auth >= 5 && harm >= 4) {
      riskLevelValue = promoteRisk(riskLevelValue, 3);
    }
  }

  return {
    riskLevelLabel: toRiskLabel(riskLevelValue),
    riskLevelValue,
  };
}

export function decidePolicy(input: DecidePolicyInput): PolicyDecision {
  if (input.riskLevelLabel === "L4") {
    return { kind: "deny" };
  }

  if (input.riskLevelLabel === "L3") {
    return { kind: "block" };
  }

  if (
    input.isAuditWhitelisted
    && input.auditBoundaryExceeded !== true
    && input.riskLevelValue <= 1
  ) {
    return { kind: input.riskLevelLabel === "L1" ? "warn" : "allow" };
  }

  if (input.riskLevelLabel === "L2") {
    if (input.workflowCandidate) {
      return { kind: input.workflowAuthorized ? "allow" : "workflow_auth" };
    }
    return { kind: "confirm" };
  }

  if (input.riskLevelLabel === "L1") {
    return { kind: "warn" };
  }

  return { kind: "allow" };
}
