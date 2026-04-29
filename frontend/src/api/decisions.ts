import type { CommonListQuery, DecisionResponse, PageResponse } from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface DecisionListQuery extends CommonListQuery {
  action?: string[];
  stage?: string[];
  winningArbiter?: string[];
}

type DecisionListPayload = DecisionResponse[] | PageResponse<DecisionResponse>;

function normalizeDecisionList(payload: DecisionListPayload, query: DecisionListQuery): PageResponse<DecisionResponse> {
  if (!Array.isArray(payload)) {
    return payload;
  }

  const pageSize = query.pageSize ?? payload.length;
  return {
    items: payload,
    pageNum: query.pageNum ?? 1,
    pageSize,
    total: payload.length,
    totalPages: payload.length === 0 ? 0 : Math.ceil(payload.length / pageSize),
  };
}

export async function listDecisions(query: DecisionListQuery = {}): Promise<PageResponse<DecisionResponse>> {
  const payload = await fetchJson<DecisionListPayload>(`/decisions${buildQueryString(query)}`);
  return normalizeDecisionList(payload, query);
}

export function getDecision(decisionId: string): Promise<DecisionResponse> {
  return fetchJson<DecisionResponse>(`/decisions/${encodeURIComponent(decisionId)}`);
}
