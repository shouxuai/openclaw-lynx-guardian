package repo

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

type DecisionListQuery struct {
	Limit *int
}

type DecisionRepository struct {
	db *sql.DB
}

func NewDecisionRepository(db *sql.DB) *DecisionRepository {
	return &DecisionRepository{db: db}
}

func (r *DecisionRepository) LoadChainSummaryForDecision(ctx context.Context, req api.DecisionRequest) (api.ChainSummary, map[string]any, error) {
	summary, err := r.lookupChainSummaryForDecision(ctx, req)
	if err != nil {
		return api.ChainSummary{}, nil, err
	}
	if activeGrantID, err := r.lookupActiveGrantIDForDecision(ctx, summary.ChainID); err != nil {
		return api.ChainSummary{}, nil, err
	} else if activeGrantID != "" {
		summary.ActiveGrantID = activeGrantID
	}
	taintLabels, err := r.lookupTaintLabelsForDecision(ctx, req, summary.ChainID, summary.SessionKey)
	if err != nil {
		return api.ChainSummary{}, nil, err
	}
	for _, label := range taintLabels {
		summary.RecentTaintReads = appendUniqueString(summary.RecentTaintReads, label, 12)
	}
	var taintSummary map[string]any
	if len(taintLabels) > 0 {
		taintSummary = map[string]any{"recentReads": taintLabels}
	}
	return summary, taintSummary, nil
}

func (r *DecisionRepository) AppendDecisionEvasionSignals(
	ctx context.Context,
	req api.DecisionRequest,
	decision api.DecisionResponse,
	signals []string,
	now string,
) error {
	signals = uniqueNonEmptyStrings(signals)
	if len(signals) == 0 {
		return nil
	}
	requestedChainID := stringFromAnyMap(req.ChainSummary, "chainId", "chain_id")
	if requestedChainID == "" {
		requestedChainID = req.SessionKey
	}
	if requestedChainID == "" && req.SessionKey == "" {
		return nil
	}

	summary, err := r.lookupChainSummaryForDecision(ctx, req)
	if err != nil {
		return err
	}
	chainID := nonEmptyString(summary.ChainID, requestedChainID)
	if chainID == "" {
		return nil
	}
	summary.ChainID = chainID
	summary.SessionKey = nonEmptyString(summary.SessionKey, req.SessionKey)
	summary.RecentEvasions = appendUniqueStrings(summary.RecentEvasions, signals, 12)
	summaryJSON := toJSONText(summary, "{}")
	metadataJSON := toJSONText(map[string]any{
		"decisionId":     decision.DecisionID,
		"evasionSignals": signals,
		"matchedModules": decision.MatchedModules,
	}, "{}")

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO chains (
			id, chain_id, session_key, channel_profile, channel_id, conversation_id,
			requester_id, requester_ou_id, status, summary_json, active_grant_id,
			pending_approval_id, created_at, updated_at, ended_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(chain_id) DO UPDATE SET
			session_key = COALESCE(NULLIF(excluded.session_key, ''), chains.session_key),
			channel_profile = COALESCE(NULLIF(excluded.channel_profile, ''), chains.channel_profile),
			channel_id = COALESCE(NULLIF(excluded.channel_id, ''), chains.channel_id),
			conversation_id = COALESCE(NULLIF(excluded.conversation_id, ''), chains.conversation_id),
			requester_id = COALESCE(NULLIF(excluded.requester_id, ''), chains.requester_id),
			requester_ou_id = COALESCE(NULLIF(excluded.requester_ou_id, ''), chains.requester_ou_id),
			status = 'active',
			summary_json = excluded.summary_json,
			active_grant_id = excluded.active_grant_id,
			pending_approval_id = excluded.pending_approval_id,
			updated_at = excluded.updated_at`,
		chainID,
		chainID,
		nonEmptyString(req.SessionKey, summary.SessionKey),
		req.ChannelProfile,
		req.ChannelID,
		req.ConversationID,
		req.RequesterID,
		"",
		"active",
		summaryJSON,
		summary.ActiveGrantID,
		summary.PendingApproval,
		now,
		now,
		nil,
	); err != nil {
		return err
	}

	if _, err = tx.ExecContext(ctx, `
		INSERT INTO chain_events (
			id, chain_id, event_type, hook, risk_level, action, tool_name,
			target_uri, content_excerpt, metadata_json, created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		decision.DecisionID+"-evasion-signal",
		chainID,
		"decision_evasion_signal",
		nonEmptyString(req.Hook, string(req.Stage)),
		string(decision.RiskLevel),
		string(decision.Action),
		req.ToolName,
		req.TargetURI,
		truncate(decisionContentExcerpt(req), 240),
		metadataJSON,
		now,
	); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	committed = true
	return nil
}

func (r *DecisionRepository) lookupChainSummaryForDecision(ctx context.Context, req api.DecisionRequest) (api.ChainSummary, error) {
	where := make([]string, 0)
	args := make([]any, 0)
	if chainID := stringFromAnyMap(req.ChainSummary, "chainId", "chain_id"); chainID != "" {
		where = append(where, "chain_id = ?")
		args = append(args, chainID)
	} else {
		if req.SessionKey == "" && req.ConversationID == "" {
			return api.ChainSummary{}, nil
		}
		if req.SessionKey != "" {
			where = append(where, "session_key = ?")
			args = append(args, req.SessionKey)
		}
		if req.ChannelProfile != "" {
			where = append(where, "channel_profile = ?")
			args = append(args, req.ChannelProfile)
		}
		if req.ConversationID != "" {
			where = append(where, "conversation_id = ?")
			args = append(args, req.ConversationID)
		}
		if req.RequesterID != "" {
			where = append(where, "requester_id = ?")
			args = append(args, req.RequesterID)
		}
	}
	if len(where) == 0 {
		return api.ChainSummary{}, nil
	}

	var chainID, sessionKey, summaryJSON, activeGrantID, pendingApprovalID string
	err := r.db.QueryRowContext(ctx, `
		SELECT chain_id, session_key, summary_json, active_grant_id, pending_approval_id
		FROM chains
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, updated_at DESC, chain_id DESC
		LIMIT 1`,
		args...,
	).Scan(&chainID, &sessionKey, &summaryJSON, &activeGrantID, &pendingApprovalID)
	if errors.Is(err, sql.ErrNoRows) {
		return api.ChainSummary{}, nil
	}
	if err != nil {
		return api.ChainSummary{}, err
	}

	var summary api.ChainSummary
	unmarshalJSONText(summaryJSON, &summary)
	summary.ChainID = nonEmptyString(summary.ChainID, chainID)
	summary.SessionKey = nonEmptyString(summary.SessionKey, sessionKey)
	summary.ActiveGrantID = nonEmptyString(summary.ActiveGrantID, activeGrantID)
	summary.PendingApproval = nonEmptyString(summary.PendingApproval, pendingApprovalID)
	return summary, nil
}

func (r *DecisionRepository) lookupActiveGrantIDForDecision(ctx context.Context, chainID string) (string, error) {
	if chainID == "" {
		return "", nil
	}
	var grantID string
	err := r.db.QueryRowContext(ctx, `
		SELECT grant_id
		FROM approval_grants
		WHERE chain_id = ? AND revoked_at IS NULL AND expires_at > ?
		ORDER BY created_at DESC, grant_id DESC
		LIMIT 1`,
		chainID,
		time.Now().UTC().Format(time.RFC3339Nano),
	).Scan(&grantID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return grantID, err
}

func (r *DecisionRepository) lookupTaintLabelsForDecision(ctx context.Context, req api.DecisionRequest, chainID string, sessionKey string) ([]string, error) {
	sessionKey = nonEmptyString(sessionKey, req.SessionKey)
	if chainID == "" && sessionKey == "" {
		return nil, nil
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT label
		FROM taint_labels
		WHERE ((? != '' AND chain_id = ?) OR (? != '' AND session_key = ?))
		  AND (expires_at IS NULL OR expires_at = '' OR expires_at > ?)
		ORDER BY created_at DESC, id DESC
		LIMIT 12`,
		chainID,
		chainID,
		sessionKey,
		sessionKey,
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	labels := make([]string, 0)
	for rows.Next() {
		var label string
		if err := rows.Scan(&label); err != nil {
			return nil, err
		}
		labels = appendUniqueString(labels, label, 12)
	}
	return labels, rows.Err()
}

func (r *DecisionRepository) InsertDecision(ctx context.Context, req api.DecisionRequest, decision api.DecisionResponse) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	createdAt := decisionCreatedAt(req, decision.DecisionID)
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO decisions (
			id, request_id, stage, hook, session_key, channel_profile, conversation_id,
			requester_id, risk_level, action, block, score, winning_arbiter,
			matched_modules_json, requires_approval, approval_request_json,
			redactions_json, prompt_context, user_message, audit_json, degraded_json,
			created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		decision.DecisionID,
		nonEmptyString(req.RequestID, decision.DecisionID),
		string(decision.Stage),
		req.Hook,
		req.SessionKey,
		req.ChannelProfile,
		req.ConversationID,
		req.RequesterID,
		string(decision.RiskLevel),
		string(decision.Action),
		boolToInt(decision.Block),
		decision.Score,
		string(decision.WinningArbiter),
		toJSONText(decision.MatchedModules, "[]"),
		boolToInt(decision.RequiresApproval),
		toJSONText(decision.ApprovalRequest, "{}"),
		toJSONText(decision.Redactions, "[]"),
		decision.PromptContext,
		decision.UserMessage,
		toJSONText(decision.Audit, "{}"),
		toJSONText(decision.Degraded, "{}"),
		createdAt.Text,
	); err != nil {
		return err
	}

	for index, arbiter := range decision.Arbiters {
		arbiterID := fmt.Sprintf("%s-arbiter-%d", decision.DecisionID, index)
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO decision_arbiters (
				id, decision_id, arbiter, risk_level, action, score,
				matched_modules_json, evidence_json, score_breakdown_json, reason, created_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			arbiterID,
			decision.DecisionID,
			string(arbiter.Arbiter),
			string(arbiter.RiskLevel),
			string(arbiter.Action),
			arbiter.Score,
			toJSONText(arbiter.MatchedModules, "[]"),
			toJSONText(arbiter.Evidence, "[]"),
			toJSONText(arbiter.ScoreBreakdown, "[]"),
			arbiter.Reason,
			createdAt.Text,
		); err != nil {
			return err
		}
		for evidenceIndex, evidence := range arbiter.Evidence {
			if _, err = tx.ExecContext(ctx, `
				INSERT INTO decision_evidence (
					id, decision_id, module, kind, value, severity, score_delta, source, created_at
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				decisionEvidenceRowID(decision.DecisionID, evidence.ID, index, evidenceIndex),
				decision.DecisionID,
				evidence.Module,
				evidence.Kind,
				evidence.Value,
				string(evidence.Severity),
				evidence.ScoreDelta,
				string(evidence.Source),
				createdAt.Text,
			); err != nil {
				return err
			}
		}
	}
	if err = insertDecisionAuditEvent(ctx, tx, req, decision, createdAt); err != nil {
		return err
	}
	return tx.Commit()
}

type decisionTimestamp struct {
	Text   string
	UnixMs int64
}

func decisionCreatedAt(req api.DecisionRequest, _ string) decisionTimestamp {
	if req.CreatedAt != "" {
		if parsed, err := time.Parse(time.RFC3339Nano, req.CreatedAt); err == nil {
			return decisionTimestamp{Text: parsed.UTC().Format(time.RFC3339Nano), UnixMs: parsed.UTC().UnixMilli()}
		}
		return decisionTimestamp{Text: req.CreatedAt, UnixMs: time.Now().UTC().UnixMilli()}
	}
	now := time.Now().UTC()
	return decisionTimestamp{Text: now.Format(time.RFC3339Nano), UnixMs: now.UnixMilli()}
}

func insertDecisionAuditEvent(
	ctx context.Context,
	tx *sql.Tx,
	req api.DecisionRequest,
	decision api.DecisionResponse,
	createdAt decisionTimestamp,
) error {
	payload := decisionAuditPayload(req, decision)
	result, err := tx.ExecContext(ctx, `
		INSERT INTO audit_events (
			event_id, qa_record_id, session_key, run_id, request_id, source_kind, hook_name, event_type,
			category, sub_category, direction, content_kind, primary_module,
			modules_json, risk_level, risk_score, policy_decision, enforcement_action,
			title, summary, recommendation, content_excerpt, occurred_at, ingested_at,
			payload_json
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		decision.DecisionID+"-audit",
		emptyToNil(req.QARecordID),
		req.SessionKey,
		emptyToNil(req.RunID),
		nonEmptyString(req.RequestID, decision.DecisionID),
		"go_control_plane",
		nonEmptyString(req.Hook, string(decision.Stage)),
		string(decision.Stage),
		"decision",
		string(decision.WinningArbiter),
		string(decision.Stage),
		decisionContentKind(req),
		firstString(decision.MatchedModules),
		toJSONText(decision.MatchedModules, "[]"),
		string(decision.RiskLevel),
		int(decision.Score),
		string(decision.Audit.PolicyDecision),
		string(decision.Audit.EnforcementAction),
		"Lynx Guardian decision",
		decisionAuditSummary(decision),
		"",
		truncate(decisionContentExcerpt(req), 240),
		createdAt.UnixMs,
		time.Now().UTC().UnixMilli(),
		toJSONText(payload, "{}"),
	)
	if err != nil {
		return err
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected != 1 {
		return fmt.Errorf("insert decision audit event affected %d rows", rowsAffected)
	}
	return nil
}

func decisionAuditPayload(req api.DecisionRequest, decision api.DecisionResponse) map[string]any {
	matchedRules := make([]string, 0)
	scoreBreakdown := make([]api.ScoreBreakdown, 0)
	evidence := make([]api.EvidenceItem, 0)
	for _, arbiter := range decision.Arbiters {
		for _, item := range arbiter.Evidence {
			matchedRules = appendUniqueString(matchedRules, item.ID, 64)
			evidence = append(evidence, item)
		}
		scoreBreakdown = append(scoreBreakdown, arbiter.ScoreBreakdown...)
	}
	return map[string]any{
		"decisionId":        decision.DecisionID,
		"requestId":         nonEmptyString(req.RequestID, decision.DecisionID),
		"stage":             decision.Stage,
		"hook":              req.Hook,
		"sessionKey":        req.SessionKey,
		"channelProfile":    req.ChannelProfile,
		"conversationId":    req.ConversationID,
		"requesterId":       req.RequesterID,
		"riskLevel":         decision.RiskLevel,
		"action":            decision.Action,
		"block":             decision.Block,
		"score":             decision.Score,
		"riskScore":         int(decision.Score),
		"winningArbiter":    decision.WinningArbiter,
		"matchedModules":    decision.MatchedModules,
		"matchedRules":      matchedRules,
		"scoreBreakdown":    scoreBreakdown,
		"evidence":          evidence,
		"arbiters":          decision.Arbiters,
		"audit":             decision.Audit,
		"requiresApproval":  decision.RequiresApproval,
		"policyDecision":    decision.Audit.PolicyDecision,
		"enforcementAction": decision.Audit.EnforcementAction,
		"request":           req,
		"decision":          decision,
	}
}

func decisionContentKind(req api.DecisionRequest) string {
	if req.ToolName != "" {
		return "tool"
	}
	if req.TargetURI != "" {
		return "resource"
	}
	return "text"
}

func decisionContentExcerpt(req api.DecisionRequest) string {
	parts := []string{req.Content, req.ToolName, req.TargetURI}
	return strings.TrimSpace(strings.Join(parts, " "))
}

func decisionAuditSummary(decision api.DecisionResponse) string {
	return fmt.Sprintf("%s %s via %s", decision.RiskLevel, decision.Action, decision.WinningArbiter)
}

func auditEventEnforcementAction(action api.DecisionAction) string {
	if action == "deny" {
		return "block"
	}
	return string(action)
}

func firstString(values []string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func emptyToNil(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func stringFromAnyMap(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := values[key]; ok {
			text := strings.TrimSpace(fmt.Sprint(value))
			if text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

func appendUniqueString(values []string, next string, limit int) []string {
	next = normalizeDecisionContextSignal(next)
	if next == "" {
		return values
	}
	for _, value := range values {
		if value == next {
			return values
		}
	}
	values = append(values, next)
	if limit > 0 && len(values) > limit {
		return values[len(values)-limit:]
	}
	return values
}

func normalizeDecisionContextSignal(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "<nil>" {
		return ""
	}
	const maxSignalRunes = 160
	runes := []rune(value)
	if len(runes) <= maxSignalRunes {
		return value
	}
	return string(runes[:maxSignalRunes-3]) + "..."
}

func appendUniqueStrings(values []string, additions []string, limit int) []string {
	for _, value := range additions {
		values = appendUniqueString(values, value, limit)
	}
	return values
}

func uniqueNonEmptyStrings(values []string) []string {
	return appendUniqueStrings(nil, values, 0)
}

func nonEmptyString(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func decisionEvidenceRowID(decisionID string, evidenceID string, arbiterIndex int, evidenceIndex int) string {
	if evidenceID == "" {
		return fmt.Sprintf("%s-evidence-%d-%d", decisionID, arbiterIndex, evidenceIndex)
	}
	return fmt.Sprintf("%s-%s-%d-%d", decisionID, evidenceID, arbiterIndex, evidenceIndex)
}

func (r *DecisionRepository) GetDecision(ctx context.Context, id string) (api.DecisionResponse, error) {
	row, err := r.scanDecisionRow(ctx, `
		SELECT id, stage, risk_level, action, block, score, winning_arbiter,
		       matched_modules_json, requires_approval, approval_request_json,
		       redactions_json, prompt_context, user_message, audit_json, degraded_json
		FROM decisions
		WHERE id = ?`,
		id,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return api.DecisionResponse{}, nil
	}
	if err != nil {
		return api.DecisionResponse{}, err
	}
	return r.hydrateDecision(ctx, row)
}

func (r *DecisionRepository) ListDecisions(ctx context.Context, q DecisionListQuery) ([]api.DecisionResponse, error) {
	limit := 100
	if q.Limit != nil && *q.Limit > 0 {
		limit = *q.Limit
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, stage, risk_level, action, block, score, winning_arbiter,
		       matched_modules_json, requires_approval, approval_request_json,
		       redactions_json, prompt_context, user_message, audit_json, degraded_json
		FROM decisions
		ORDER BY created_at DESC, id DESC
		LIMIT ?`,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	decisionRows := make([]decisionRow, 0)
	for rows.Next() {
		row, err := scanDecisionRows(rows)
		if err != nil {
			return nil, err
		}
		decisionRows = append(decisionRows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	out := make([]api.DecisionResponse, 0, len(decisionRows))
	for _, row := range decisionRows {
		decision, err := r.hydrateDecision(ctx, row)
		if err != nil {
			return nil, err
		}
		out = append(out, decision)
	}
	return out, nil
}

type decisionRow struct {
	ID                  string
	Stage               string
	RiskLevel           string
	Action              string
	Block               int
	Score               float64
	WinningArbiter      string
	MatchedModulesJSON  string
	RequiresApproval    int
	ApprovalRequestJSON string
	RedactionsJSON      string
	PromptContext       string
	UserMessage         string
	AuditJSON           string
	DegradedJSON        string
}

type decisionRowsScanner interface {
	Scan(dest ...any) error
}

func (r *DecisionRepository) scanDecisionRow(ctx context.Context, query string, args ...any) (decisionRow, error) {
	return scanDecisionRows(r.db.QueryRowContext(ctx, query, args...))
}

func scanDecisionRows(rows decisionRowsScanner) (decisionRow, error) {
	var row decisionRow
	err := rows.Scan(
		&row.ID,
		&row.Stage,
		&row.RiskLevel,
		&row.Action,
		&row.Block,
		&row.Score,
		&row.WinningArbiter,
		&row.MatchedModulesJSON,
		&row.RequiresApproval,
		&row.ApprovalRequestJSON,
		&row.RedactionsJSON,
		&row.PromptContext,
		&row.UserMessage,
		&row.AuditJSON,
		&row.DegradedJSON,
	)
	return row, err
}

func (r *DecisionRepository) hydrateDecision(ctx context.Context, row decisionRow) (api.DecisionResponse, error) {
	arbiters, err := r.listArbiters(ctx, row.ID)
	if err != nil {
		return api.DecisionResponse{}, err
	}
	var matchedModules []string
	unmarshalJSONText(row.MatchedModulesJSON, &matchedModules)
	var redactions []api.OutputRedaction
	unmarshalJSONText(row.RedactionsJSON, &redactions)
	var audit api.DecisionAudit
	unmarshalJSONText(row.AuditJSON, &audit)
	approvalRequest := decodeOptional[api.ApprovalRequestDraft](row.ApprovalRequestJSON)
	degraded := decodeOptional[api.DecisionDegraded](row.DegradedJSON)

	return api.DecisionResponse{
		DecisionID:       row.ID,
		Stage:            api.DecisionStage(row.Stage),
		Block:            row.Block == 1,
		Action:           api.DecisionAction(row.Action),
		RiskLevel:        api.RiskLevel(row.RiskLevel),
		Score:            row.Score,
		WinningArbiter:   api.WinningArbiter(row.WinningArbiter),
		Arbiters:         arbiters,
		MatchedModules:   matchedModules,
		RequiresApproval: row.RequiresApproval == 1,
		ApprovalRequest:  approvalRequest,
		Redactions:       redactions,
		PromptContext:    row.PromptContext,
		UserMessage:      row.UserMessage,
		Audit:            audit,
		Degraded:         degraded,
	}, nil
}

func (r *DecisionRepository) listArbiters(ctx context.Context, decisionID string) ([]api.ArbiterResult, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT arbiter, risk_level, action, score, matched_modules_json,
		       evidence_json, score_breakdown_json, reason
		FROM decision_arbiters
		WHERE decision_id = ?
		ORDER BY id ASC`,
		decisionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]api.ArbiterResult, 0)
	for rows.Next() {
		var arbiterName, riskLevel, action, matchedJSON, evidenceJSON, breakdownJSON, reason string
		var score float64
		if err := rows.Scan(&arbiterName, &riskLevel, &action, &score, &matchedJSON, &evidenceJSON, &breakdownJSON, &reason); err != nil {
			return nil, err
		}
		var matched []string
		var evidence []api.EvidenceItem
		var breakdown []api.ScoreBreakdown
		unmarshalJSONText(matchedJSON, &matched)
		unmarshalJSONText(evidenceJSON, &evidence)
		unmarshalJSONText(breakdownJSON, &breakdown)
		out = append(out, api.ArbiterResult{
			Arbiter:        api.DecisionArbiterName(arbiterName),
			RiskLevel:      api.RiskLevel(riskLevel),
			Action:         api.DecisionAction(action),
			Score:          score,
			MatchedModules: matched,
			Evidence:       evidence,
			ScoreBreakdown: breakdown,
			Reason:         reason,
		})
	}
	return out, rows.Err()
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func toJSONText(value any, fallback string) string {
	if value == nil {
		return fallback
	}
	data, err := json.Marshal(value)
	if err != nil {
		return fallback
	}
	return string(data)
}

func unmarshalJSONText(value string, target any) {
	if value == "" {
		return
	}
	_ = json.Unmarshal([]byte(value), target)
}

func decodeOptional[T any](value string) *T {
	if value == "" || value == "{}" || value == "null" {
		return nil
	}
	var out T
	if err := json.Unmarshal([]byte(value), &out); err != nil {
		return nil
	}
	return &out
}
