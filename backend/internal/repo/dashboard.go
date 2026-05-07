package repo

import "sort"

type DashboardOverviewQuery struct {
	FromMs *int64
	ToMs   *int64
}

func (r *DashboardRepository) GetOverview(query DashboardOverviewQuery) (map[string]any, error) {
	qaRecordsRange := buildTimeRangeFilter("started_at", query.FromMs, query.ToMs)
	toolCallsRange := buildTimeRangeFilter("started_at", query.FromMs, query.ToMs)
	approvalsRange := buildTimeRangeFilter("requested_at", query.FromMs, query.ToMs)
	lynxChecksRange := buildTimeRangeFilter("created_at", query.FromMs, query.ToMs)
	tokensRange := buildTimeRangeFilter("occurred_at", query.FromMs, query.ToMs)

	securityEvents, err := NewSecurityEventsRepository(r.db).buildEvents(SecurityEventListQuery{
		FromMs: query.FromMs,
		ToMs:   query.ToMs,
	})
	if err != nil {
		return nil, err
	}
	eventCount := int64(len(securityEvents))
	toolCallCount, err := countQuery(r, "tool_calls", toolCallsRange)
	if err != nil {
		return nil, err
	}
	approvalCount, err := countQuery(r, "approvals", approvalsRange)
	if err != nil {
		return nil, err
	}
	lynxCheckCount, err := countQuery(r, "lynx_checks", lynxChecksRange)
	if err != nil {
		return nil, err
	}
	totalTokens, err := scalarCount(
		r,
		`SELECT COALESCE(SUM(total_tokens), 0) FROM token_usage `+andWhere(tokensRange, "source_type = 'actual'"),
		tokensRange.Params()...,
	)
	if err != nil {
		return nil, err
	}

	riskDistribution := riskDistributionFromSecurityEvents(securityEvents)
	enforcementDistribution := enforcementDistributionFromSecurityEvents(securityEvents)
	eventTrend := eventTrendFromSecurityEvents(securityEvents)
	tokenTrend, err := r.tokenTrend(tokensRange)
	if err != nil {
		return nil, err
	}
	recentSecurityEvents := recentSecurityEventRows(securityEvents)
	recentQARecords, err := r.recentQARecords(qaRecordsRange)
	if err != nil {
		return nil, err
	}
	recentToolCalls, err := r.recentToolCalls(toolCallsRange)
	if err != nil {
		return nil, err
	}
	recentApprovals, err := r.recentApprovals(approvalsRange)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"totals": map[string]any{
			"eventCount":     eventCount,
			"toolCallCount":  toolCallCount,
			"approvalCount":  approvalCount,
			"lynxCheckCount": lynxCheckCount,
			"totalTokens":    totalTokens,
		},
		"riskDistribution":        riskDistribution,
		"enforcementDistribution": enforcementDistribution,
		"eventTrend":              eventTrend,
		"tokenTrend":              tokenTrend,
		"recentSecurityEvents":    recentSecurityEvents,
		"recentQaRecords":         recentQARecords,
		"recentToolCalls":         recentToolCalls,
		"recentApprovals":         recentApprovals,
	}, nil
}

func buildTimeRangeFilter(field string, fromMs, toMs *int64) *Filter {
	filter := &Filter{}
	filter.AppendRange(field, fromMs, toMs)
	return filter
}

func countQuery(r *DashboardRepository, table string, filter *Filter) (int64, error) {
	return scalarCount(r, "SELECT COUNT(*) FROM "+table+" "+filter.Where(), filter.Params()...)
}

func scalarCount(r *DashboardRepository, stmt string, params ...any) (int64, error) {
	var count int64
	if err := r.db.QueryRow(stmt, params...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func andWhere(filter *Filter, clause string) string {
	if filter.Where() == "" {
		return "WHERE " + clause
	}
	return filter.Where() + " AND " + clause
}

func riskDistributionFromSecurityEvents(events []securityEventRow) []map[string]any {
	counts := map[string]int64{}
	for _, event := range events {
		counts[normalizeRiskLevel(event.RiskLevel)]++
	}
	return bucketDistribution(counts, []string{"L0", "L1", "L2", "L3", "L4"}, "riskLevel")
}

func enforcementDistributionFromSecurityEvents(events []securityEventRow) []map[string]any {
	counts := map[string]int64{}
	for _, event := range events {
		counts[firstNonEmpty(event.EnforcementAction, "allow")]++
	}
	return bucketDistribution(counts, []string{"allow", "logOnly", "warn", "redact", "requireApproval", "block"}, "enforcementAction")
}

func bucketDistribution(counts map[string]int64, order []string, key string) []map[string]any {
	out := make([]map[string]any, 0, len(counts))
	seen := map[string]bool{}
	for _, value := range order {
		count := counts[value]
		if count == 0 {
			continue
		}
		out = append(out, map[string]any{key: value, "count": count})
		seen[value] = true
	}
	for value, count := range counts {
		if seen[value] || count == 0 {
			continue
		}
		out = append(out, map[string]any{key: value, "count": count})
	}
	return out
}

func eventTrendFromSecurityEvents(events []securityEventRow) []map[string]any {
	counts := map[int64]int64{}
	for _, event := range events {
		bucket := (event.OccurredAtMs / 3600000) * 3600000
		counts[bucket]++
	}
	buckets := make([]int64, 0, len(counts))
	for bucket := range counts {
		buckets = append(buckets, bucket)
	}
	sort.Slice(buckets, func(i, j int) bool { return buckets[i] < buckets[j] })

	out := make([]map[string]any, 0, len(buckets))
	for _, bucket := range buckets {
		out = append(out, map[string]any{
			"bucketStartMs": bucket,
			"value":         counts[bucket],
		})
	}
	return out
}

func recentSecurityEventRows(events []securityEventRow) []map[string]any {
	candidates := append([]securityEventRow{}, events...)
	sortSecurityEventsDesc(candidates)
	if len(candidates) > 5 {
		candidates = candidates[:5]
	}
	out := make([]map[string]any, 0, len(candidates))
	for _, event := range candidates {
		out = append(out, mapSecurityEventListRow(event))
	}
	return out
}

func (r *DashboardRepository) riskDistribution(filter *Filter) ([]map[string]any, error) {
	rows, err := r.db.Query(
		`
		SELECT COALESCE(NULLIF(risk_level, ''), 'L0') AS normalized_risk_level, COUNT(*)
		FROM audit_events
		`+filter.Where()+`
		GROUP BY normalized_risk_level
		ORDER BY normalized_risk_level ASC`,
		filter.Params()...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]map[string]any, 0)
	for rows.Next() {
		var riskLevel string
		var count int64
		if err := rows.Scan(&riskLevel, &count); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"riskLevel": riskLevel, "count": count})
	}
	return out, rows.Err()
}

func (r *DashboardRepository) enforcementDistribution(filter *Filter) ([]map[string]any, error) {
	rows, err := r.db.Query(
		`
		SELECT enforcement_action, COUNT(*)
		FROM audit_events
		`+filter.Where()+`
		GROUP BY enforcement_action
		ORDER BY enforcement_action ASC`,
		filter.Params()...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]map[string]any, 0)
	for rows.Next() {
		var action string
		var count int64
		if err := rows.Scan(&action, &count); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"enforcementAction": fromDBEnforcementAction(action),
			"count":             count,
		})
	}
	return out, rows.Err()
}

func (r *DashboardRepository) eventTrend(filter *Filter) ([]map[string]any, error) {
	rows, err := r.db.Query(
		`
		SELECT
			CAST(occurred_at / 3600000 AS INTEGER) * 3600000,
			COUNT(*)
		FROM audit_events
		`+filter.Where()+`
		GROUP BY 1
		ORDER BY 1 ASC`,
		filter.Params()...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTimeSeries(rows)
}

func (r *DashboardRepository) tokenTrend(filter *Filter) ([]map[string]any, error) {
	rows, err := r.db.Query(
		`
		SELECT
			CAST(occurred_at / 3600000 AS INTEGER) * 3600000,
			COALESCE(SUM(total_tokens), 0)
		FROM token_usage
		`+andWhere(filter, "source_type = 'actual'")+`
		GROUP BY 1
		ORDER BY 1 ASC`,
		filter.Params()...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanTimeSeries(rows)
}

func scanTimeSeries(rows rowsScanner) ([]map[string]any, error) {
	out := make([]map[string]any, 0)
	for rows.Next() {
		var bucketStartMs, value int64
		if err := rows.Scan(&bucketStartMs, &value); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{
			"bucketStartMs": bucketStartMs,
			"value":         value,
		})
	}
	return out, rows.Err()
}

type rowsScanner interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

func (r *DashboardRepository) recentToolCalls(filter *Filter) ([]map[string]any, error) {
	rows, err := r.db.Query(
		`
		SELECT
			tool_call_id, qa_record_id, session_key, run_id, approval_id, tool_name, risk_level,
			risk_score, policy_decision, enforcement_action, started_at, finished_at,
			duration_ms, result_status, result_excerpt
		FROM tool_calls
		`+filter.Where()+`
		ORDER BY started_at DESC, tool_call_id DESC
		LIMIT 5`,
		filter.Params()...,
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

func (r *DashboardRepository) recentQARecords(filter *Filter) ([]map[string]any, error) {
	rows, err := r.db.Query(
		qaRecordSelect+`
		`+filter.Where()+`
		ORDER BY started_at DESC, qa_record_id DESC
		LIMIT 5`,
		filter.Params()...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]map[string]any, 0)
	for rows.Next() {
		row, err := scanQARecordRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, mapQARecordListRow(row))
	}
	return out, rows.Err()
}

func (r *DashboardRepository) recentApprovals(filter *Filter) ([]any, error) {
	rows, err := r.db.Query(
		`
		SELECT
			approval_id, qa_record_id, pending_id, session_key, run_id, transport, requester_ou_id,
			module, risk_level, tool_name, scope_type, requested_at, expires_at,
			resolved_at, resolution, prompt_excerpt
		FROM approvals
		`+filter.Where()+`
		ORDER BY requested_at DESC, approval_id DESC
		LIMIT 5`,
		filter.Params()...,
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
