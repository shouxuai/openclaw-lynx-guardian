import type Database from "better-sqlite3";

import type {
  LynxCheckDetailDto,
  LynxCheckListItemDto,
  LynxCheckListResponse,
} from "../../../shared/src/query-dto.js";
import { buildCursorPage, decodeDescendingCursor, resolveListLimit } from "../services/cursor-service.js";
import {
  appendDescendingCursorFilter,
  appendEqualsFilter,
  appendRangeFilter,
  buildWhereClause,
  type SqlParameter,
} from "./query-utils.js";
import { fromDbBoolean, parseJsonArray } from "./sql-mappers.js";

export interface LynxChecksListQuery {
  fromMs?: number;
  toMs?: number;
  sessionKey?: string;
  limit?: number;
  cursor?: string;
  source?: string;
  trigger?: string;
  status?: string;
  messageProvider?: string;
}

interface LynxCheckListRow {
  request_id: string;
  source: LynxCheckListItemDto["source"];
  trigger: LynxCheckListItemDto["trigger"];
  preferred_target_kind: LynxCheckListItemDto["preferredTargetKind"];
  session_key: string | null;
  target_key: string | null;
  channel_id: string | null;
  message_provider: string | null;
  status: string;
  send_attempted: number;
  send_succeeded: number;
  transport: string | null;
  report_path: string | null;
  error_message: string | null;
  created_at: number;
  completed_at: number | null;
}

interface LynxCheckDetailRow extends LynxCheckListRow {
  delivery_attempts_json: string | null;
}

export function mapLynxCheckListRow(row: LynxCheckListRow): LynxCheckListItemDto {
  return {
    requestId: row.request_id,
    source: row.source,
    trigger: row.trigger,
    preferredTargetKind: row.preferred_target_kind,
    sessionKey: row.session_key ?? undefined,
    targetKey: row.target_key ?? undefined,
    channelId: row.channel_id ?? undefined,
    messageProvider: row.message_provider ?? undefined,
    status: row.status,
    sendAttempted: fromDbBoolean(row.send_attempted),
    sendSucceeded: fromDbBoolean(row.send_succeeded),
    transport: row.transport ?? undefined,
    reportPath: row.report_path ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAtMs: row.created_at,
    completedAtMs: row.completed_at ?? undefined,
  };
}

export class LynxChecksRepository {
  constructor(private readonly database: Database.Database) {}

  list(query: LynxChecksListQuery): LynxCheckListResponse {
    const limit = resolveListLimit(query.limit);
    const cursor = decodeDescendingCursor(query.cursor);
    const filters: string[] = [];
    const parameters: SqlParameter[] = [];

    appendRangeFilter(filters, parameters, "created_at", query.fromMs, query.toMs);
    appendEqualsFilter(filters, parameters, "session_key", query.sessionKey);
    appendEqualsFilter(filters, parameters, "source", query.source);
    appendEqualsFilter(filters, parameters, "trigger", query.trigger);
    appendEqualsFilter(filters, parameters, "status", query.status);
    appendEqualsFilter(filters, parameters, "message_provider", query.messageProvider);
    appendDescendingCursorFilter(filters, parameters, "created_at", "request_id", cursor);

    const rows = this.database
      .prepare(
        `
        SELECT
          request_id,
          source,
          trigger,
          preferred_target_kind,
          session_key,
          target_key,
          channel_id,
          message_provider,
          status,
          send_attempted,
          send_succeeded,
          transport,
          report_path,
          error_message,
          created_at,
          completed_at
        FROM lynx_checks
        ${buildWhereClause(filters)}
        ORDER BY created_at DESC, request_id DESC
        LIMIT ?
        `,
      )
      .all(...parameters, limit + 1) as LynxCheckListRow[];

    return buildCursorPage(
      rows,
      limit,
      mapLynxCheckListRow,
      (row) => ({
        sortValue: row.created_at,
        id: row.request_id,
      }),
    );
  }

  getById(requestId: string): LynxCheckDetailDto | null {
    const row = this.database
      .prepare(
        `
        SELECT
          request_id,
          source,
          trigger,
          preferred_target_kind,
          session_key,
          target_key,
          channel_id,
          message_provider,
          status,
          send_attempted,
          send_succeeded,
          transport,
          report_path,
          error_message,
          delivery_attempts_json,
          created_at,
          completed_at
        FROM lynx_checks
        WHERE request_id = ?
        `,
      )
      .get(requestId) as LynxCheckDetailRow | undefined;

    if (!row) {
      return null;
    }

    return {
      ...mapLynxCheckListRow(row),
      deliveryAttemptsJson: parseJsonArray<Record<string, unknown>>(row.delivery_attempts_json),
    };
  }
}
