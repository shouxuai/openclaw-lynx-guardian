package repo

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

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

func (r *DecisionRepository) InsertDecision(ctx context.Context, decision api.DecisionResponse) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	now := decision.DecisionID
	if now == "" {
		now = "unknown"
	}
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO decisions (
			id, request_id, stage, hook, session_key, channel_profile, conversation_id,
			requester_id, risk_level, action, block, score, winning_arbiter,
			matched_modules_json, requires_approval, approval_request_json,
			redactions_json, prompt_context, user_message, audit_json, degraded_json,
			created_at
		)
		VALUES (?, ?, ?, ?, '', '', '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		decision.DecisionID,
		decision.DecisionID,
		string(decision.Stage),
		string(decision.Stage),
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
		now,
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
			now,
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
				now,
			); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
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
