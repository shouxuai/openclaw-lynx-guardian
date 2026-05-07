import type { CommonListQuery, PageResponse } from "@lynx/local-console-shared";

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
  coveredPrompts: ChainCoveredPrompt[];
  promptCount: number;
}

export interface ChainCoveredPrompt {
  qaRecordId: string;
  runId?: string;
  userPromptExcerpt: string;
  riskLevel?: string;
  startedAtMs?: number;
  status?: string;
}

export interface ChainListQuery extends CommonListQuery {
  channelProfile?: string;
  conversationId?: string;
}

type ChainListPayload = ChainSummary[] | Partial<PageResponse<ChainSummary>>;

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeCoveredPrompts(value: unknown): ChainCoveredPrompt[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (item): item is Partial<ChainCoveredPrompt> =>
        Boolean(item) && typeof item === "object",
    )
    .map((item) => ({
      qaRecordId: typeof item.qaRecordId === "string" ? item.qaRecordId : "",
      runId: typeof item.runId === "string" ? item.runId : undefined,
      userPromptExcerpt:
        typeof item.userPromptExcerpt === "string"
          ? item.userPromptExcerpt
          : "",
      riskLevel:
        typeof item.riskLevel === "string" ? item.riskLevel : undefined,
      startedAtMs:
        typeof item.startedAtMs === "number" ? item.startedAtMs : undefined,
      status: typeof item.status === "string" ? item.status : undefined,
    }))
    .filter((item) => item.qaRecordId || item.userPromptExcerpt);
}

function normalizeChainSummary(item: ChainSummary): ChainSummary {
  const coveredPrompts = normalizeCoveredPrompts(item.coveredPrompts);
  return {
    ...item,
    recentIdentity: normalizeStringArray(item.recentIdentity),
    recentSensitive: normalizeStringArray(item.recentSensitive),
    recentDenials: normalizeStringArray(item.recentDenials),
    recentApprovals: normalizeStringArray(item.recentApprovals),
    recentTools: normalizeStringArray(item.recentTools),
    recentTaintReads: normalizeStringArray(item.recentTaintReads),
    recentEvasions: normalizeStringArray(item.recentEvasions),
    coveredPrompts,
    promptCount:
      typeof item.promptCount === "number"
        ? item.promptCount
        : coveredPrompts.length,
  };
}

function normalizeChainList(
  payload: ChainListPayload,
  query: ChainListQuery,
): PageResponse<ChainSummary> {
  const rawItems = Array.isArray(payload) ? payload : payload.items ?? [];
  const items = rawItems.map(normalizeChainSummary);
  if (Array.isArray(payload)) {
    const pageSize = query.pageSize ?? payload.length;
    return {
      items,
      pageNum: query.pageNum ?? 1,
      pageSize,
      total: payload.length,
      totalPages: payload.length === 0 ? 0 : Math.ceil(payload.length / pageSize),
    };
  }

  const pageSize = payload.pageSize ?? query.pageSize ?? items.length;
  const total = payload.total ?? items.length;
  return {
    items,
    pageNum: payload.pageNum ?? query.pageNum ?? 1,
    pageSize,
    total,
    totalPages: payload.totalPages ?? (total === 0 ? 0 : Math.ceil(total / pageSize)),
  };
}

export async function listChains(
  query: ChainListQuery = {},
): Promise<PageResponse<ChainSummary>> {
  const payload = await fetchJson<ChainListPayload>(
    `/chains${buildQueryString(query)}`,
  );
  return normalizeChainList(payload, query);
}

export function getChain(chainId: string): Promise<ChainSummary> {
  return fetchJson<ChainSummary>(`/chains/${encodeURIComponent(chainId)}`).then(
    normalizeChainSummary,
  );
}
