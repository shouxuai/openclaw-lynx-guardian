package repo

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"

	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type QARecordsListQuery struct {
	SessionKey *string
	RunID      *string
	Q          *string
	RiskLevel  []string
	Status     *string
	PageNum    *int
	PageSize   *int
	Limit      *int
}

type qaRecordRow struct {
	QARecordID         string
	SessionKey         sql.NullString
	RunID              sql.NullString
	AgentID            sql.NullString
	UserPromptExcerpt  sql.NullString
	UserPromptHash     sql.NullString
	FinalAnswerExcerpt sql.NullString
	FinalAnswerHash    sql.NullString
	Status             string
	RiskLevel          sql.NullString
	RiskScore          sql.NullInt64
	ToolCallCount      int64
	ApprovalCount      int64
	DetectionCount     int64
	TotalTokens        int64
	StartedAt          int64
	CompletedAt        sql.NullInt64
	IngestedAt         int64
	PayloadJSON        sql.NullString
	LinkOrigin         sql.NullString
}

const qaRecordSelect = `
	SELECT
		qa_record_id, session_key, run_id, agent_id, user_prompt_excerpt,
		user_prompt_hash, final_answer_excerpt, final_answer_hash, status,
		risk_level, risk_score, tool_call_count, approval_count, detection_count,
		total_tokens, started_at, completed_at, ingested_at, payload_json, link_origin
	FROM qa_records`

type QARecordsRepository struct{ db *sql.DB }

func NewQARecordsRepository(db *sql.DB) *QARecordsRepository {
	return &QARecordsRepository{db: db}
}

func (r *QARecordsRepository) List(query QARecordsListQuery) (service.PageResponse[map[string]any], error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	filter := &Filter{}
	filter.AppendEquals("session_key", query.SessionKey)
	filter.AppendEquals("run_id", query.RunID)
	filter.AppendEquals("status", query.Status)
	filter.AppendRiskLevelIn("risk_level", query.RiskLevel)
	filter.AppendTextSearch([]string{
		"qa_record_id",
		"session_key",
		"run_id",
		"agent_id",
		"user_prompt_excerpt",
		"final_answer_excerpt",
	}, query.Q)

	total, err := countRows(r.db, "qa_records", filter)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}

	rows, err := r.db.Query(
		qaRecordSelect+`
		`+filter.Where()+`
		ORDER BY started_at DESC, qa_record_id DESC
		LIMIT ? OFFSET ?`,
		append(filter.Params(), page.PageSize, page.Offset)...,
	)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}
	defer rows.Close()

	items := make([]map[string]any, 0, page.PageSize)
	for rows.Next() {
		row, err := scanQARecordRow(rows)
		if err != nil {
			return service.PageResponse[map[string]any]{}, err
		}
		items = append(items, mapQARecordListRow(row))
	}
	if err := rows.Err(); err != nil {
		return service.PageResponse[map[string]any]{}, err
	}

	return service.BuildPageResponse(items, total, page), nil
}

func (r *QARecordsRepository) GetDetail(qaRecordID string) (map[string]any, error) {
	row, err := scanQARecordRow(r.db.QueryRow(qaRecordSelect+` WHERE qa_record_id = ?`, qaRecordID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	out := mapQARecordListRow(row)
	putJSONRecord(out, "payloadJson", row.PayloadJSON)

	events, err := r.relatedEvents(qaRecordID)
	if err != nil {
		return nil, err
	}
	toolCalls, err := r.relatedToolCalls(qaRecordID)
	if err != nil {
		return nil, err
	}
	approvals, err := r.relatedApprovals(qaRecordID)
	if err != nil {
		return nil, err
	}
	detections, err := r.relatedDetections(qaRecordID)
	if err != nil {
		return nil, err
	}
	tokenUsages, err := r.relatedTokenUsages(qaRecordID)
	if err != nil {
		return nil, err
	}

	nodes := make([]qaChainNode, 0, 2+len(events)+len(toolCalls)+len(approvals)+len(detections)+len(tokenUsages))
	nodes = append(nodes, qaChainNode{
		NodeID:       qaRecordID + ":userPrompt",
		QARecordID:   qaRecordID,
		Type:         "userPrompt",
		Title:        "用户提示词",
		Summary:      nullableString(row.UserPromptExcerpt),
		OccurredAtMs: row.StartedAt,
	})
	for _, item := range toolCalls {
		nodes = append(nodes, toolCallNodeFromMap(qaRecordID, item))
	}
	for _, item := range approvals {
		nodes = append(nodes, nodeFromMap(qaRecordID, "approval", "审批", "approvalId", "approvals", "requestedAtMs", item))
	}
	for _, item := range events {
		nodes = append(nodes, nodeFromMap(qaRecordID, "auditEvent", "安全审计事件", "eventId", "events", "occurredAtMs", item))
	}
	for _, item := range detections {
		nodes = append(nodes, nodeFromMap(qaRecordID, "detection", "检测", "requestId", "lynx-checks", "createdAtMs", item))
	}
	for _, item := range tokenUsages {
		nodes = append(nodes, nodeFromMap(qaRecordID, "tokenUsage", "Token 用量", "usageEventId", "tokens/usage", "occurredAtMs", item))
	}
	if row.FinalAnswerExcerpt.Valid {
		nodes = append(nodes, qaChainNode{
			NodeID:       qaRecordID + ":finalAnswer",
			QARecordID:   qaRecordID,
			Type:         "finalAnswer",
			Title:        "最终回复",
			Summary:      &row.FinalAnswerExcerpt.String,
			OccurredAtMs: nullableInt64Or(row.CompletedAt, row.StartedAt),
			Status:       &row.Status,
		})
	}
	sort.SliceStable(nodes, func(i, j int) bool {
		return nodes[i].OccurredAtMs < nodes[j].OccurredAtMs
	})

	out["chainNodes"] = mapChainNodes(nodes)
	out["chainEdges"] = mapChainEdges(nodes)
	out["relatedEvents"] = events
	out["relatedToolCalls"] = toolCalls
	out["relatedApprovals"] = approvals
	out["relatedDetections"] = detections
	return out, nil
}

func (r *QARecordsRepository) relatedEvents(qaRecordID string) ([]map[string]any, error) {
	rows, err := r.db.Query(`
		SELECT
			event_id, qa_record_id, session_key, run_id, tool_call_id, approval_id, request_id,
			source_kind, hook_name, event_type, category, sub_category, direction,
			primary_module, risk_level, risk_score, policy_decision, enforcement_action,
			title, summary, recommendation, content_excerpt, occurred_at
		FROM audit_events
		WHERE qa_record_id = ?
		ORDER BY occurred_at ASC, event_id ASC`,
		qaRecordID,
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

func (r *QARecordsRepository) relatedToolCalls(qaRecordID string) ([]map[string]any, error) {
	rows, err := r.db.Query(`
		SELECT
			tool_call_id, qa_record_id, session_key, run_id, approval_id, tool_name, risk_level,
			risk_score, policy_decision, enforcement_action, started_at, finished_at,
			duration_ms, result_status, result_excerpt, param_summary, param_hash,
			triggered_modules_json, error_text, metadata_json
		FROM tool_calls
		WHERE qa_record_id = ?
		ORDER BY started_at ASC, tool_call_id ASC`,
		qaRecordID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
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
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *QARecordsRepository) relatedApprovals(qaRecordID string) ([]map[string]any, error) {
	rows, err := r.db.Query(`
		SELECT
			approval_id, qa_record_id, pending_id, session_key, run_id, transport, requester_ou_id,
			module, risk_level, tool_name, scope_type, requested_at, expires_at,
			resolved_at, resolution, prompt_excerpt
		FROM approvals
		WHERE qa_record_id = ?
		ORDER BY requested_at ASC, approval_id ASC`,
		qaRecordID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
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
		out = append(out, mapApprovalListMap(row))
	}
	return out, rows.Err()
}

func (r *QARecordsRepository) relatedDetections(qaRecordID string) ([]map[string]any, error) {
	rows, err := r.db.Query(`
		SELECT
			request_id, qa_record_id, source, trigger, preferred_target_kind, session_key, target_key,
			channel_id, message_provider, status, send_attempted, send_succeeded,
			transport, report_path, report_markdown, error_message, created_at, completed_at
		FROM lynx_checks
		WHERE qa_record_id = ?
		ORDER BY created_at ASC, request_id ASC`,
		qaRecordID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
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
		out = append(out, mapLynxCheckListRow(row))
	}
	return out, rows.Err()
}

func (r *QARecordsRepository) relatedTokenUsages(qaRecordID string) ([]map[string]any, error) {
	rows, err := r.db.Query(`
		SELECT
			usage_event_id, qa_record_id, session_key, run_id, agent_id, provider, model,
			source_type, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
			total_tokens, assistant_text_count, is_estimated, occurred_at
		FROM token_usage
		WHERE qa_record_id = ?
		ORDER BY occurred_at ASC, usage_event_id ASC`,
		qaRecordID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]map[string]any, 0)
	for rows.Next() {
		var row tokenUsageRow
		if err := rows.Scan(
			&row.UsageEventID, &row.QARecordID, &row.SessionKey, &row.RunID, &row.AgentID,
			&row.Provider, &row.Model, &row.SourceType, &row.InputTokens, &row.OutputTokens,
			&row.CacheReadTokens, &row.CacheWriteTokens, &row.TotalTokens,
			&row.AssistantTextCount, &row.IsEstimated, &row.OccurredAt,
		); err != nil {
			return nil, err
		}
		out = append(out, mapTokenUsageRow(row))
	}
	return out, rows.Err()
}

type qaRecordScanner interface {
	Scan(dest ...any) error
}

func scanQARecordRow(scanner qaRecordScanner) (qaRecordRow, error) {
	var row qaRecordRow
	err := scanner.Scan(
		&row.QARecordID, &row.SessionKey, &row.RunID, &row.AgentID,
		&row.UserPromptExcerpt, &row.UserPromptHash, &row.FinalAnswerExcerpt,
		&row.FinalAnswerHash, &row.Status, &row.RiskLevel, &row.RiskScore,
		&row.ToolCallCount, &row.ApprovalCount, &row.DetectionCount, &row.TotalTokens,
		&row.StartedAt, &row.CompletedAt, &row.IngestedAt, &row.PayloadJSON, &row.LinkOrigin,
	)
	return row, err
}

func mapQARecordListRow(row qaRecordRow) map[string]any {
	out := map[string]any{
		"qaRecordId":     row.QARecordID,
		"status":         row.Status,
		"toolCallCount":  row.ToolCallCount,
		"approvalCount":  row.ApprovalCount,
		"detectionCount": row.DetectionCount,
		"totalTokens":    row.TotalTokens,
		"startedAtMs":    row.StartedAt,
	}
	putString(out, "sessionKey", row.SessionKey)
	putString(out, "runId", row.RunID)
	putString(out, "agentId", row.AgentID)
	putString(out, "userPromptExcerpt", row.UserPromptExcerpt)
	putString(out, "finalAnswerExcerpt", row.FinalAnswerExcerpt)
	putRiskLevel(out, "riskLevel", row.RiskLevel)
	putInt64(out, "riskScore", row.RiskScore)
	putInt64(out, "completedAtMs", row.CompletedAt)
	putString(out, "linkOrigin", row.LinkOrigin)
	return out
}

func mapApprovalListMap(row approvalListRow) map[string]any {
	item := mapApprovalListRow(row)
	out := map[string]any{
		"approvalId":    item.ApprovalID,
		"module":        item.Module,
		"riskLevel":     item.RiskLevel,
		"scopeType":     item.ScopeType,
		"requestedAtMs": item.RequestedAtMs,
		"expiresAtMs":   item.ExpiresAtMs,
	}
	if item.QARecordID != nil {
		out["qaRecordId"] = *item.QARecordID
	}
	if item.PendingID != nil {
		out["pendingId"] = *item.PendingID
	}
	if item.SessionKey != nil {
		out["sessionKey"] = *item.SessionKey
	}
	if item.RunID != nil {
		out["runId"] = *item.RunID
	}
	if item.Transport != nil {
		out["transport"] = *item.Transport
	}
	if item.RequesterOuID != nil {
		out["requesterOuId"] = *item.RequesterOuID
	}
	if item.ToolName != nil {
		out["toolName"] = *item.ToolName
	}
	if item.ResolvedAtMs != nil {
		out["resolvedAtMs"] = *item.ResolvedAtMs
	}
	if item.Resolution != nil {
		out["resolution"] = *item.Resolution
	}
	if item.PromptExcerpt != nil {
		out["promptExcerpt"] = *item.PromptExcerpt
	}
	return out
}

type qaChainNode struct {
	NodeID        string
	QARecordID    string
	Type          string
	Title         string
	Summary       *string
	OccurredAtMs  int64
	CompletedAtMs *int64
	Status        *string
	RiskLevel     *string
	DetailRef     map[string]any
	DetailJSON    map[string]any
}

func nodeFromMap(qaRecordID, nodeType, title, idKey, refKind, timeKey string, item map[string]any) qaChainNode {
	id, _ := item[idKey].(string)
	occurredAt := numberFromMap(item, timeKey)
	node := qaChainNode{
		NodeID:       fmt.Sprintf("%s:%s:%s", qaRecordID, nodeType, id),
		QARecordID:   qaRecordID,
		Type:         nodeType,
		Title:        title,
		Summary:      stringPtrFromMap(item, "summary", "resultExcerpt", "promptExcerpt", "totalTokens"),
		OccurredAtMs: occurredAt,
		RiskLevel:    stringPtrFromMap(item, "riskLevel"),
		DetailRef: map[string]any{
			"kind": refKind,
			"id":   id,
		},
		DetailJSON: item,
	}
	if status := stringPtrFromMap(item, "status", "resultStatus", "resolution", "sourceType"); status != nil {
		node.Status = status
	}
	if completedAt := numberFromMap(item, "completedAtMs", "finishedAtMs", "resolvedAtMs"); completedAt > 0 {
		node.CompletedAtMs = &completedAt
	}
	return node
}

func toolCallNodeFromMap(qaRecordID string, item map[string]any) qaChainNode {
	detail := item
	nodeType := "toolCall"
	title := "工具调用"
	if terminalDetail, ok := terminalDetailFromToolCall(item); ok {
		detail = terminalDetail
		nodeType = "terminal"
		title = "终端命令"
	}
	node := nodeFromMap(qaRecordID, nodeType, title, "toolCallId", "tool-calls", "startedAtMs", detail)
	if nodeType == "terminal" {
		node.Summary = stringPtrFromMap(detail, "command", "resultExcerpt", "paramSummary")
	}
	return node
}

func terminalDetailFromToolCall(item map[string]any) (map[string]any, bool) {
	metadata, ok := item["metadataJson"].(map[string]any)
	if !ok {
		return nil, false
	}
	command, ok := metadata["command"].(string)
	if !ok || command == "" {
		return nil, false
	}
	out := make(map[string]any, len(item)+len(metadata))
	for key, value := range item {
		out[key] = value
	}
	for key, value := range metadata {
		out[key] = value
	}
	return out, true
}

func mapChainNodes(nodes []qaChainNode) []map[string]any {
	out := make([]map[string]any, 0, len(nodes))
	for _, node := range nodes {
		item := map[string]any{
			"nodeId":       node.NodeID,
			"qaRecordId":   node.QARecordID,
			"type":         node.Type,
			"title":        node.Title,
			"occurredAtMs": node.OccurredAtMs,
		}
		if node.Summary != nil {
			item["summary"] = *node.Summary
		}
		if node.CompletedAtMs != nil {
			item["completedAtMs"] = *node.CompletedAtMs
		}
		if node.Status != nil {
			item["status"] = *node.Status
		}
		if node.RiskLevel != nil {
			item["riskLevel"] = *node.RiskLevel
		}
		if node.DetailRef != nil {
			item["detailRef"] = node.DetailRef
		}
		if node.DetailJSON != nil {
			item["detailJson"] = node.DetailJSON
		}
		out = append(out, item)
	}
	return out
}

func mapChainEdges(nodes []qaChainNode) []map[string]any {
	if len(nodes) < 2 {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(nodes)-1)
	for i := 1; i < len(nodes); i++ {
		out = append(out, map[string]any{
			"fromNodeId": nodes[i-1].NodeID,
			"toNodeId":   nodes[i].NodeID,
		})
	}
	return out
}

func stringPtrFromMap(item map[string]any, keys ...string) *string {
	for _, key := range keys {
		switch value := item[key].(type) {
		case string:
			if value != "" {
				return &value
			}
		case int64:
			s := fmt.Sprintf("%d", value)
			return &s
		case int:
			s := fmt.Sprintf("%d", value)
			return &s
		case float64:
			s := fmt.Sprintf("%.0f", value)
			return &s
		}
	}
	return nil
}

func numberFromMap(item map[string]any, keys ...string) int64 {
	for _, key := range keys {
		switch value := item[key].(type) {
		case int64:
			return value
		case int:
			return int64(value)
		case float64:
			return int64(value)
		}
	}
	return 0
}

func nullableInt64Or(value sql.NullInt64, fallback int64) int64 {
	if value.Valid {
		return value.Int64
	}
	return fallback
}
