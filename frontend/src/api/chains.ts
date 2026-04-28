import type { CommonListQuery } from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface ChainSummary {
  chainId: string;
  sessionKey: string;
  recentIdentity: string[];
  recentSensitive: string[];
  recentDenials: string[];
  recentApprovals: string[];
  recentTools: string[];
  recentTaintReads: string[];
  recentEvasions: string[];
  activeGrantId: string;
  pendingApproval: string;
}

export interface ChainListQuery extends CommonListQuery {
  channelProfile?: string;
  conversationId?: string;
}

type ChainListPayload = ChainSummary[] | { items: ChainSummary[] };

function normalizeChainList(payload: ChainListPayload): ChainSummary[] {
  return Array.isArray(payload) ? payload : payload.items;
}

export async function listChains(query: ChainListQuery = {}): Promise<ChainSummary[]> {
  const payload = await fetchJson<ChainListPayload>(`/chains${buildQueryString(query)}`);
  return normalizeChainList(payload);
}

export function getChain(chainId: string): Promise<ChainSummary> {
  return fetchJson<ChainSummary>(`/chains/${encodeURIComponent(chainId)}`);
}
