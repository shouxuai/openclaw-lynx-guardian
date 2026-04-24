import type Database from "better-sqlite3";

import type {
  ApprovalDetailDto,
  ApprovalListItemDto,
  ApprovalListResponse,
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
  fromDbApprovalScopeType,
  parseJsonArray,
  parseJsonRecord,
  toDbApprovalScopeType,
} from "./sql-mappers.js";

export interface ApprovalsListQuery {
  fromMs?: number;
  toMs?: number;
  sessionKey?: string;
  runId?: string;
  riskLevel?: string[];
  limit?: number;
  cursor?: string;
  resolution?: string;
  toolName?: string;
  module?: string;
  scopeType?: string;
  requesterOuId?: string;
}

interface ApprovalListRow {
  approval_id: string;
  pending_id: string | null;
  session_key: string | null;
  run_id: string | null;
  transport: string | null;
  requester_ou_id: string | null;
  module: string;
  risk_level: ApprovalListItemDto["riskLevel"];
  tool_name: string | null;
  scope_type: string;
  requested_at: number;
  expires_at: number;
  resolved_at: number | null;
  resolution: string | null;
  prompt_excerpt: string | null;
}

interface ApprovalDetailRow extends ApprovalListRow {
  channel_profile: string | null;
  channel_id: string | null;
  account_id: string | null;
  conversation_id: string | null;
  approver_ou_ids_json: string | null;
  resolved_approver_ou_id: string | null;
  request_fingerprint_hash: string | null;
  audit_summary_json: string | null;
  metadata_json: string | null;
}

export function mapApprovalListRow(row: ApprovalListRow): ApprovalListItemDto {
  return {
    approvalId: row.approval_id,
    pendingId: row.pending_id ?? undefined,
    sessionKey: row.session_key ?? undefined,
    runId: row.run_id ?? undefined,
    transport: row.transport ?? undefined,
    requesterOuId: row.requester_ou_id ?? undefined,
    module: row.module,
    riskLevel: row.risk_level,
    toolName: row.tool_name ?? undefined,
    scopeType: fromDbApprovalScopeType(row.scope_type) ?? "workflow",
    requestedAtMs: row.requested_at,
    expiresAtMs: row.expires_at,
    resolvedAtMs: row.resolved_at ?? undefined,
    resolution: row.resolution ?? undefined,
    promptExcerpt: row.prompt_excerpt ?? undefined,
  };
}

export class ApprovalsRepository {
  constructor(private readonly database: Database.Database) {}

  list(query: ApprovalsListQuery): ApprovalListResponse {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const filters: string[] = [];
    const parameters: SqlParameter[] = [];

    appendRangeFilter(filters, parameters, "requested_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "session_key", query.sessionKey);
    appendEqualsFilter(filters, parameters, "run_id", query.runId);
    appendEqualsFilter(filters, parameters, "resolution", query.resolution);
    appendEqualsFilter(filters, parameters, "tool_name", query.toolName);
    appendEqualsFilter(filters, parameters, "module", query.module);
    appendEqualsFilter(filters, parameters, "requester_ou_id", query.requesterOuId);
    appendInFilter(filters, parameters, "risk_level", query.riskLevel);
    appendEqualsFilter(
      filters,
      parameters,
      "scope_type",
      query.scopeType ? toDbApprovalScopeType(query.scopeType as ApprovalDetailDto["scopeType"]) : undefined,
    );
    appendDescendingCursorFilter(filters, parameters, "requested_at", "approval_id", cursor);

    const rows = this.database
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
        ${buildWhereClause(filters)}
        ORDER BY requested_at DESC, approval_id DESC
        LIMIT ?
        `,
      )
      .all(...parameters, limit + 1) as ApprovalListRow[];

    return buildCursorPage(
      rows,
      limit,
      mapApprovalListRow,
      (row) => ({
        sortValue: row.requested_at,
        id: row.approval_id,
      }),
    );
  }

  getById(approvalId: string): ApprovalDetailDto | null {
    const row = this.database
      .prepare(
        `
        SELECT
          approval_id,
          pending_id,
          session_key,
          run_id,
          transport,
          channel_profile,
          channel_id,
          account_id,
          conversation_id,
          requester_ou_id,
          approver_ou_ids_json,
          resolved_approver_ou_id,
          request_fingerprint_hash,
          module,
          risk_level,
          tool_name,
          scope_type,
          requested_at,
          expires_at,
          resolved_at,
          resolution,
          prompt_excerpt,
          audit_summary_json,
          metadata_json
        FROM approvals
        WHERE approval_id = ?
        `,
      )
      .get(approvalId) as ApprovalDetailRow | undefined;

    if (!row) {
      return null;
    }

    return {
      ...mapApprovalListRow(row),
      channelProfile: row.channel_profile ?? undefined,
      channelId: row.channel_id ?? undefined,
      accountId: row.account_id ?? undefined,
      conversationId: row.conversation_id ?? undefined,
      approverOuIds: parseJsonArray<string>(row.approver_ou_ids_json),
      resolvedApproverOuId: row.resolved_approver_ou_id ?? undefined,
      requestFingerprintHash: row.request_fingerprint_hash ?? undefined,
      auditSummaryJson: parseJsonRecord(row.audit_summary_json),
      metadataJson: parseJsonRecord(row.metadata_json),
    };
  }
}
