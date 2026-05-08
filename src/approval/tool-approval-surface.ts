export type ApprovalSurface =
  | "allow"
  | "hard-deny"
  | "plugin-native"
  | "block-no-approval-route";

export type ApprovalRiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type ToolApprovalSurfaceInput = {
  toolName: string;
  riskLevel: ApprovalRiskLevel;
  modules: string[];
  nativeExecApprovalAvailable: boolean;
  systemPluginApprovalAvailable: boolean;
};

export type ToolApprovalSurfaceResult = {
  surface: ApprovalSurface;
  requiresOpenClawApprovalContext: boolean;
  reason: string;
};

const NON_EXEC_APPROVAL_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "cron",
  "gateway",
  "feishu_doc",
  "feishu_drive",
  "feishu_wiki",
  "feishu_bitable_update_record",
  "feishu_bitable_create_record",
]);

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

export function resolveToolApprovalSurface(input: ToolApprovalSurfaceInput): ToolApprovalSurfaceResult {
  const toolName = normalizeToolName(input.toolName);
  if (input.riskLevel === "L4") {
    return {
      surface: "hard-deny",
      requiresOpenClawApprovalContext: false,
      reason: "L4 is not approvable",
    };
  }

  if (input.riskLevel !== "L2" && input.riskLevel !== "L3") {
    return {
      surface: "allow",
      requiresOpenClawApprovalContext: false,
      reason: "risk level does not require approval",
    };
  }

  if (toolName === "exec") {
    return input.systemPluginApprovalAvailable
      ? {
          surface: "plugin-native",
          requiresOpenClawApprovalContext: false,
          reason: "exec uses Lynx workflow approval so one prompt can cover the current run",
        }
      : {
          surface: "block-no-approval-route",
          requiresOpenClawApprovalContext: false,
          reason: "no approval route for risky exec tool",
        };
  }

  if (NON_EXEC_APPROVAL_TOOLS.has(toolName)) {
    return input.systemPluginApprovalAvailable
      ? {
          surface: "plugin-native",
          requiresOpenClawApprovalContext: false,
          reason: "non-exec risky tool uses system plugin approval",
        }
      : {
          surface: "block-no-approval-route",
          requiresOpenClawApprovalContext: false,
          reason: "no approval route for risky non-exec tool",
        };
  }

  return {
    surface: "plugin-native",
    requiresOpenClawApprovalContext: false,
    reason: "risky tool uses plugin approval",
  };
}
