import type { CommonListQuery, DecisionResponse } from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface DecisionListQuery extends CommonListQuery {
  action?: string[];
  stage?: string[];
  winningArbiter?: string[];
}

type DecisionListPayload = DecisionResponse[] | { items: DecisionResponse[] };

function normalizeDecisionList(payload: DecisionListPayload): DecisionResponse[] {
  return Array.isArray(payload) ? payload : payload.items;
}

export async function listDecisions(query: DecisionListQuery = {}): Promise<DecisionResponse[]> {
  const payload = await fetchJson<DecisionListPayload>(`/decisions${buildQueryString(query)}`);
  return normalizeDecisionList(payload);
}

export function getDecision(decisionId: string): Promise<DecisionResponse> {
  return fetchJson<DecisionResponse>(`/decisions/${encodeURIComponent(decisionId)}`);
}
