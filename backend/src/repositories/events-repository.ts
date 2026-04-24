import type Database from "better-sqlite3";

import type {
  AuditEventDetailDto,
  AuditEventListItemDto,
  AuditEventListResponse,
  CommonListQuery,
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

export interface EventsListQuery extends CommonListQuery {
  hookName?: string;
  eventType?: string;
  category?: string;
  subCategory?: string;
  direction?: string;
  primaryModule?: string;
  requestId?: string;
  toolCallId?: string;
  approvalId?: string;
}

interface AuditEventListRow {
  event_id: string;
  session_key: string | null;
  run_id: string | null;
  tool_call_id: string | null;
  approval_id: string | null;
  request_id: string | null;
  source_kind: string;
  hook_name: string;
  event_type: string;
  category: string;
  sub_category: string | null;
  direction: string | null;
  primary_module: string | null;
  risk_level: AuditEventListItemDto["riskLevel"] | null;
  risk_score: number | null;
  policy_decision: string | null;
  enforcement_action: string;
  title: string;
  summary: string | null;
  content_excerpt: string | null;
  occurred_at: number;
}

interface AuditEventDetailRow extends AuditEventListRow {
  content_kind: string | null;
  modules_json: string | null;
  recommendation: string | null;
  content_hash: string | null;
  ingested_at: number;
  payload_json: string | null;
}

export function mapAuditEventListRow(row: AuditEventListRow): AuditEventListItemDto {
  return {
    eventId: row.event_id,
    sessionKey: row.session_key ?? undefined,
    runId: row.run_id ?? undefined,
    toolCallId: row.tool_call_id ?? undefined,
    approvalId: row.approval_id ?? undefined,
    requestId: row.request_id ?? undefined,
    sourceKind: row.source_kind,
    hookName: row.hook_name,
    eventType: row.event_type,
    category: row.category,
    subCategory: row.sub_category ?? undefined,
    direction: row.direction ?? undefined,
    primaryModule: row.primary_module ?? undefined,
    riskLevel: row.risk_level ?? undefined,
    riskScore: row.risk_score ?? undefined,
    policyDecision: row.policy_decision ?? undefined,
    enforcementAction: fromDbEnforcementAction(row.enforcement_action) ?? "allow",
    title: row.title,
    summary: row.summary ?? undefined,
    contentExcerpt: row.content_excerpt ?? undefined,
    occurredAtMs: row.occurred_at,
  };
}

export class EventsRepository {
  constructor(private readonly database: Database.Database) {}

  list(query: EventsListQuery): AuditEventListResponse {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const filters: string[] = [];
    const parameters: SqlParameter[] = [];

    appendRangeFilter(filters, parameters, "occurred_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "session_key", query.sessionKey);
    appendEqualsFilter(filters, parameters, "run_id", query.runId);
    appendEqualsFilter(filters, parameters, "hook_name", query.hookName);
    appendEqualsFilter(filters, parameters, "event_type", query.eventType);
    appendEqualsFilter(filters, parameters, "category", query.category);
    appendEqualsFilter(filters, parameters, "sub_category", query.subCategory);
    appendEqualsFilter(filters, parameters, "direction", query.direction);
    appendEqualsFilter(filters, parameters, "primary_module", query.primaryModule);
    appendEqualsFilter(filters, parameters, "request_id", query.requestId);
    appendEqualsFilter(filters, parameters, "tool_call_id", query.toolCallId);
    appendEqualsFilter(filters, parameters, "approval_id", query.approvalId);
    appendInFilter(filters, parameters, "risk_level", query.riskLevel);
    appendInFilter(
      filters,
      parameters,
      "enforcement_action",
      query.enforcementAction?.map((value) => toDbEnforcementAction(value)),
    );
    appendDescendingCursorFilter(filters, parameters, "occurred_at", "event_id", cursor);

    const rows = this.database
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
        ${buildWhereClause(filters)}
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT ?
        `,
      )
      .all(...parameters, limit + 1) as AuditEventListRow[];

    return buildCursorPage(
      rows,
      limit,
      mapAuditEventListRow,
      (row) => ({
        sortValue: row.occurred_at,
        id: row.event_id,
      }),
    );
  }

  getById(eventId: string): AuditEventDetailDto | null {
    const row = this.database
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
          content_kind,
          primary_module,
          modules_json,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          title,
          summary,
          recommendation,
          content_excerpt,
          content_hash,
          occurred_at,
          ingested_at,
          payload_json
        FROM audit_events
        WHERE event_id = ?
        `,
      )
      .get(eventId) as AuditEventDetailRow | undefined;

    if (!row) {
      return null;
    }

    return {
      ...mapAuditEventListRow(row),
      contentKind: row.content_kind ?? undefined,
      modules: parseJsonArray<string>(row.modules_json),
      recommendation: row.recommendation ?? undefined,
      contentHash: row.content_hash ?? undefined,
      ingestedAtMs: row.ingested_at,
      payloadJson: parseJsonRecord(row.payload_json),
    };
  }
}
