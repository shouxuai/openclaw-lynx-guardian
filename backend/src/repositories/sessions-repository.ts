import type Database from "better-sqlite3";

import type {
  SessionDetailDto,
  SessionListItemDto,
  SessionListResponse,
} from "../../../shared/src/query-dto.js";
import { buildCursorPage, decodeDescendingCursor, resolveListLimit } from "../services/cursor-service.js";
import { mapApprovalListRow } from "./approvals-repository.js";
import { mapAuditEventListRow } from "./events-repository.js";
import {
  appendBooleanFilter,
  appendDescendingCursorFilter,
  appendEqualsFilter,
  appendRangeFilter,
  buildWhereClause,
  type SqlParameter,
} from "./query-utils.js";
import { parseJsonRecord } from "./sql-mappers.js";
import { mapToolCallListRow } from "./tool-calls-repository.js";

export interface SessionsListQuery {
  fromMs?: number;
  toMs?: number;
  limit?: number;
  cursor?: string;
  channelProfile?: string;
  channelId?: string;
  requesterId?: string;
  requesterOuId?: string;
  isGroup?: boolean;
}

interface SessionListRow {
  session_key: string;
  channel_profile: string | null;
  channel_id: string | null;
  requester_id: string | null;
  requester_ou_id: string | null;
  account_id: string | null;
  conversation_id: string | null;
  thread_id: string | null;
  is_group: number;
  first_seen_at: number;
  last_seen_at: number;
  ended_at: number | null;
  metadata_json: string | null;
  event_count: number;
  high_risk_event_count: number;
  tool_call_count: number;
}

export function mapSessionListRow(row: SessionListRow): SessionListItemDto {
  return {
    sessionKey: row.session_key,
    channelProfile: row.channel_profile ?? undefined,
    channelId: row.channel_id ?? undefined,
    requesterId: row.requester_id ?? undefined,
    requesterOuId: row.requester_ou_id ?? undefined,
    accountId: row.account_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    threadId: row.thread_id ?? undefined,
    isGroup: row.is_group === 1,
    firstSeenAtMs: row.first_seen_at,
    lastSeenAtMs: row.last_seen_at,
    endedAtMs: row.ended_at ?? undefined,
    eventCount: row.event_count,
    highRiskEventCount: row.high_risk_event_count,
    toolCallCount: row.tool_call_count,
  };
}

export class SessionsRepository {
  constructor(private readonly database: Database.Database) {}

  private static readonly COUNTS_SQL = `
    SELECT
      s.session_key,
      s.channel_profile,
      s.channel_id,
      s.requester_id,
      s.requester_ou_id,
      s.account_id,
      s.conversation_id,
      s.thread_id,
      s.is_group,
      s.first_seen_at,
      s.last_seen_at,
      s.ended_at,
      s.metadata_json,
      COALESCE(ec.event_count, 0) AS event_count,
      COALESCE(ec.high_risk_event_count, 0) AS high_risk_event_count,
      COALESCE(tc.tool_call_count, 0) AS tool_call_count
    FROM sessions s
    LEFT JOIN (
      SELECT
        session_key,
        COUNT(*) AS event_count,
        SUM(CASE WHEN risk_level IN ('L3', 'L4') THEN 1 ELSE 0 END) AS high_risk_event_count
      FROM audit_events
      GROUP BY session_key
    ) ec ON ec.session_key = s.session_key
    LEFT JOIN (
      SELECT
        session_key,
        COUNT(*) AS tool_call_count
      FROM tool_calls
      GROUP BY session_key
    ) tc ON tc.session_key = s.session_key
  `;

  list(query: SessionsListQuery): SessionListResponse {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const filters: string[] = [];
    const parameters: SqlParameter[] = [];

    appendRangeFilter(filters, parameters, "s.last_seen_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "s.channel_profile", query.channelProfile);
    appendEqualsFilter(filters, parameters, "s.channel_id", query.channelId);
    appendEqualsFilter(filters, parameters, "s.requester_id", query.requesterId);
    appendEqualsFilter(filters, parameters, "s.requester_ou_id", query.requesterOuId);
    appendBooleanFilter(filters, parameters, "s.is_group", query.isGroup);
    appendDescendingCursorFilter(filters, parameters, "s.last_seen_at", "s.session_key", cursor);

    const rows = this.database
      .prepare(
        `
        ${SessionsRepository.COUNTS_SQL}
        ${buildWhereClause(filters)}
        ORDER BY s.last_seen_at DESC, s.session_key DESC
        LIMIT ?
        `,
      )
      .all(...parameters, limit + 1) as SessionListRow[];

    return buildCursorPage(
      rows,
      limit,
      mapSessionListRow,
      (row) => ({
        sortValue: row.last_seen_at,
        id: row.session_key,
      }),
    );
  }

  getByKey(sessionKey: string): SessionDetailDto | null {
    const row = this.database
      .prepare(
        `
        ${SessionsRepository.COUNTS_SQL}
        WHERE s.session_key = ?
        `,
      )
      .get(sessionKey) as SessionListRow | undefined;

    if (!row) {
      return null;
    }

    const recentEvents = this.database
      .prepare(
        `
        SELECT
          event_id,
          session_key,
          run_id,
          tool_call_id,
          approval_id,
          request_id,
          source_kind,
          hook_name,
          event_type,
          category,
          sub_category,
          direction,
          primary_module,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          title,
          summary,
          content_excerpt,
          occurred_at
        FROM audit_events
        WHERE session_key = ?
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT 5
        `,
      )
      .all(sessionKey)
      .map((eventRow) => mapAuditEventListRow(eventRow as never));

    const recentToolCalls = this.database
      .prepare(
        `
        SELECT
          tool_call_id,
          session_key,
          run_id,
          approval_id,
          tool_name,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          started_at,
          finished_at,
          duration_ms,
          result_status,
          result_excerpt
        FROM tool_calls
        WHERE session_key = ?
        ORDER BY started_at DESC, tool_call_id DESC
        LIMIT 5
        `,
      )
      .all(sessionKey)
      .map((toolRow) => mapToolCallListRow(toolRow as never));

    const recentApprovals = this.database
      .prepare(
        `
        SELECT
          approval_id,
          pending_id,
          session_key,
          run_id,
          transport,
          requester_ou_id,
          module,
          risk_level,
          tool_name,
          scope_type,
          requested_at,
          expires_at,
          resolved_at,
          resolution,
          prompt_excerpt
        FROM approvals
        WHERE session_key = ?
        ORDER BY requested_at DESC, approval_id DESC
        LIMIT 5
        `,
      )
      .all(sessionKey)
      .map((approvalRow) => mapApprovalListRow(approvalRow as never));

    const tokenSummaryRow = this.database
      .prepare(
        `
        SELECT
          SUM(total_tokens) AS total_tokens,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens,
          COUNT(*) AS row_count
        FROM token_usage
        WHERE session_key = ?
        `,
      )
      .get(sessionKey) as
      | {
          total_tokens: number | null;
          input_tokens: number | null;
          output_tokens: number | null;
          row_count: number;
        }
      | undefined;

    return {
      ...mapSessionListRow(row),
      metadataJson: parseJsonRecord(row.metadata_json),
      recentEvents,
      recentToolCalls,
      recentApprovals,
      tokenSummary: tokenSummaryRow && tokenSummaryRow.row_count > 0
        ? {
            totalTokens: tokenSummaryRow.total_tokens ?? 0,
            inputTokens: tokenSummaryRow.input_tokens ?? 0,
            outputTokens: tokenSummaryRow.output_tokens ?? 0,
          }
        : undefined,
    };
  }
}
