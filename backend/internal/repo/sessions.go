package repo

import (
	"database/sql"
	"errors"

	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type SessionsListQuery struct {
	Q              *string
	FromMs         *int64
	ToMs           *int64
	PageNum        *int
	PageSize       *int
	Limit          *int
	Cursor         *string
	ChannelProfile *string
	ChannelID      *string
	RequesterID    *string
	RequesterOuID  *string
	IsGroup        *bool
}

type sessionListRow struct {
	SessionKey         string
	ChannelProfile     sql.NullString
	ChannelID          sql.NullString
	RequesterID        sql.NullString
	RequesterOuID      sql.NullString
	AccountID          sql.NullString
	ConversationID     sql.NullString
	ThreadID           sql.NullString
	IsGroup            int64
	FirstSeenAt        int64
	LastSeenAt         int64
	EndedAt            sql.NullInt64
	MetadataJSON       sql.NullString
	EventCount         int64
	HighRiskEventCount int64
	ToolCallCount      int64
}

const sessionCountsSQL = `
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
`

func (r *SessionsRepository) List(query SessionsListQuery) (service.PageResponse[map[string]any], error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	filter := &Filter{}
	filter.AppendTextSearch([]string{
		"s.session_key",
		"s.channel_profile",
		"s.channel_id",
		"s.requester_id",
		"s.requester_ou_id",
		"s.account_id",
		"s.conversation_id",
		"s.thread_id",
		"s.metadata_json",
	}, query.Q)
	filter.AppendRange("s.last_seen_at", query.FromMs, query.ToMs)
	filter.AppendEquals("s.channel_profile", query.ChannelProfile)
	filter.AppendEquals("s.channel_id", query.ChannelID)
	filter.AppendEquals("s.requester_id", query.RequesterID)
	filter.AppendEquals("s.requester_ou_id", query.RequesterOuID)
	filter.AppendBool("s.is_group", query.IsGroup)

	total, err := countRows(r.db, "sessions s", filter)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}

	rows, err := r.db.Query(
		sessionCountsSQL+`
		`+filter.Where()+`
		ORDER BY s.last_seen_at DESC, s.session_key DESC
		LIMIT ? OFFSET ?`,
		append(filter.Params(), page.PageSize, page.Offset)...,
	)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}
	defer rows.Close()

	all := make([]sessionListRow, 0, page.PageSize)
	for rows.Next() {
		row, err := scanSessionListRow(rows)
		if err != nil {
			return service.PageResponse[map[string]any]{}, err
		}
		all = append(all, row)
	}
	if err := rows.Err(); err != nil {
		return service.PageResponse[map[string]any]{}, err
	}

	items := make([]map[string]any, 0, len(all))
	for _, row := range all {
		items = append(items, mapSessionListRow(row))
	}
	return service.BuildPageResponse(items, total, page), nil
}

func (r *SessionsRepository) GetByKey(sessionKey string) (map[string]any, error) {
	var row sessionListRow
	err := r.db.QueryRow(sessionCountsSQL+` WHERE s.session_key = ?`, sessionKey).Scan(sessionScanTargets(&row)...)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	out := mapSessionListRow(row)
	putJSONRecord(out, "metadataJson", row.MetadataJSON)

	recentEvents, err := r.recentEvents(sessionKey)
	if err != nil {
		return nil, err
	}
	recentToolCalls, err := r.recentToolCalls(sessionKey)
	if err != nil {
		return nil, err
	}
	recentApprovals, err := r.recentApprovals(sessionKey)
	if err != nil {
		return nil, err
	}
	out["recentEvents"] = recentEvents
	out["recentToolCalls"] = recentToolCalls
	out["recentApprovals"] = recentApprovals

	tokenSummary, ok, err := r.sessionTokenSummary(sessionKey)
	if err != nil {
		return nil, err
	}
	if ok {
		out["tokenSummary"] = tokenSummary
	}
	return out, nil
}

func (r *SessionsRepository) recentEvents(sessionKey string) ([]map[string]any, error) {
	rows, err := r.db.Query(
		`
		SELECT
			event_id, qa_record_id, session_key, run_id, tool_call_id, approval_id, request_id,
			source_kind, hook_name, event_type, category, sub_category, direction,
			primary_module, risk_level, risk_score, policy_decision, enforcement_action,
			title, summary, recommendation, content_excerpt, occurred_at
		FROM audit_events
		WHERE session_key = ?
		ORDER BY occurred_at DESC, event_id DESC
		LIMIT 5`,
		sessionKey,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var row auditEventListRow
		if err := rows.Scan(
			&row.EventID, &row.QARecordID, &row.SessionKey, &row.RunID, &row.ToolCallID, &row.ApprovalID,
			&row.RequestID, &row.SourceKind, &row.HookName, &row.EventType, &row.Category,
			&row.SubCategory, &row.Direction, &row.PrimaryModule, &row.RiskLevel,
			&row.RiskScore, &row.PolicyDecision, &row.EnforcementAction, &row.Title,
			&row.Summary, &row.Recommendation, &row.ContentExcerpt, &row.OccurredAt,
		); err != nil {
			return nil, err
		}
		out = append(out, mapAuditEventListRow(row))
	}
	return out, rows.Err()
}

func (r *SessionsRepository) recentToolCalls(sessionKey string) ([]map[string]any, error) {
	rows, err := r.db.Query(
		`
		SELECT
			tool_call_id, qa_record_id, session_key, run_id, approval_id, tool_name, risk_level,
			risk_score, policy_decision, enforcement_action, started_at, finished_at,
			duration_ms, result_status, result_excerpt
		FROM tool_calls
		WHERE session_key = ?
		ORDER BY started_at DESC, tool_call_id DESC
		LIMIT 5`,
		sessionKey,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var row toolCallListRow
		if err := rows.Scan(
			&row.ToolCallID, &row.QARecordID, &row.SessionKey, &row.RunID, &row.ApprovalID,
			&row.ToolName, &row.RiskLevel, &row.RiskScore, &row.PolicyDecision,
			&row.EnforcementAction, &row.StartedAt, &row.FinishedAt, &row.DurationMs,
			&row.ResultStatus, &row.ResultExcerpt,
		); err != nil {
			return nil, err
		}
		out = append(out, mapToolCallListRow(row))
	}
	return out, rows.Err()
}

func (r *SessionsRepository) recentApprovals(sessionKey string) ([]any, error) {
	rows, err := r.db.Query(
		`
		SELECT
			approval_id, qa_record_id, pending_id, session_key, run_id, transport, requester_ou_id,
			module, risk_level, tool_name, scope_type, requested_at, expires_at,
			resolved_at, resolution, prompt_excerpt
		FROM approvals
		WHERE session_key = ?
		ORDER BY requested_at DESC, approval_id DESC
		LIMIT 5`,
		sessionKey,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]any, 0)
	for rows.Next() {
		var row approvalListRow
		if err := rows.Scan(
			&row.ApprovalID, &row.QARecordID, &row.PendingID, &row.SessionKey, &row.RunID,
			&row.Transport, &row.RequesterOuID, &row.Module, &row.RiskLevel,
			&row.ToolName, &row.ScopeType, &row.RequestedAt, &row.ExpiresAt,
			&row.ResolvedAt, &row.Resolution, &row.PromptExcerpt,
		); err != nil {
			return nil, err
		}
		out = append(out, mapApprovalListRow(row))
	}
	return out, rows.Err()
}

func (r *SessionsRepository) sessionTokenSummary(sessionKey string) (map[string]any, bool, error) {
	var totalTokens, inputTokens, outputTokens sql.NullInt64
	var rowCount int64
	if err := r.db.QueryRow(
		`
		SELECT
			SUM(total_tokens),
			SUM(input_tokens),
			SUM(output_tokens),
			COUNT(*)
		FROM token_usage
		WHERE session_key = ?`,
		sessionKey,
	).Scan(&totalTokens, &inputTokens, &outputTokens, &rowCount); err != nil {
		return nil, false, err
	}
	if rowCount <= 0 {
		return nil, false, nil
	}
	return map[string]any{
		"totalTokens":  nullInt64OrZero(totalTokens),
		"inputTokens":  nullInt64OrZero(inputTokens),
		"outputTokens": nullInt64OrZero(outputTokens),
	}, true, nil
}

func scanSessionListRow(rows *sql.Rows) (sessionListRow, error) {
	var row sessionListRow
	err := rows.Scan(sessionScanTargets(&row)...)
	return row, err
}

func sessionScanTargets(row *sessionListRow) []any {
	return []any{
		&row.SessionKey, &row.ChannelProfile, &row.ChannelID, &row.RequesterID,
		&row.RequesterOuID, &row.AccountID, &row.ConversationID, &row.ThreadID,
		&row.IsGroup, &row.FirstSeenAt, &row.LastSeenAt, &row.EndedAt,
		&row.MetadataJSON, &row.EventCount, &row.HighRiskEventCount, &row.ToolCallCount,
	}
}

func mapSessionListRow(row sessionListRow) map[string]any {
	out := map[string]any{
		"sessionKey":         row.SessionKey,
		"isGroup":            fromBoolInt(row.IsGroup),
		"firstSeenAtMs":      row.FirstSeenAt,
		"lastSeenAtMs":       row.LastSeenAt,
		"eventCount":         row.EventCount,
		"highRiskEventCount": row.HighRiskEventCount,
		"toolCallCount":      row.ToolCallCount,
	}
	putString(out, "channelProfile", row.ChannelProfile)
	putString(out, "channelId", row.ChannelID)
	putString(out, "requesterId", row.RequesterID)
	putString(out, "requesterOuId", row.RequesterOuID)
	putString(out, "accountId", row.AccountID)
	putString(out, "conversationId", row.ConversationID)
	putString(out, "threadId", row.ThreadID)
	putInt64(out, "endedAtMs", row.EndedAt)
	return out
}

func nullInt64OrZero(value sql.NullInt64) int64 {
	if value.Valid {
		return value.Int64
	}
	return 0
}
