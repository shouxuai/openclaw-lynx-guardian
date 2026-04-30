package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

type ChainRepository struct {
	db *sql.DB
}

func NewChainRepository(db *sql.DB) *ChainRepository {
	return &ChainRepository{db: db}
}

func (r *ChainRepository) Upsert(ctx context.Context, input api.ChainUpdateRequest, summary api.ChainSummary, now string) error {
	normalizeChainSummary(&summary)
	summaryJSON := jsonText(summary, "{}")
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO chains (
			id, chain_id, session_key, channel_profile, channel_id, conversation_id,
			requester_id, requester_ou_id, status, summary_json, active_grant_id,
			pending_approval_id, created_at, updated_at, ended_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(chain_id) DO UPDATE SET
			session_key = excluded.session_key,
			channel_profile = excluded.channel_profile,
			channel_id = excluded.channel_id,
			conversation_id = excluded.conversation_id,
			requester_id = excluded.requester_id,
			requester_ou_id = excluded.requester_ou_id,
			status = excluded.status,
			summary_json = excluded.summary_json,
			active_grant_id = excluded.active_grant_id,
			pending_approval_id = excluded.pending_approval_id,
			updated_at = excluded.updated_at,
			ended_at = excluded.ended_at`,
		input.ChainID,
		input.ChainID,
		input.SessionKey,
		input.ChannelProfile,
		input.ChannelID,
		input.ConversationID,
		input.RequesterID,
		input.RequesterOuID,
		chainStatus(input.EventType),
		summaryJSON,
		summary.ActiveGrantID,
		summary.PendingApproval,
		now,
		now,
		endedAt(input.EventType, now),
	)
	return err
}

func (r *ChainRepository) AppendEvent(ctx context.Context, input api.ChainUpdateRequest, now string) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO chain_events (
			id, chain_id, event_type, hook, risk_level, action, tool_name,
			target_uri, content_excerpt, metadata_json, created_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		fmt.Sprintf("%s-%s-%s", input.ChainID, input.EventType, now),
		input.ChainID,
		input.EventType,
		input.Hook,
		input.RiskLevel,
		input.Action,
		input.ToolName,
		input.TargetURI,
		truncate(input.Content, 240),
		jsonText(input.Metadata, "{}"),
		now,
	)
	return err
}

func (r *ChainRepository) Get(ctx context.Context, chainID string) (api.ChainSummary, error) {
	var summaryJSON string
	err := r.db.QueryRowContext(ctx, `
		SELECT summary_json
		FROM chains
		WHERE chain_id = ?`,
		chainID,
	).Scan(&summaryJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return api.ChainSummary{}, nil
	}
	if err != nil {
		return api.ChainSummary{}, err
	}
	var summary api.ChainSummary
	unmarshalJSONText(summaryJSON, &summary)
	normalizeChainSummary(&summary)
	return summary, nil
}

func (r *ChainRepository) List(ctx context.Context) ([]api.ChainSummary, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT summary_json
		FROM chains
		ORDER BY updated_at DESC, chain_id DESC
		LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]api.ChainSummary, 0)
	for rows.Next() {
		var summaryJSON string
		if err := rows.Scan(&summaryJSON); err != nil {
			return nil, err
		}
		var summary api.ChainSummary
		unmarshalJSONText(summaryJSON, &summary)
		normalizeChainSummary(&summary)
		out = append(out, summary)
	}
	return out, rows.Err()
}

func normalizeChainSummary(summary *api.ChainSummary) {
	if summary.RecentIdentity == nil {
		summary.RecentIdentity = []string{}
	}
	if summary.RecentSensitive == nil {
		summary.RecentSensitive = []string{}
	}
	if summary.RecentDenials == nil {
		summary.RecentDenials = []string{}
	}
	if summary.RecentApprovals == nil {
		summary.RecentApprovals = []string{}
	}
	if summary.RecentTools == nil {
		summary.RecentTools = []string{}
	}
	if summary.RecentTaintReads == nil {
		summary.RecentTaintReads = []string{}
	}
	if summary.RecentEvasions == nil {
		summary.RecentEvasions = []string{}
	}
}

func chainStatus(eventType string) string {
	switch eventType {
	case "agent_end", "session_end", "subagent_ended", "chain_complete":
		return "ended"
	default:
		return "active"
	}
}

func endedAt(eventType string, now string) any {
	if chainStatus(eventType) == "ended" {
		return now
	}
	return nil
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}
