package repo

import (
	"database/sql"
	"errors"

	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type EventsListQuery struct {
	Q                       *string
	FromMs                  *int64
	ToMs                    *int64
	SessionKey              *string
	RunID                   *string
	RiskLevel               []string
	EnforcementAction       []string
	PageNum                 *int
	PageSize                *int
	Limit                   *int
	Cursor                  *string
	HookName                *string
	EventType               *string
	Category                *string
	SubCategory             *string
	Direction               *string
	PrimaryModule           *string
	RequestID               *string
	ToolCallID              *string
	ApprovalID              *string
	IncludeRoutineHeartbeat *bool
}

type auditEventListRow struct {
	EventID           string
	QARecordID        sql.NullString
	SessionKey        sql.NullString
	RunID             sql.NullString
	ToolCallID        sql.NullString
	ApprovalID        sql.NullString
	RequestID         sql.NullString
	SourceKind        string
	HookName          string
	EventType         string
	Category          string
	SubCategory       sql.NullString
	Direction         sql.NullString
	PrimaryModule     sql.NullString
	RiskLevel         sql.NullString
	RiskScore         sql.NullInt64
	PolicyDecision    sql.NullString
	EnforcementAction string
	Title             string
	Summary           sql.NullString
	Recommendation    sql.NullString
	ContentExcerpt    sql.NullString
	OccurredAt        int64
}

type auditEventDetailRow struct {
	auditEventListRow
	ContentKind sql.NullString
	ModulesJSON sql.NullString
	ContentHash sql.NullString
	IngestedAt  int64
	PayloadJSON sql.NullString
}

func (r *EventsRepository) List(query EventsListQuery) (service.PageResponse[map[string]any], error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	filter := &Filter{}
	filter.AppendTextSearch([]string{
		"event_id", "session_key", "run_id", "tool_call_id", "approval_id",
		"request_id", "hook_name", "event_type", "category", "sub_category",
		"direction", "primary_module", "risk_level", "policy_decision",
		"enforcement_action", "title", "summary", "recommendation", "content_excerpt",
	}, query.Q)
	filter.AppendRange("occurred_at", query.FromMs, query.ToMs)
	filter.AppendEquals("session_key", query.SessionKey)
	filter.AppendEquals("run_id", query.RunID)
	filter.AppendEquals("hook_name", query.HookName)
	filter.AppendEquals("event_type", query.EventType)
	filter.AppendEquals("category", query.Category)
	filter.AppendEquals("sub_category", query.SubCategory)
	filter.AppendEquals("direction", query.Direction)
	filter.AppendEquals("primary_module", query.PrimaryModule)
	filter.AppendEquals("request_id", query.RequestID)
	filter.AppendEquals("tool_call_id", query.ToolCallID)
	filter.AppendEquals("approval_id", query.ApprovalID)
	filter.AppendRiskLevelIn("risk_level", query.RiskLevel)
	filter.AppendIn("enforcement_action", mapStringSlice(query.EnforcementAction, toDBEnforcementAction))
	appendRoutineHeartbeatDefaultFilter(filter, query.IncludeRoutineHeartbeat)

	total, err := countRows(r.db, "audit_events", filter)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}

	rows, err := r.db.Query(
		`
		SELECT
			event_id, qa_record_id, session_key, run_id, tool_call_id, approval_id, request_id,
			source_kind, hook_name, event_type, category, sub_category, direction,
			primary_module, risk_level, risk_score, policy_decision, enforcement_action,
			title, summary, recommendation, content_excerpt, occurred_at
		FROM audit_events `+filter.Where()+`
		ORDER BY occurred_at DESC, event_id DESC
		LIMIT ? OFFSET ?`,
		append(filter.Params(), page.PageSize, page.Offset)...,
	)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}
	defer rows.Close()

	all := make([]auditEventListRow, 0, page.PageSize)
	for rows.Next() {
		var row auditEventListRow
		if err := rows.Scan(
			&row.EventID, &row.QARecordID, &row.SessionKey, &row.RunID, &row.ToolCallID, &row.ApprovalID,
			&row.RequestID, &row.SourceKind, &row.HookName, &row.EventType, &row.Category,
			&row.SubCategory, &row.Direction, &row.PrimaryModule, &row.RiskLevel,
			&row.RiskScore, &row.PolicyDecision, &row.EnforcementAction, &row.Title,
			&row.Summary, &row.Recommendation, &row.ContentExcerpt, &row.OccurredAt,
		); err != nil {
			return service.PageResponse[map[string]any]{}, err
		}
		all = append(all, row)
	}
	if err := rows.Err(); err != nil {
		return service.PageResponse[map[string]any]{}, err
	}

	items := make([]map[string]any, 0, len(all))
	for _, row := range all {
		items = append(items, mapAuditEventListRow(row))
	}
	return service.BuildPageResponse(items, total, page), nil
}

func (r *EventsRepository) GetByID(eventID string) (map[string]any, error) {
	var row auditEventDetailRow
	err := r.db.QueryRow(
		`
		SELECT
			event_id, qa_record_id, session_key, run_id, tool_call_id, approval_id, request_id,
			source_kind, hook_name, event_type, category, sub_category, direction,
			primary_module, risk_level, risk_score, policy_decision, enforcement_action,
			title, summary, recommendation, content_excerpt, occurred_at,
			content_kind, modules_json, content_hash, ingested_at, payload_json
		FROM audit_events
		WHERE event_id = ?`,
		eventID,
	).Scan(
		&row.EventID, &row.QARecordID, &row.SessionKey, &row.RunID, &row.ToolCallID, &row.ApprovalID,
		&row.RequestID, &row.SourceKind, &row.HookName, &row.EventType, &row.Category,
		&row.SubCategory, &row.Direction, &row.PrimaryModule, &row.RiskLevel,
		&row.RiskScore, &row.PolicyDecision, &row.EnforcementAction, &row.Title,
		&row.Summary, &row.Recommendation, &row.ContentExcerpt, &row.OccurredAt,
		&row.ContentKind, &row.ModulesJSON, &row.ContentHash, &row.IngestedAt,
		&row.PayloadJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	out := mapAuditEventListRow(row.auditEventListRow)
	putString(out, "contentKind", row.ContentKind)
	putJSONArray[string](out, "modules", row.ModulesJSON)
	putString(out, "contentHash", row.ContentHash)
	out["ingestedAtMs"] = row.IngestedAt
	putJSONRecord(out, "payloadJson", row.PayloadJSON)
	return out, nil
}

func mapAuditEventListRow(row auditEventListRow) map[string]any {
	out := map[string]any{
		"eventId":           row.EventID,
		"sourceKind":        row.SourceKind,
		"hookName":          row.HookName,
		"eventType":         row.EventType,
		"category":          row.Category,
		"enforcementAction": fromDBEnforcementAction(row.EnforcementAction),
		"title":             row.Title,
		"occurredAtMs":      row.OccurredAt,
	}
	putString(out, "sessionKey", row.SessionKey)
	putString(out, "qaRecordId", row.QARecordID)
	putString(out, "runId", row.RunID)
	putString(out, "toolCallId", row.ToolCallID)
	putString(out, "approvalId", row.ApprovalID)
	putString(out, "requestId", row.RequestID)
	putString(out, "subCategory", row.SubCategory)
	putString(out, "direction", row.Direction)
	putString(out, "primaryModule", row.PrimaryModule)
	putRiskLevel(out, "riskLevel", row.RiskLevel)
	putInt64(out, "riskScore", row.RiskScore)
	putString(out, "policyDecision", row.PolicyDecision)
	putString(out, "summary", row.Summary)
	putString(out, "recommendation", row.Recommendation)
	putString(out, "contentExcerpt", row.ContentExcerpt)
	return out
}

func appendRoutineHeartbeatDefaultFilter(filter *Filter, includeRoutineHeartbeat *bool) {
	if includeRoutineHeartbeat != nil && *includeRoutineHeartbeat {
		return
	}
	filter.clauses = append(filter.clauses, `
		NOT (
			risk_level IS NULL
			AND risk_score IS NULL
			AND primary_module IS NULL
			AND (modules_json IS NULL OR modules_json = '[]')
			AND (policy_decision IS NULL OR policy_decision NOT IN ('deny', 'confirm', 'block', 'requireApproval', 'require_approval'))
			AND enforcement_action NOT IN ('block', 'redact', 'require_approval')
			AND (
				lower(COALESCE(content_excerpt, '') || ' ' || COALESCE(summary, '') || ' ' || COALESCE(payload_json, '')) LIKE '%heartbeat_ok%'
				OR (
					lower(COALESCE(content_excerpt, '') || ' ' || COALESCE(summary, '') || ' ' || COALESCE(payload_json, '')) LIKE '%read heartbeat.md if it exists%'
					AND lower(COALESCE(content_excerpt, '') || ' ' || COALESCE(summary, '') || ' ' || COALESCE(payload_json, '')) LIKE '%workspace context%'
				)
				OR (
					lower(COALESCE(content_excerpt, '') || ' ' || COALESCE(summary, '') || ' ' || COALESCE(payload_json, '')) LIKE '%# heartbeat.md template%'
					AND lower(COALESCE(content_excerpt, '') || ' ' || COALESCE(summary, '') || ' ' || COALESCE(payload_json, '')) LIKE '%skip heartbeat api calls%'
				)
				OR (
					lower(COALESCE(content_excerpt, '') || ' ' || COALESCE(summary, '') || ' ' || COALESCE(payload_json, '')) LIKE '%enoent%'
					AND lower(COALESCE(content_excerpt, '') || ' ' || COALESCE(summary, '') || ' ' || COALESCE(payload_json, '')) LIKE '%heartbeat.md%'
				)
				OR (
					hook_name IN ('before_tool_call', 'after_tool_call', 'tool_result_persist')
					AND lower(COALESCE(payload_json, '')) LIKE '%"toolname":"read"%'
					AND lower(COALESCE(payload_json, '')) LIKE '%heartbeat.md%'
				)
			)
		)
	`)
}

func mapStringSlice(values []string, mapper func(string) string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = append(out, mapper(value))
	}
	return out
}
