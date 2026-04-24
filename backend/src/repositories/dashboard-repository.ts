import type Database from "better-sqlite3";

import type {
  DashboardOverviewDto,
  EnforcementBucketDto,
  RiskBucketDto,
  TimeSeriesPointDto,
} from "../../../shared/src/query-dto.js";
import { mapApprovalListRow } from "./approvals-repository.js";
import { mapAuditEventListRow } from "./events-repository.js";
import { buildWhereClause, type SqlParameter } from "./query-utils.js";
import { fromDbEnforcementAction } from "./sql-mappers.js";
import { mapToolCallListRow } from "./tool-calls-repository.js";

export interface DashboardOverviewQuery {
  fromMs?: number;
  toMs?: number;
}

function buildTimeRangeWhere(fieldName: string, fromMs?: number, toMs?: number) {
  const filters: string[] = [];
  const parameters: SqlParameter[] = [];
  if (typeof fromMs === "number" && Number.isFinite(fromMs)) {
    filters.push(`${fieldName} >= ?`);
    parameters.push(Math.trunc(fromMs));
  }
  if (typeof toMs === "number" && Number.isFinite(toMs)) {
    filters.push(`${fieldName} <= ?`);
    parameters.push(Math.trunc(toMs));
  }
  return {
    whereClause: buildWhereClause(filters),
    parameters,
  };
}

export class DashboardRepository {
  constructor(private readonly database: Database.Database) {}

  getOverview(query: DashboardOverviewQuery): DashboardOverviewDto {
    const eventsRange = buildTimeRangeWhere("occurred_at", query.fromMs, query.toMs);
    const toolCallsRange = buildTimeRangeWhere("started_at", query.fromMs, query.toMs);
    const approvalsRange = buildTimeRangeWhere("requested_at", query.fromMs, query.toMs);
    const lynxChecksRange = buildTimeRangeWhere("created_at", query.fromMs, query.toMs);
    const tokensRange = buildTimeRangeWhere("occurred_at", query.fromMs, query.toMs);

    const totals = {
      eventCount: (
        this.database
          .prepare(`SELECT COUNT(*) AS count FROM audit_events ${eventsRange.whereClause}`)
          .get(...eventsRange.parameters) as { count: number }
      ).count,
      highRiskEventCount: (
        this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM audit_events ${eventsRange.whereClause ? `${eventsRange.whereClause} AND` : "WHERE"} risk_level IN ('L3', 'L4')`,
          )
          .get(...eventsRange.parameters) as { count: number }
      ).count,
      toolCallCount: (
        this.database
          .prepare(`SELECT COUNT(*) AS count FROM tool_calls ${toolCallsRange.whereClause}`)
          .get(...toolCallsRange.parameters) as { count: number }
      ).count,
      approvalCount: (
        this.database
          .prepare(`SELECT COUNT(*) AS count FROM approvals ${approvalsRange.whereClause}`)
          .get(...approvalsRange.parameters) as { count: number }
      ).count,
      lynxCheckCount: (
        this.database
          .prepare(`SELECT COUNT(*) AS count FROM lynx_checks ${lynxChecksRange.whereClause}`)
          .get(...lynxChecksRange.parameters) as { count: number }
      ).count,
      totalTokens: (
        this.database
          .prepare(`SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens FROM token_usage ${tokensRange.whereClause}`)
          .get(...tokensRange.parameters) as { total_tokens: number }
      ).total_tokens,
    };

    const riskDistribution = this.database
      .prepare(
        `
        SELECT risk_level, COUNT(*) AS count
        FROM audit_events
        ${eventsRange.whereClause ? `${eventsRange.whereClause} AND` : "WHERE"} risk_level IS NOT NULL
        GROUP BY risk_level
        ORDER BY risk_level ASC
        `,
      )
      .all(...eventsRange.parameters) as Array<{ risk_level: RiskBucketDto["riskLevel"]; count: number }>;

    const enforcementDistribution = this.database
      .prepare(
        `
        SELECT enforcement_action, COUNT(*) AS count
        FROM audit_events
        ${eventsRange.whereClause}
        GROUP BY enforcement_action
        ORDER BY enforcement_action ASC
        `,
      )
      .all(...eventsRange.parameters) as Array<{ enforcement_action: string; count: number }>;

    const eventTrend = this.database
      .prepare(
        `
        SELECT
          CAST(occurred_at / 3600000 AS INTEGER) * 3600000 AS bucket_start_ms,
          COUNT(*) AS value
        FROM audit_events
        ${eventsRange.whereClause}
        GROUP BY bucket_start_ms
        ORDER BY bucket_start_ms ASC
        `,
      )
      .all(...eventsRange.parameters) as Array<{ bucket_start_ms: number; value: number }>;

    const tokenTrend = this.database
      .prepare(
        `
        SELECT
          CAST(occurred_at / 3600000 AS INTEGER) * 3600000 AS bucket_start_ms,
          COALESCE(SUM(total_tokens), 0) AS value
        FROM token_usage
        ${tokensRange.whereClause}
        GROUP BY bucket_start_ms
        ORDER BY bucket_start_ms ASC
        `,
      )
      .all(...tokensRange.parameters) as Array<{ bucket_start_ms: number; value: number }>;

    const recentHighRiskEvents = this.database
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
        ${eventsRange.whereClause ? `${eventsRange.whereClause} AND` : "WHERE"} risk_level IN ('L3', 'L4')
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT 5
        `,
      )
      .all(...eventsRange.parameters)
      .map((row) => mapAuditEventListRow(row as never));

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
        ${toolCallsRange.whereClause}
        ORDER BY started_at DESC, tool_call_id DESC
        LIMIT 5
        `,
      )
      .all(...toolCallsRange.parameters)
      .map((row) => mapToolCallListRow(row as never));

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
        ${approvalsRange.whereClause}
        ORDER BY requested_at DESC, approval_id DESC
        LIMIT 5
        `,
      )
      .all(...approvalsRange.parameters)
      .map((row) => mapApprovalListRow(row as never));

    return {
      totals,
      riskDistribution: riskDistribution.map((row) => ({
        riskLevel: row.risk_level,
        count: row.count,
      })),
      enforcementDistribution: enforcementDistribution.map((row) => ({
        enforcementAction: fromDbEnforcementAction(row.enforcement_action) ?? "allow",
        count: row.count,
      })),
      eventTrend: eventTrend.map((row) => ({
        bucketStartMs: row.bucket_start_ms,
        value: row.value,
      })) as TimeSeriesPointDto[],
      tokenTrend: tokenTrend.map((row) => ({
        bucketStartMs: row.bucket_start_ms,
        value: row.value,
      })) as TimeSeriesPointDto[],
      recentHighRiskEvents,
      recentToolCalls,
      recentApprovals,
    };
  }
}
