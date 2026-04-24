import type Database from "better-sqlite3";

import type {
  TokenSummaryDto,
  TokenTrendBucket,
  TokenTrendDto,
  TokenUsageListItemDto,
  TokenUsageListResponse,
} from "../../../shared/src/query-dto.js";
import { buildCursorPage, decodeDescendingCursor, resolveListLimit } from "../services/cursor-service.js";
import {
  appendBooleanFilter,
  appendDescendingCursorFilter,
  appendEqualsFilter,
  appendRangeFilter,
  buildWhereClause,
  type SqlParameter,
} from "./query-utils.js";
import { fromDbBoolean } from "./sql-mappers.js";

export interface TokenUsageListQuery {
  fromMs?: number;
  toMs?: number;
  sessionKey?: string;
  runId?: string;
  limit?: number;
  cursor?: string;
  provider?: string;
  model?: string;
  agentId?: string;
  isEstimated?: boolean;
}

export interface TokenSummaryQuery {
  fromMs?: number;
  toMs?: number;
  sessionKey?: string;
  runId?: string;
  provider?: string;
  model?: string;
}

export interface TokenTrendQuery extends TokenSummaryQuery {
  bucket?: TokenTrendBucket;
}

interface TokenUsageRow {
  usage_event_id: string;
  session_key: string | null;
  run_id: string | null;
  agent_id: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  assistant_text_count: number;
  is_estimated: number;
  occurred_at: number;
}

export function mapTokenUsageRow(row: TokenUsageRow): TokenUsageListItemDto {
  return {
    usageEventId: row.usage_event_id,
    sessionKey: row.session_key ?? undefined,
    runId: row.run_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    totalTokens: row.total_tokens,
    assistantTextCount: row.assistant_text_count,
    isEstimated: fromDbBoolean(row.is_estimated),
    occurredAtMs: row.occurred_at,
  };
}

export class TokensRepository {
  constructor(private readonly database: Database.Database) {}

  private buildCommonFilters(query: TokenSummaryQuery | TokenUsageListQuery): {
    filters: string[];
    parameters: SqlParameter[];
  } {
    const filters: string[] = [];
    const parameters: SqlParameter[] = [];

    appendRangeFilter(filters, parameters, "occurred_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "session_key", query.sessionKey);
    appendEqualsFilter(filters, parameters, "run_id", query.runId);
    appendEqualsFilter(filters, parameters, "provider", query.provider);
    appendEqualsFilter(filters, parameters, "model", query.model);

    if ("agentId" in query) {
      appendEqualsFilter(filters, parameters, "agent_id", query.agentId);
    }
    if ("isEstimated" in query) {
      appendBooleanFilter(filters, parameters, "is_estimated", query.isEstimated);
    }

    return { filters, parameters };
  }

  list(query: TokenUsageListQuery): TokenUsageListResponse {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const { filters, parameters } = this.buildCommonFilters(query);
    appendDescendingCursorFilter(filters, parameters, "occurred_at", "usage_event_id", cursor);

    const rows = this.database
      .prepare(
        `
        SELECT
          usage_event_id,
          session_key,
          run_id,
          agent_id,
          provider,
          model,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_write_tokens,
          total_tokens,
          assistant_text_count,
          is_estimated,
          occurred_at
        FROM token_usage
        ${buildWhereClause(filters)}
        ORDER BY occurred_at DESC, usage_event_id DESC
        LIMIT ?
        `,
      )
      .all(...parameters, limit + 1) as TokenUsageRow[];

    return buildCursorPage(
      rows,
      limit,
      mapTokenUsageRow,
      (row) => ({
        sortValue: row.occurred_at,
        id: row.usage_event_id,
      }),
    );
  }

  getSummary(query: TokenSummaryQuery): TokenSummaryDto {
    const { filters, parameters } = this.buildCommonFilters(query);

    const summaryRow = this.database
      .prepare(
        `
        SELECT
          COALESCE(SUM(total_tokens), 0) AS total_tokens,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
          COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
          COALESCE(SUM(CASE WHEN is_estimated = 1 THEN 1 ELSE 0 END), 0) AS estimated_count
        FROM token_usage
        ${buildWhereClause(filters)}
        `,
      )
      .get(...parameters) as {
      total_tokens: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
      estimated_count: number;
    };

    const topModels = this.database
      .prepare(
        `
        SELECT
          model,
          COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM token_usage
        ${buildWhereClause(filters)}
        GROUP BY model
        ORDER BY total_tokens DESC, model ASC
        LIMIT 5
        `,
      )
      .all(...parameters) as Array<{ model: string; total_tokens: number }>;

    return {
      totalTokens: summaryRow.total_tokens,
      inputTokens: summaryRow.input_tokens,
      outputTokens: summaryRow.output_tokens,
      cacheReadTokens: summaryRow.cache_read_tokens,
      cacheWriteTokens: summaryRow.cache_write_tokens,
      estimatedCount: summaryRow.estimated_count,
      topModels: topModels.map((row) => ({
        model: row.model,
        totalTokens: row.total_tokens,
      })),
    };
  }

  getTrend(query: TokenTrendQuery): TokenTrendDto {
    const bucket = query.bucket ?? "hour";
    const bucketSizeMs = bucket === "day" ? 86_400_000 : 3_600_000;
    const { filters, parameters } = this.buildCommonFilters(query);

    const rows = this.database
      .prepare(
        `
        SELECT
          CAST(occurred_at / ${bucketSizeMs} AS INTEGER) * ${bucketSizeMs} AS bucket_start_ms,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(total_tokens), 0) AS total_tokens
        FROM token_usage
        ${buildWhereClause(filters)}
        GROUP BY bucket_start_ms
        ORDER BY bucket_start_ms ASC
        `,
      )
      .all(...parameters) as Array<{
      bucket_start_ms: number;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    }>;

    return {
      bucket,
      points: rows.map((row) => ({
        bucketStartMs: row.bucket_start_ms,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalTokens: row.total_tokens,
      })),
    };
  }
}
