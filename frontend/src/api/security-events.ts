import type {
  CommonListQuery,
  SecurityEventDetailDto,
  SecurityEventKind,
  SecurityEventListResponse,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface SecurityEventListQuery extends CommonListQuery {
  eventKind?: SecurityEventKind;
}

export function listSecurityEvents(query: SecurityEventListQuery = {}): Promise<SecurityEventListResponse> {
  return fetchJson<SecurityEventListResponse>(`/security-events${buildQueryString(query)}`);
}

export function getSecurityEventDetail(eventId: string): Promise<SecurityEventDetailDto> {
  return fetchJson<SecurityEventDetailDto>(`/security-events/${encodeURIComponent(eventId)}`);
}
