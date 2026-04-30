package repo

import (
	"database/sql"
	"errors"

	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type ToolCallsListQuery struct {
	FromMs            *int64
	ToMs              *int64
	SessionKey        *string
	RunID             *string
	RiskLevel         []string
	EnforcementAction []string
	PageNum           *int
	PageSize          *int
	Limit             *int
	Cursor            *string
	ToolName          *string
	ResultStatus      *string
	ApprovalID        *string
}

type toolCallListRow struct {
	ToolCallID        string
	QARecordID        sql.NullString
	SessionKey        sql.NullString
	RunID             sql.NullString
	ApprovalID        sql.NullString
	ToolName          string
	RiskLevel         sql.NullString
	RiskScore         sql.NullInt64
	PolicyDecision    sql.NullString
	EnforcementAction string
	StartedAt         int64
	FinishedAt        sql.NullInt64
	DurationMs        sql.NullInt64
	ResultStatus      sql.NullString
	ResultExcerpt     sql.NullString
}

type toolCallDetailRow struct {
	toolCallListRow
	ParamSummary         sql.NullString
	ParamHash            sql.NullString
	TriggeredModulesJSON sql.NullString
	ErrorText            sql.NullString
	MetadataJSON         sql.NullString
}

func (r *ToolCallsRepository) List(query ToolCallsListQuery) (service.PageResponse[map[string]any], error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	filter := &Filter{}
	filter.AppendRange("started_at", query.FromMs, query.ToMs)
	filter.AppendEquals("session_key", query.SessionKey)
	filter.AppendEquals("run_id", query.RunID)
	filter.AppendEquals("tool_name", query.ToolName)
	filter.AppendEquals("result_status", query.ResultStatus)
	filter.AppendEquals("approval_id", query.ApprovalID)
	filter.AppendRiskLevelIn("risk_level", query.RiskLevel)
	filter.AppendIn("enforcement_action", mapStringSlice(query.EnforcementAction, toDBEnforcementAction))

	total, err := countRows(r.db, "tool_calls", filter)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}

	rows, err := r.db.Query(
		`
		SELECT
			tool_call_id, qa_record_id, session_key, run_id, approval_id, tool_name, risk_level,
			risk_score, policy_decision, enforcement_action, started_at, finished_at,
			duration_ms, result_status, result_excerpt
		FROM tool_calls `+filter.Where()+`
		ORDER BY started_at DESC, tool_call_id DESC
		LIMIT ? OFFSET ?`,
		append(filter.Params(), page.PageSize, page.Offset)...,
	)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}
	defer rows.Close()

	all := make([]toolCallListRow, 0, page.PageSize)
	for rows.Next() {
		var row toolCallListRow
		if err := rows.Scan(
			&row.ToolCallID, &row.QARecordID, &row.SessionKey, &row.RunID, &row.ApprovalID,
			&row.ToolName, &row.RiskLevel, &row.RiskScore, &row.PolicyDecision,
			&row.EnforcementAction, &row.StartedAt, &row.FinishedAt, &row.DurationMs,
			&row.ResultStatus, &row.ResultExcerpt,
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
		items = append(items, mapToolCallListRow(row))
	}
	return service.BuildPageResponse(items, total, page), nil
}

func (r *ToolCallsRepository) GetByID(toolCallID string) (map[string]any, error) {
	var row toolCallDetailRow
	err := r.db.QueryRow(
		`
		SELECT
			tool_call_id, qa_record_id, session_key, run_id, approval_id, tool_name, risk_level,
			risk_score, policy_decision, enforcement_action, started_at, finished_at,
			duration_ms, result_status, result_excerpt, param_summary, param_hash,
			triggered_modules_json, error_text, metadata_json
		FROM tool_calls
		WHERE tool_call_id = ?`,
		toolCallID,
	).Scan(
		&row.ToolCallID, &row.QARecordID, &row.SessionKey, &row.RunID, &row.ApprovalID,
		&row.ToolName, &row.RiskLevel, &row.RiskScore, &row.PolicyDecision,
		&row.EnforcementAction, &row.StartedAt, &row.FinishedAt, &row.DurationMs,
		&row.ResultStatus, &row.ResultExcerpt, &row.ParamSummary, &row.ParamHash,
		&row.TriggeredModulesJSON, &row.ErrorText, &row.MetadataJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	out := mapToolCallListRow(row.toolCallListRow)
	putString(out, "paramSummary", row.ParamSummary)
	putString(out, "paramHash", row.ParamHash)
	putJSONArray[string](out, "triggeredModules", row.TriggeredModulesJSON)
	putString(out, "errorText", row.ErrorText)
	putJSONRecord(out, "metadataJson", row.MetadataJSON)
	return out, nil
}

func mapToolCallListRow(row toolCallListRow) map[string]any {
	out := map[string]any{
		"toolCallId":        row.ToolCallID,
		"toolName":          row.ToolName,
		"enforcementAction": fromDBEnforcementAction(row.EnforcementAction),
		"startedAtMs":       row.StartedAt,
	}
	putString(out, "sessionKey", row.SessionKey)
	putString(out, "qaRecordId", row.QARecordID)
	putString(out, "runId", row.RunID)
	putString(out, "approvalId", row.ApprovalID)
	putRiskLevel(out, "riskLevel", row.RiskLevel)
	putInt64(out, "riskScore", row.RiskScore)
	putString(out, "policyDecision", row.PolicyDecision)
	putInt64(out, "finishedAtMs", row.FinishedAt)
	putInt64(out, "durationMs", row.DurationMs)
	putString(out, "resultStatus", row.ResultStatus)
	putString(out, "resultExcerpt", row.ResultExcerpt)
	return out
}
