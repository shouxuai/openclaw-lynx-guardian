import type {
  ApprovalDetailDto,
  ApprovalListResponse,
  CommonListQuery,
  RiskLevel,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";
import type { Grant } from "./grants";

export interface ApprovalListQuery extends CommonListQuery {
  resolution?: string;
  toolName?: string;
  module?: string;
  scopeType?: string;
  requesterOuId?: string;
  riskLevel?: RiskLevel[];
}

export function listApprovals(query: ApprovalListQuery = {}): Promise<ApprovalListResponse> {
  return fetchJson<ApprovalListResponse>(`/approvals${buildQueryString(query)}`);
}

export function getApprovalDetail(approvalId: string): Promise<ApprovalDetailDto> {
  return fetchJson<ApprovalDetailDto>(`/approvals/${encodeURIComponent(approvalId)}`);
}

export interface ApprovalResolveBody {
  approvalId: string;
  resolution: "allow-current-chain" | "allow-once" | "allow-always";
  chainId: string;
  sessionKey: string;
  channelProfile: string;
  channelId: string;
  conversationId: string;
  requesterId: string;
  requesterOuId: string;
  approverId?: string;
  approverOuId: string;
  riskFamily: string;
  riskLevel: RiskLevel;
  toolName: string;
  targetKind: string;
  targetHash: string;
  resourceScope: Record<string, unknown>;
}

export function resolveApproval(approvalId: string, body: ApprovalResolveBody): Promise<Grant> {
  return fetchJson<Grant>(`/approvals/${encodeURIComponent(approvalId)}/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
