import type { CommonListQuery } from "@lynx/local-console-shared";

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

type GrantListPayload = Grant[] | { items: Grant[] };

function normalizeGrantList(payload: GrantListPayload): Grant[] {
  return Array.isArray(payload) ? payload : payload.items;
}

export async function listGrants(query: GrantListQuery = {}): Promise<Grant[]> {
  const payload = await fetchJson<GrantListPayload>(`/grants${buildQueryString(query)}`);
  return normalizeGrantList(payload);
}
