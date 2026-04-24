import type {
  CommonListQuery,
  SessionDetailDto,
  SessionListResponse,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface SessionListQuery extends CommonListQuery {
  channelProfile?: string;
  channelId?: string;
  requesterId?: string;
  requesterOuId?: string;
  isGroup?: boolean;
}

export function listSessions(query: SessionListQuery = {}): Promise<SessionListResponse> {
  return fetchJson<SessionListResponse>(`/sessions${buildQueryString(query)}`);
}

export function getSessionDetail(sessionKey: string): Promise<SessionDetailDto> {
  return fetchJson<SessionDetailDto>(`/sessions/${encodeURIComponent(sessionKey)}`);
}
