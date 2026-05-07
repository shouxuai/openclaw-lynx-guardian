import type { CommonListQuery, PageResponse } from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface Grant {
  grantId: string;
  approvalId: string;
  chainId: string;
  sessionKey: string;
  channelProfile: string;
  channelId: string;
  conversationId: string;
  requesterId: string;
  requesterOuId: string;
  approverId: string;
  approverOuId: string;
  riskFamily: string;
  toolName: string;
  targetKind: string;
  targetHash: string;
  resourceScope: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface GrantListQuery extends CommonListQuery {
  chainId?: string;
  requesterId?: string;
  revoked?: boolean;
}

type GrantListPayload = Grant[] | Partial<PageResponse<Grant>>;

function normalizeGrantList(
  payload: GrantListPayload,
  query: GrantListQuery,
): PageResponse<Grant> {
  const items = Array.isArray(payload) ? payload : payload.items ?? [];
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

export async function listGrants(query: GrantListQuery = {}): Promise<PageResponse<Grant>> {
  const payload = await fetchJson<GrantListPayload>(`/grants${buildQueryString(query)}`);
  return normalizeGrantList(payload, query);
}
