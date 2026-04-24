import type Database from "better-sqlite3";

import type {
  CommonListQuery,
  ToolCallDetailDto,
  ToolCallListItemDto,
  ToolCallListResponse,
} from "../../../shared/src/query-dto.js";
import { buildCursorPage, decodeDescendingCursor, resolveListLimit } from "../services/cursor-service.js";
import {
  appendDescendingCursorFilter,
  appendEqualsFilter,
  appendInFilter,
  appendRangeFilter,
  buildWhereClause,
  type SqlParameter,
} from "./query-utils.js";
import {
  fromDbEnforcementAction,
  parseJsonArray,
  parseJsonRecord,
  toDbEnforcementAction,
} from "./sql-mappers.js";

export interface ToolCallsListQuery extends CommonListQuery {
  toolName?: string;
  resultStatus?: string;
  approvalId?: string;
}

interface ToolCallListRow {
  tool_call_id: string;
  session_key: string | null;
  run_id: string | null;
  approval_id: string | null;
  tool_name: string;
  risk_level: ToolCallListItemDto["riskLevel"] | null;
  risk_score: number | null;
  policy_decision: string | null;
  enforcement_action: string;
  started_at: number;
  finished_at: number | null;
  duration_ms: number | null;
  result_status: string | null;
  result_excerpt: string | null;
}

interface ToolCallDetailRow extends ToolCallListRow {
  param_summary: string | null;
  param_hash: string | null;
  triggered_modules_json: string | null;
  error_text: string | null;
  metadata_json: string | null;
}

export function mapToolCallListRow(row: ToolCallListRow): ToolCallListItemDto {
  return {
    toolCallId: row.tool_call_id,
    sessionKey: row.session_key ?? undefined,
    runId: row.run_id ?? undefined,
    approvalId: row.approval_id ?? undefined,
    toolName: row.tool_name,
    riskLevel: row.risk_level ?? undefined,
    riskScore: row.risk_score ?? undefined,
    policyDecision: row.policy_decision ?? undefined,
    enforcementAction: fromDbEnforcementAction(row.enforcement_action) ?? "allow",
    startedAtMs: row.started_at,
    finishedAtMs: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    resultStatus: row.result_status ?? undefined,
    resultExcerpt: row.result_excerpt ?? undefined,
  };
}

export class ToolCallsRepository {
  constructor(private readonly database: Database.Database) {}

  list(query: ToolCallsListQuery): ToolCallListResponse {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const filters: string[] = [];
    const parameters: SqlParameter[] = [];

    appendRangeFilter(filters, parameters, "started_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "session_key", query.sessionKey);
    appendEqualsFilter(filters, parameters, "run_id", query.runId);
    appendEqualsFilter(filters, parameters, "tool_name", query.toolName);
    appendEqualsFilter(filters, parameters, "result_status", query.resultStatus);
    appendEqualsFilter(filters, parameters, "approval_id", query.approvalId);
    appendInFilter(filters, parameters, "risk_level", query.riskLevel);
    appendInFilter(
      filters,
      parameters,
      "enforcement_action",
      query.enforcementAction?.map((value) => toDbEnforcementAction(value)),
    );
    appendDescendingCursorFilter(filters, parameters, "started_at", "tool_call_id", cursor);

    const rows = this.database
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
        ${buildWhereClause(filters)}
        ORDER BY started_at DESC, tool_call_id DESC
        LIMIT ?
        `,
      )
      .all(...parameters, limit + 1) as ToolCallListRow[];

    return buildCursorPage(
      rows,
      limit,
      mapToolCallListRow,
      (row) => ({
        sortValue: row.started_at,
        id: row.tool_call_id,
      }),
    );
  }

  getById(toolCallId: string): ToolCallDetailDto | null {
    const row = this.database
      .prepare(
        `
        SELECT
          tool_call_id,
          session_key,
          run_id,
          approval_id,
          tool_name,
          param_summary,
          param_hash,
          triggered_modules_json,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          started_at,
          finished_at,
          duration_ms,
          result_status,
          result_excerpt,
          error_text,
          metadata_json
        FROM tool_calls
        WHERE tool_call_id = ?
        `,
      )
      .get(toolCallId) as ToolCallDetailRow | undefined;

    if (!row) {
      return null;
    }

    return {
      ...mapToolCallListRow(row),
      paramSummary: row.param_summary ?? undefined,
      paramHash: row.param_hash ?? undefined,
      triggeredModules: parseJsonArray<string>(row.triggered_modules_json),
      errorText: row.error_text ?? undefined,
      metadataJson: parseJsonRecord(row.metadata_json),
    };
  }
}
