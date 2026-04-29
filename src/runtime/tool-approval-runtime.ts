import type { ToolApprovalRequest, ToolApprovalResolution } from "../types.js";
import {
  saveApprovalGrant,
  type ApprovalRiskLevel,
} from "./approval-grant-store.js";
import { GoControlPlaneClient } from "../api/go-control-plane.js";
import { appendLocalConsoleWebviewFootnote } from "./local-console-webview-note.js";
import type { ChannelProfile } from "./requester-provenance-store.js";

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
  const description = [
    `[module] ${params.module}`,
    `[risk] ${params.riskLevel}`,
    params.description,
    "Approval will resume the current tool call.",
  ].join("\n");

  return {
    title:
      params.riskLevel === "L3"
        ? `Lynx Guardian Approval (High Risk): ${params.toolName}`
        : `Lynx Guardian Approval: ${params.toolName}`,
    description: params.riskLevel === "L3"
      ? appendLocalConsoleWebviewFootnote(description)
      : description,
    severity: params.riskLevel === "L3" ? "critical" : "warning",
    timeoutMs: params.timeoutMs,
    timeoutBehavior: "deny",
    onResolution: params.onResolution,
  };
}

export type GrantControlPlaneSync = {
  baseUrl: string;
  getToken?: () => string;
  fetchImpl?: typeof fetch;
  chainId: string;
  sessionKey?: string;
  requesterId?: string;
  approverId?: string;
  approverOuId?: string;
  toolName: string;
  targetKind: string;
  targetHash: string;
  resourceScope?: Record<string, unknown>;
};

export function persistGrantFromApproval(params: {
  decision: ToolApprovalResolution;
  approvalId: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  grantWindowMs: number;
  grantControlPlane?: GrantControlPlaneSync;
}): Promise<void> | void {
  if (params.decision !== "allow-once" && params.decision !== "allow-always") {
    return;
  }

  const now = Date.now();
  saveApprovalGrant({
    grantId: [
      params.channelProfile ?? "",
      params.channelId ?? "",
      params.accountId ?? "",
      params.conversationId ?? "",
      params.requesterOuId ?? "",
      params.module,
    ].join("::"),
    channelProfile: params.channelProfile,
    channelId: params.channelId,
    accountId: params.accountId,
    conversationId: params.conversationId,
    requesterOuId: params.requesterOuId,
    module: params.module,
    maxRiskLevel: params.riskLevel,
    createdAt: now,
    expiresAt: now + params.grantWindowMs,
    sourceApprovalId: params.approvalId,
  });

  if (params.grantControlPlane) {
    return syncGrantToControlPlane(params).catch(() => undefined);
  }
}

async function syncGrantToControlPlane(params: {
  decision: ToolApprovalResolution;
  approvalId: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  grantWindowMs: number;
  grantControlPlane?: GrantControlPlaneSync;
}): Promise<void> {
  const sync = params.grantControlPlane;
  if (!sync) {
    return;
  }
  const client = new GoControlPlaneClient(sync);
  await client.resolveApproval(params.approvalId, {
    approvalId: params.approvalId,
    resolution: "allow-current-chain",
    chainId: sync.chainId,
    sessionKey: sync.sessionKey,
    channelProfile: params.channelProfile,
    channelId: params.channelId,
    conversationId: params.conversationId,
    requesterId: sync.requesterId,
    requesterOuId: params.requesterOuId,
    approverId: sync.approverId,
    approverOuId: sync.approverOuId,
    riskFamily: params.module,
    riskLevel: params.riskLevel,
    toolName: sync.toolName,
    targetKind: sync.targetKind,
    targetHash: sync.targetHash,
    resourceScope: {
      ...(sync.resourceScope ?? {}),
      decision: params.decision,
      grantWindowMs: params.grantWindowMs,
    },
  });
}
