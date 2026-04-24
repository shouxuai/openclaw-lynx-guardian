import type {
  ApprovalDetailDto,
  ApprovalListResponse,
  CommonListQuery,
  RiskLevel,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

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
