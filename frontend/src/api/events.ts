import type {
  AuditEventDetailDto,
  AuditEventListResponse,
  CommonListQuery,
  EnforcementAction,
  RiskLevel,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface EventListQuery extends CommonListQuery {
  q?: string;
  hookName?: string;
  eventType?: string;
  category?: string;
  subCategory?: string;
  direction?: string;
  primaryModule?: string;
  requestId?: string;
  toolCallId?: string;
  approvalId?: string;
  riskLevel?: RiskLevel[];
  enforcementAction?: EnforcementAction[];
}

export function listEvents(query: EventListQuery = {}): Promise<AuditEventListResponse> {
  return fetchJson<AuditEventListResponse>(`/events${buildQueryString(query)}`);
}

export function getEventDetail(eventId: string): Promise<AuditEventDetailDto> {
  return fetchJson<AuditEventDetailDto>(`/events/${encodeURIComponent(eventId)}`);
}
