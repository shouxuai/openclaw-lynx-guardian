package repo

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type SecurityEventsRepository struct {
	db *sql.DB
}

func NewSecurityEventsRepository(db *sql.DB) *SecurityEventsRepository {
	return &SecurityEventsRepository{db: db}
}

type SecurityEventListQuery struct {
	PageNum    *int
	PageSize   *int
	Limit      *int
	Q          *string
	FromMs     *int64
	ToMs       *int64
	SessionKey *string
	RunID      *string
	QARecordID *string
	RiskLevel  []string
	EventKind  *string
}

type securityEventRow struct {
	EventID           string
	EventKind         string
	ProcessKind       string
	ProcessID         string
	QARecordID        string
	RunID             string
	SessionKey        string
	ToolCallID        string
	Title             string
	Summary           string
	ObjectLabel       string
	ContentExcerpt    string
	OccurredAtMs      int64
	CompletedAtMs     *int64
	RiskLevel         string
	RiskScore         *int64
	PolicyDecision    string
	EnforcementAction string
	RawAuditEventIDs  []string
	RawAuditEvents    []auditEventListRow
	DetailJSON        map[string]any
}

func (r *SecurityEventsRepository) List(query SecurityEventListQuery) (service.PageResponse[map[string]any], error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	events, err := r.buildEvents(query)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}
	sortSecurityEventsDesc(events)
	total := len(events)

	start := page.Offset
	if start > total {
		start = total
	}
	end := start + page.PageSize
	if end > total {
		end = total
	}

	items := make([]map[string]any, 0, end-start)
	for _, event := range events[start:end] {
		items = append(items, mapSecurityEventListRow(event))
	}
	return service.BuildPageResponse(items, total, page), nil
}

func (r *SecurityEventsRepository) ListForQARecord(qaRecordID string) ([]map[string]any, error) {
	events, err := r.buildEvents(SecurityEventListQuery{QARecordID: &qaRecordID})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].OccurredAtMs == events[j].OccurredAtMs {
			return events[i].EventID < events[j].EventID
		}
		return events[i].OccurredAtMs < events[j].OccurredAtMs
	})
	out := make([]map[string]any, 0, len(events))
	for _, event := range events {
		out = append(out, mapSecurityEventListRow(event))
	}
	return out, nil
}

func (r *SecurityEventsRepository) GetSummary(query SecurityEventListQuery) (map[string]any, error) {
	events, err := r.buildEvents(query)
	if err != nil {
		return nil, err
	}
	riskCounts := baseCountMap("L0", "L1", "L2", "L3", "L4")
	eventKindCounts := baseCountMap("input", "tool", "output", "install", "process")
	enforcementActionCounts := baseCountMap("allow", "logOnly", "warn", "redact", "requireApproval", "block")

	for _, event := range events {
		riskCounts[normalizeRiskLevel(event.RiskLevel)]++
		eventKindCounts[firstNonEmpty(event.EventKind, "unknown")]++
		enforcementActionCounts[firstNonEmpty(event.EnforcementAction, "allow")]++
	}

	return map[string]any{
		"total":                   len(events),
		"riskCounts":              riskCounts,
		"eventKindCounts":         eventKindCounts,
		"enforcementActionCounts": enforcementActionCounts,
	}, nil
}

func (r *SecurityEventsRepository) GetByID(eventID string) (map[string]any, error) {
	events, err := r.buildEvents(SecurityEventListQuery{})
	if err != nil {
		return nil, err
	}
	for _, event := range events {
		if event.EventID != eventID {
			continue
		}
		out := mapSecurityEventListRow(event)
		raw := make([]map[string]any, 0, len(event.RawAuditEvents))
		for _, row := range event.RawAuditEvents {
			raw = append(raw, mapAuditEventListRow(row))
		}
		out["rawAuditEvents"] = raw
		return out, nil
	}
	return nil, nil
}

func (r *SecurityEventsRepository) buildEvents(query SecurityEventListQuery) ([]securityEventRow, error) {
	rawRows, err := r.loadAuditRows()
	if err != nil {
		return nil, err
	}
	raw := indexRawAuditRows(rawRows)

	events := make([]securityEventRow, 0)
	qaEvents, err := r.qaSecurityEvents(raw)
	if err != nil {
		return nil, err
	}
	events = append(events, qaEvents...)

	toolEvents, err := r.toolSecurityEvents(raw)
	if err != nil {
		return nil, err
	}
	events = append(events, toolEvents...)

	installEvents := installSecurityEvents(rawRows)
	events = append(events, installEvents...)

	processEvents, err := r.lynxCheckSecurityEvents(raw)
	if err != nil {
		return nil, err
	}
	events = append(events, processEvents...)

	filtered := events[:0]
	for _, event := range events {
		finalizeSecurityEvent(&event)
		if securityEventMatchesQuery(event, query) {
			filtered = append(filtered, event)
		}
	}
	return filtered, nil
}

func (r *SecurityEventsRepository) qaSecurityEvents(raw rawAuditIndex) ([]securityEventRow, error) {
	rows, err := r.db.Query(qaRecordSelect)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]securityEventRow, 0)
	for rows.Next() {
		row, err := scanQARecordRow(rows)
		if err != nil {
			return nil, err
		}
		qaID := row.QARecordID
		inputRaw := raw.forQA(qaID, func(item auditEventListRow) bool {
			return item.Category == "input" ||
				strings.Contains(item.EventType, "input") ||
				item.HookName == "message_received" ||
				item.HookName == "before_dispatch"
		})
		events = append(events, securityEventRow{
			EventID:        "security:input:" + qaID,
			EventKind:      "input",
			ProcessKind:    "conversation",
			ProcessID:      qaID,
			QARecordID:     qaID,
			RunID:          nullableStringValue(row.RunID),
			SessionKey:     nullableStringValue(row.SessionKey),
			Title:          "输入检查",
			Summary:        "用户输入安全检查",
			ObjectLabel:    nullableStringValue(row.UserPromptExcerpt),
			ContentExcerpt: nullableStringValue(row.UserPromptExcerpt),
			OccurredAtMs:   row.StartedAt,
			RawAuditEvents: inputRaw,
			DetailJSON: map[string]any{
				"promptExcerpt": nullableStringValue(row.UserPromptExcerpt),
			},
		})

		if row.FinalAnswerExcerpt.Valid || row.CompletedAt.Valid {
			outputRaw := raw.forQA(qaID, func(item auditEventListRow) bool {
				return item.Category == "output" ||
					item.EventType == "assistant_output" ||
					item.EventType == "outbound_message" ||
					item.HookName == "llm_output" ||
					item.HookName == "agent_end" ||
					item.HookName == "before_message_write" ||
					item.HookName == "message_sending"
			})
			events = append(events, securityEventRow{
				EventID:        "security:output:" + qaID,
				EventKind:      "output",
				ProcessKind:    "conversation",
				ProcessID:      qaID,
				QARecordID:     qaID,
				RunID:          nullableStringValue(row.RunID),
				SessionKey:     nullableStringValue(row.SessionKey),
				Title:          "输出检查",
				Summary:        "助手回复安全检查",
				ObjectLabel:    nullableStringValue(row.FinalAnswerExcerpt),
				ContentExcerpt: nullableStringValue(row.FinalAnswerExcerpt),
				OccurredAtMs:   nullableInt64Or(row.CompletedAt, row.StartedAt),
				CompletedAtMs:  nullableInt64(row.CompletedAt),
				RawAuditEvents: outputRaw,
				DetailJSON: map[string]any{
					"finalAnswerExcerpt": nullableStringValue(row.FinalAnswerExcerpt),
				},
			})
		}
	}
	return events, rows.Err()
}

func (r *SecurityEventsRepository) toolSecurityEvents(raw rawAuditIndex) ([]securityEventRow, error) {
	rows, err := r.db.Query(`
		SELECT
			tool_call_id, qa_record_id, session_key, run_id, approval_id, tool_name, risk_level,
			risk_score, policy_decision, enforcement_action, started_at, finished_at,
			duration_ms, result_status, result_excerpt, param_summary, param_hash,
			triggered_modules_json, error_text, metadata_json
		FROM tool_calls`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]securityEventRow, 0)
	for rows.Next() {
		var row toolCallDetailRow
		if err := rows.Scan(
			&row.ToolCallID, &row.QARecordID, &row.SessionKey, &row.RunID, &row.ApprovalID,
			&row.ToolName, &row.RiskLevel, &row.RiskScore, &row.PolicyDecision,
			&row.EnforcementAction, &row.StartedAt, &row.FinishedAt, &row.DurationMs,
			&row.ResultStatus, &row.ResultExcerpt, &row.ParamSummary, &row.ParamHash,
			&row.TriggeredModulesJSON, &row.ErrorText, &row.MetadataJSON,
		); err != nil {
			return nil, err
		}
		item := mapToolCallListRow(row.toolCallListRow)
		putString(item, "paramSummary", row.ParamSummary)
		putString(item, "paramHash", row.ParamHash)
		putJSONArray[string](item, "triggeredModules", row.TriggeredModulesJSON)
		putString(item, "errorText", row.ErrorText)
		putJSONRecord(item, "metadataJson", row.MetadataJSON)
		detail := item
		if terminalDetail, ok := terminalDetailFromToolCall(item); ok {
			detail = terminalDetail
		}
		support := raw.forTool(row.ToolCallID)
		events = append(events, securityEventRow{
			EventID:           "security:tool:" + row.ToolCallID,
			EventKind:         "tool",
			ProcessKind:       "conversation",
			ProcessID:         firstNonEmpty(nullableStringValue(row.QARecordID), nullableStringValue(row.RunID), row.ToolCallID),
			QARecordID:        nullableStringValue(row.QARecordID),
			RunID:             nullableStringValue(row.RunID),
			SessionKey:        nullableStringValue(row.SessionKey),
			ToolCallID:        row.ToolCallID,
			Title:             "工具调用检查",
			Summary:           firstNonEmpty(nullableStringValue(row.ResultExcerpt), nullableStringValue(row.ParamSummary)),
			ObjectLabel:       row.ToolName,
			ContentExcerpt:    firstNonEmpty(nullableStringValue(row.ParamSummary), nullableStringValue(row.ResultExcerpt)),
			OccurredAtMs:      row.StartedAt,
			CompletedAtMs:     nullableInt64(row.FinishedAt),
			RiskLevel:         normalizeRiskLevel(nullableStringValue(row.RiskLevel)),
			RiskScore:         nullableInt64(row.RiskScore),
			PolicyDecision:    nullableStringValue(row.PolicyDecision),
			EnforcementAction: fromDBEnforcementAction(row.EnforcementAction),
			RawAuditEvents:    support,
			DetailJSON:        detail,
		})
	}
	return events, rows.Err()
}

func (r *SecurityEventsRepository) lynxCheckSecurityEvents(raw rawAuditIndex) ([]securityEventRow, error) {
	rows, err := r.db.Query(`
		SELECT
			request_id, qa_record_id, source, trigger, preferred_target_kind, session_key, target_key,
			channel_id, message_provider, status, send_attempted, send_succeeded,
			transport, report_path, report_markdown, error_message, created_at, completed_at
		FROM lynx_checks`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := make([]securityEventRow, 0)
	for rows.Next() {
		var row lynxCheckListRow
		if err := rows.Scan(
			&row.RequestID, &row.QARecordID, &row.Source, &row.Trigger, &row.PreferredTargetKind,
			&row.SessionKey, &row.TargetKey, &row.ChannelID, &row.MessageProvider,
			&row.Status, &row.SendAttempted, &row.SendSucceeded, &row.Transport,
			&row.ReportPath, &row.ReportMarkdown, &row.ErrorMessage, &row.CreatedAt, &row.CompletedAt,
		); err != nil {
			return nil, err
		}
		item := mapLynxCheckListRow(row)
		support := raw.forRequest(row.RequestID)
		events = append(events, securityEventRow{
			EventID:           "security:process:lynx-check:" + row.RequestID,
			EventKind:         "process",
			ProcessKind:       "lynx_check",
			ProcessID:         row.RequestID,
			QARecordID:        nullableStringValue(row.QARecordID),
			RunID:             row.RequestID,
			SessionKey:        nullableStringValue(row.SessionKey),
			Title:             "/lynx-check 检查",
			Summary:           row.Status,
			ObjectLabel:       nullableStringValue(row.TargetKey),
			OccurredAtMs:      row.CreatedAt,
			CompletedAtMs:     nullableInt64(row.CompletedAt),
			EnforcementAction: "allow",
			RawAuditEvents:    support,
			DetailJSON:        item,
		})
	}
	return events, rows.Err()
}

func installSecurityEvents(rawRows []auditEventListRow) []securityEventRow {
	groups := map[string][]auditEventListRow{}
	for _, row := range rawRows {
		if !isInstallAuditRow(row) {
			continue
		}
		key := nullableStringValue(row.RequestID)
		if key == "" {
			key = row.EventID
		}
		groups[key] = append(groups[key], row)
	}

	events := make([]securityEventRow, 0, len(groups))
	for key, rows := range groups {
		sortAuditRowsAsc(rows)
		first := rows[0]
		processKind := "skill_install"
		text := strings.ToLower(first.Title + " " + nullableStringValue(first.ContentExcerpt) + " " + nullableStringValue(first.Summary))
		if strings.Contains(text, "plugin") || strings.Contains(text, "插件") {
			processKind = "plugin_install"
		}
		events = append(events, securityEventRow{
			EventID:           "security:install:" + key,
			EventKind:         "install",
			ProcessKind:       processKind,
			ProcessID:         key,
			RunID:             nullableStringValue(first.RunID),
			SessionKey:        nullableStringValue(first.SessionKey),
			Title:             firstNonEmpty(first.Title, "安装检查"),
			Summary:           nullableStringValue(first.Summary),
			ObjectLabel:       nullableStringValue(first.ContentExcerpt),
			ContentExcerpt:    nullableStringValue(first.ContentExcerpt),
			OccurredAtMs:      first.OccurredAt,
			RawAuditEvents:    rows,
			DetailJSON:        map[string]any{"source": "audit_events"},
			EnforcementAction: "allow",
		})
	}
	return events
}

func isInstallAuditRow(row auditEventListRow) bool {
	if row.EventType == "install" || row.HookName == "before_install" {
		return true
	}
	text := strings.ToLower(row.EventType + " " + row.HookName + " " + row.Category + " " + nullableStringValue(row.ContentExcerpt) + " " + nullableStringValue(row.Summary))
	return strings.Contains(text, "skill install") || strings.Contains(text, "plugin install")
}

func (r *SecurityEventsRepository) loadAuditRows() ([]auditEventListRow, error) {
	rows, err := r.db.Query(`
		SELECT
			event_id, qa_record_id, session_key, run_id, tool_call_id, approval_id, request_id,
			source_kind, hook_name, event_type, category, sub_category, direction,
			primary_module, risk_level, risk_score, policy_decision, enforcement_action,
			title, summary, recommendation, content_excerpt, occurred_at
		FROM audit_events
		ORDER BY occurred_at ASC, event_id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]auditEventListRow, 0)
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
		out = append(out, row)
	}
	return out, rows.Err()
}

type rawAuditIndex struct {
	byQA      map[string][]auditEventListRow
	byTool    map[string][]auditEventListRow
	byRequest map[string][]auditEventListRow
}

func indexRawAuditRows(rows []auditEventListRow) rawAuditIndex {
	index := rawAuditIndex{
		byQA:      map[string][]auditEventListRow{},
		byTool:    map[string][]auditEventListRow{},
		byRequest: map[string][]auditEventListRow{},
	}
	for _, row := range rows {
		if key := nullableStringValue(row.QARecordID); key != "" {
			index.byQA[key] = append(index.byQA[key], row)
		}
		if key := nullableStringValue(row.ToolCallID); key != "" {
			index.byTool[key] = append(index.byTool[key], row)
		}
		if key := nullableStringValue(row.RequestID); key != "" {
			index.byRequest[key] = append(index.byRequest[key], row)
		}
	}
	return index
}

func (idx rawAuditIndex) forQA(qaRecordID string, accept func(auditEventListRow) bool) []auditEventListRow {
	rows := idx.byQA[qaRecordID]
	out := make([]auditEventListRow, 0, len(rows))
	for _, row := range rows {
		if accept(row) {
			out = append(out, row)
		}
	}
	sortAuditRowsAsc(out)
	return out
}

func (idx rawAuditIndex) forTool(toolCallID string) []auditEventListRow {
	rows := append([]auditEventListRow{}, idx.byTool[toolCallID]...)
	sortAuditRowsAsc(rows)
	return rows
}

func (idx rawAuditIndex) forRequest(requestID string) []auditEventListRow {
	rows := append([]auditEventListRow{}, idx.byRequest[requestID]...)
	sortAuditRowsAsc(rows)
	return rows
}

func finalizeSecurityEvent(event *securityEventRow) {
	rawRisks := make([]string, 0, len(event.RawAuditEvents)+1)
	rawRisks = append(rawRisks, event.RiskLevel)
	rawActions := make([]string, 0, len(event.RawAuditEvents)+1)
	rawActions = append(rawActions, event.EnforcementAction)
	rawDecisions := make([]string, 0, len(event.RawAuditEvents)+1)
	rawDecisions = append(rawDecisions, event.PolicyDecision)
	var maxScore *int64 = event.RiskScore

	event.RawAuditEventIDs = event.RawAuditEventIDs[:0]
	for _, row := range event.RawAuditEvents {
		event.RawAuditEventIDs = append(event.RawAuditEventIDs, row.EventID)
		rawRisks = append(rawRisks, nullableStringValue(row.RiskLevel))
		rawActions = append(rawActions, fromDBEnforcementAction(row.EnforcementAction))
		rawDecisions = append(rawDecisions, nullableStringValue(row.PolicyDecision))
		if row.RiskScore.Valid && (maxScore == nil || row.RiskScore.Int64 > *maxScore) {
			score := row.RiskScore.Int64
			maxScore = &score
		}
	}
	event.RiskLevel = maxRiskLevel(rawRisks...)
	event.EnforcementAction = strongestEnforcement(rawActions...)
	event.PolicyDecision = strongestPolicyDecision(rawDecisions...)
	event.RiskScore = maxScore
	if event.RiskLevel == "" {
		event.RiskLevel = "L0"
	}
	if event.EnforcementAction == "" {
		event.EnforcementAction = "allow"
	}
}

func mapSecurityEventListRow(row securityEventRow) map[string]any {
	out := map[string]any{
		"eventId":           row.EventID,
		"eventKind":         row.EventKind,
		"processKind":       row.ProcessKind,
		"title":             row.Title,
		"occurredAtMs":      row.OccurredAtMs,
		"riskLevel":         normalizeRiskLevel(row.RiskLevel),
		"enforcementAction": firstNonEmpty(row.EnforcementAction, "allow"),
		"rawAuditEventIds":  row.RawAuditEventIDs,
		"rawAuditCount":     len(row.RawAuditEventIDs),
	}
	putPlainString(out, "processId", row.ProcessID)
	putPlainString(out, "qaRecordId", row.QARecordID)
	putPlainString(out, "runId", row.RunID)
	putPlainString(out, "sessionKey", row.SessionKey)
	putPlainString(out, "toolCallId", row.ToolCallID)
	putPlainString(out, "summary", row.Summary)
	putPlainString(out, "objectLabel", row.ObjectLabel)
	putPlainString(out, "contentExcerpt", row.ContentExcerpt)
	putPlainString(out, "policyDecision", row.PolicyDecision)
	if row.CompletedAtMs != nil {
		out["completedAtMs"] = *row.CompletedAtMs
	}
	if row.RiskScore != nil {
		out["riskScore"] = *row.RiskScore
	}
	if row.DetailJSON != nil {
		out["detailJson"] = row.DetailJSON
	}
	return out
}

func securityEventMatchesQuery(event securityEventRow, query SecurityEventListQuery) bool {
	if query.FromMs != nil && event.OccurredAtMs < *query.FromMs {
		return false
	}
	if query.ToMs != nil && event.OccurredAtMs > *query.ToMs {
		return false
	}
	if query.EventKind != nil && *query.EventKind != "" && event.EventKind != *query.EventKind {
		return false
	}
	if query.SessionKey != nil && *query.SessionKey != "" && event.SessionKey != *query.SessionKey {
		return false
	}
	if query.RunID != nil && *query.RunID != "" && event.RunID != *query.RunID {
		return false
	}
	if query.QARecordID != nil && *query.QARecordID != "" && event.QARecordID != *query.QARecordID {
		return false
	}
	if len(query.RiskLevel) > 0 && !containsString(query.RiskLevel, normalizeRiskLevel(event.RiskLevel)) {
		return false
	}
	if query.Q != nil && strings.TrimSpace(*query.Q) != "" {
		haystack := strings.ToLower(strings.Join([]string{
			event.EventID, event.EventKind, event.ProcessKind, event.ProcessID,
			event.QARecordID, event.RunID, event.SessionKey, event.ToolCallID,
			event.Title, event.Summary, event.ObjectLabel, event.ContentExcerpt,
			event.RiskLevel, event.PolicyDecision, event.EnforcementAction,
		}, " "))
		if !strings.Contains(haystack, strings.ToLower(strings.TrimSpace(*query.Q))) {
			return false
		}
	}
	return true
}

func sortSecurityEventsDesc(events []securityEventRow) {
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].OccurredAtMs == events[j].OccurredAtMs {
			return events[i].EventID > events[j].EventID
		}
		return events[i].OccurredAtMs > events[j].OccurredAtMs
	})
}

func sortAuditRowsAsc(rows []auditEventListRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].OccurredAt == rows[j].OccurredAt {
			return rows[i].EventID < rows[j].EventID
		}
		return rows[i].OccurredAt < rows[j].OccurredAt
	})
}

func normalizeRiskLevel(value string) string {
	if value == "" {
		return "L0"
	}
	return value
}

func maxRiskLevel(values ...string) string {
	best := "L0"
	bestRank := riskRank(best)
	for _, value := range values {
		normalized := normalizeRiskLevel(value)
		if rank := riskRank(normalized); rank > bestRank {
			best = normalized
			bestRank = rank
		}
	}
	return best
}

func riskRank(value string) int {
	switch normalizeRiskLevel(value) {
	case "L4":
		return 4
	case "L3":
		return 3
	case "L2":
		return 2
	case "L1":
		return 1
	default:
		return 0
	}
}

func strongestEnforcement(values ...string) string {
	return strongestByRank("allow", enforcementRank, values...)
}

func enforcementRank(value string) int {
	switch fromDBEnforcementAction(value) {
	case "block", "deny":
		return 5
	case "requireApproval", "require_approval":
		return 4
	case "redact":
		return 3
	case "warn":
		return 2
	case "logOnly", "log_only":
		return 1
	default:
		return 0
	}
}

func strongestPolicyDecision(values ...string) string {
	return strongestByRank("", policyDecisionRank, values...)
}

func policyDecisionRank(value string) int {
	switch value {
	case "deny":
		return 6
	case "block":
		return 5
	case "workflow_auth":
		return 4
	case "confirm", "require_approval", "requireApproval":
		return 3
	case "warn":
		return 2
	case "allow":
		return 1
	default:
		return 0
	}
}

func strongestByRank(fallback string, rank func(string) int, values ...string) string {
	best := fallback
	bestRank := rank(best)
	for _, value := range values {
		if value == "" {
			continue
		}
		if currentRank := rank(value); currentRank > bestRank {
			best = fromDBEnforcementAction(value)
			bestRank = currentRank
		}
	}
	return best
}

func nullableStringValue(value sql.NullString) string {
	if value.Valid {
		return value.String
	}
	return ""
}

func putPlainString(out map[string]any, key string, value string) {
	if value != "" {
		out[key] = value
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func securityEventNotFound(eventID string) error {
	return fmt.Errorf("security event %q not found", eventID)
}

var errSecurityEventNotFound = errors.New("security event not found")
