import type {
  TokenSummaryDto,
  TokenTrendBucket,
  TokenTrendDto,
  TokenUsageListResponse,
} from "@lynx/local-console-shared";

import { buildQueryString, fetchJson } from "./client";

export function getTokenSummary(): Promise<TokenSummaryDto> {
  return fetchJson<TokenSummaryDto>("/tokens/summary");
}

export function getTokenUsage(limit = 20): Promise<TokenUsageListResponse> {
  return fetchJson<TokenUsageListResponse>(`/tokens/usage${buildQueryString({ limit })}`);
}

export function getTokenTrend(bucket: TokenTrendBucket = "hour"): Promise<TokenTrendDto> {
  return fetchJson<TokenTrendDto>(`/tokens/trend${buildQueryString({ bucket })}`);
}
