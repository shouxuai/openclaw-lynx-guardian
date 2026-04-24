import type {
  CommonListQuery,
  EnforcementAction,
  RiskLevel,
  ToolCallDetailDto,
  ToolCallListResponse,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface ToolCallListQuery extends CommonListQuery {
  toolName?: string;
  resultStatus?: string;
  approvalId?: string;
  riskLevel?: RiskLevel[];
  enforcementAction?: EnforcementAction[];
}

export function listToolCalls(query: ToolCallListQuery = {}): Promise<ToolCallListResponse> {
  return fetchJson<ToolCallListResponse>(`/tool-calls${buildQueryString(query)}`);
}

export function getToolCallDetail(toolCallId: string): Promise<ToolCallDetailDto> {
  return fetchJson<ToolCallDetailDto>(`/tool-calls/${encodeURIComponent(toolCallId)}`);
}
