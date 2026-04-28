import type {
  CommonListQuery,
  TokenSummaryDto,
  TokenTrendBucket,
  TokenTrendDto,
  TokenUsageListResponse,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export function getTokenSummary(): Promise<TokenSummaryDto> {
  return fetchJson<TokenSummaryDto>("/tokens/summary");
}

export interface TokenUsageListQuery extends CommonListQuery {
  agentId?: string;
  isEstimated?: boolean;
  model?: string;
  provider?: string;
}

export function getTokenUsage(query: TokenUsageListQuery = {}): Promise<TokenUsageListResponse> {
  return fetchJson<TokenUsageListResponse>(`/tokens/usage${buildQueryString(query)}`);
}

export function getTokenTrend(bucket: TokenTrendBucket = "hour"): Promise<TokenTrendDto> {
  return fetchJson<TokenTrendDto>(`/tokens/trend${buildQueryString({ bucket })}`);
}
