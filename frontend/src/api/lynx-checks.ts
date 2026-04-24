import type {
  CommonListQuery,
  LynxCheckDetailDto,
  LynxCheckListResponse,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface LynxCheckListQuery extends CommonListQuery {
  source?: string;
  trigger?: string;
  status?: string;
  messageProvider?: string;
}

export function listLynxChecks(query: LynxCheckListQuery = {}): Promise<LynxCheckListResponse> {
  return fetchJson<LynxCheckListResponse>(`/lynx-checks${buildQueryString(query)}`);
}

export function getLynxCheckDetail(requestId: string): Promise<LynxCheckDetailDto> {
  return fetchJson<LynxCheckDetailDto>(`/lynx-checks/${encodeURIComponent(requestId)}`);
}
