import type { ToolApprovalRequest, ToolApprovalResolution } from "../types.js";
import {
  saveApprovalGrant,
  type ApprovalRiskLevel,
} from "./approval-grant-store.js";

export function toApprovalRiskLevel(value?: string): ApprovalRiskLevel | undefined {
  if (value === "L2" || value === "L3") {
    return value;
  }
  return undefined;
}

export function buildToolApprovalRequest(params: {
  toolName: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  description: string;
  timeoutMs: number;
  onResolution: (decision: ToolApprovalResolution) => Promise<void> | void;
}): ToolApprovalRequest {
  return {
    title:
      params.riskLevel === "L3"
        ? `Lynx Guardian Approval (High Risk): ${params.toolName}`
        : `Lynx Guardian Approval: ${params.toolName}`,
    description: [
      `[module] ${params.module}`,
      `[risk] ${params.riskLevel}`,
      params.description,
      "Approval will resume the current tool call.",
    ].join("\n"),
    severity: params.riskLevel === "L3" ? "critical" : "warning",
    timeoutMs: params.timeoutMs,
    timeoutBehavior: "deny",
    onResolution: params.onResolution,
  };
}

export function persistGrantFromApproval(params: {
  decision: ToolApprovalResolution;
  approvalId: string;
  runId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  grantWindowMs: number;
}): void {
  if (!params.runId) {
    return;
  }

  if (params.decision !== "allow-once" && params.decision !== "allow-always") {
    return;
  }

  const now = Date.now();
  saveApprovalGrant({
    grantId: `${params.runId}:${params.module}`,
    runId: params.runId,
    requesterOuId: params.requesterOuId,
    module: params.module,
    maxRiskLevel: params.riskLevel,
    createdAt: now,
    expiresAt: now + params.grantWindowMs,
    sourceApprovalId: params.approvalId,
  });
}
