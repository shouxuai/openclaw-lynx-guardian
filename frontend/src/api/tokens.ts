import type {
  CommonListQuery,
  TokenSummaryDto,
  TokenTrendBucket,
  TokenTrendDto,
  TokenUsageListResponse,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export interface TokenTimeRangeQuery {
  fromMs?: number;
  toMs?: number;
}

export function getTokenSummary(query: TokenTimeRangeQuery = {}): Promise<TokenSummaryDto> {
  return fetchJson<TokenSummaryDto>(`/tokens/summary${buildQueryString(query)}`);
}

export interface TokenUsageListQuery extends CommonListQuery {
  agentId?: string;
  isEstimated?: boolean;
  model?: string;
  provider?: string;
  sourceType?: "actual" | "estimated" | "unavailable";
}

export function getTokenUsage(query: TokenUsageListQuery = {}): Promise<TokenUsageListResponse> {
  return fetchJson<TokenUsageListResponse>(`/tokens/usage${buildQueryString(query)}`);
}

export function getTokenTrend(
  bucket: TokenTrendBucket = "hour",
  query: TokenTimeRangeQuery = {},
): Promise<TokenTrendDto> {
  return fetchJson<TokenTrendDto>(`/tokens/trend${buildQueryString({ bucket, ...query })}`);
}
