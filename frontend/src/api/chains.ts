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

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeChainSummary(item: ChainSummary): ChainSummary {
  return {
    ...item,
    recentIdentity: normalizeStringArray(item.recentIdentity),
    recentSensitive: normalizeStringArray(item.recentSensitive),
    recentDenials: normalizeStringArray(item.recentDenials),
    recentApprovals: normalizeStringArray(item.recentApprovals),
    recentTools: normalizeStringArray(item.recentTools),
    recentTaintReads: normalizeStringArray(item.recentTaintReads),
    recentEvasions: normalizeStringArray(item.recentEvasions),
  };
}

function normalizeChainList(payload: ChainListPayload): ChainSummary[] {
  const items = Array.isArray(payload) ? payload : payload.items;
  return items.map(normalizeChainSummary);
}

export async function listChains(query: ChainListQuery = {}): Promise<ChainSummary[]> {
  const payload = await fetchJson<ChainListPayload>(`/chains${buildQueryString(query)}`);
  return normalizeChainList(payload);
}

export function getChain(chainId: string): Promise<ChainSummary> {
  return fetchJson<ChainSummary>(`/chains/${encodeURIComponent(chainId)}`).then(normalizeChainSummary);
}
