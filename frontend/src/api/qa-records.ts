import type {
  CommonListQuery,
  QaRecordDetailDto,
  QaRecordListResponse,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface QaRecordListQuery extends CommonListQuery {
  status?: string;
}

export function listQaRecords(query: QaRecordListQuery = {}): Promise<QaRecordListResponse> {
  return fetchJson<QaRecordListResponse>(`/qa-records${buildQueryString(query)}`);
}

export function getQaRecordDetail(qaRecordId: string): Promise<QaRecordDetailDto> {
  return fetchJson<QaRecordDetailDto>(`/qa-records/${encodeURIComponent(qaRecordId)}`);
}
