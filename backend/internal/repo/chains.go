package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type ChainRepository struct {
	db *sql.DB
}

type ChainListQuery struct {
	Q              *string
	ChannelProfile *string
	ConversationID *string
	SessionKey     *string
	RequesterID    *string
	PageNum        *int
	PageSize       *int
	Limit          *int
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
	if err := r.loadPromptCoverage(ctx, &summary); err != nil {
		return api.ChainSummary{}, err
	}
	return summary, nil
}

func (r *ChainRepository) List(ctx context.Context, query ChainListQuery) (service.PageResponse[api.ChainSummary], error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	filter := &Filter{}
	filter.AppendTextSearch([]string{
		"chain_id",
		"session_key",
		"channel_profile",
		"channel_id",
		"conversation_id",
		"requester_id",
		"requester_ou_id",
		"status",
		"summary_json",
		"active_grant_id",
		"pending_approval_id",
	}, query.Q)
	filter.AppendEquals("channel_profile", query.ChannelProfile)
	filter.AppendEquals("conversation_id", query.ConversationID)
	filter.AppendEquals("session_key", query.SessionKey)
	filter.AppendEquals("requester_id", query.RequesterID)

	total, err := countRowsContext(ctx, r.db, "chains", filter)
	if err != nil {
		return service.PageResponse[api.ChainSummary]{}, err
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT summary_json
		FROM chains `+filter.Where()+`
		ORDER BY updated_at DESC, chain_id DESC
		LIMIT ? OFFSET ?`,
		append(filter.Params(), page.PageSize, page.Offset)...,
	)
	if err != nil {
		return service.PageResponse[api.ChainSummary]{}, err
	}
	defer rows.Close()

	out := make([]api.ChainSummary, 0)
	for rows.Next() {
		var summaryJSON string
		if err := rows.Scan(&summaryJSON); err != nil {
			return service.PageResponse[api.ChainSummary]{}, err
		}
		var summary api.ChainSummary
		unmarshalJSONText(summaryJSON, &summary)
		normalizeChainSummary(&summary)
		out = append(out, summary)
	}
	if err := rows.Err(); err != nil {
		return service.PageResponse[api.ChainSummary]{}, err
	}
	for index := range out {
		if err := r.loadPromptCoverage(ctx, &out[index]); err != nil {
			return service.PageResponse[api.ChainSummary]{}, err
		}
	}
	return service.BuildPageResponse(out, total, page), nil
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
	if summary.CoveredPrompts == nil {
		summary.CoveredPrompts = []api.ChainCoveredPrompt{}
	}
	summary.PromptCount = len(summary.CoveredPrompts)
}

func (r *ChainRepository) loadPromptCoverage(ctx context.Context, summary *api.ChainSummary) error {
	if summary.SessionKey == "" {
		summary.CoveredPrompts = []api.ChainCoveredPrompt{}
		summary.PromptCount = 0
		return nil
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT
			qa_record_id,
			COALESCE(run_id, ''),
			COALESCE(user_prompt_excerpt, ''),
			COALESCE(risk_level, ''),
			started_at,
			COALESCE(status, '')
		FROM qa_records
		WHERE session_key = ?
		  AND COALESCE(user_prompt_excerpt, '') <> ''
		ORDER BY started_at ASC, qa_record_id ASC
		LIMIT 50`,
		summary.SessionKey,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	prompts := make([]api.ChainCoveredPrompt, 0)
	for rows.Next() {
		var prompt api.ChainCoveredPrompt
		if err := rows.Scan(
			&prompt.QARecordID,
			&prompt.RunID,
			&prompt.UserPromptExcerpt,
			&prompt.RiskLevel,
			&prompt.StartedAtMs,
			&prompt.Status,
		); err != nil {
			return err
		}
		prompts = append(prompts, prompt)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	summary.CoveredPrompts = prompts
	summary.PromptCount = len(prompts)
	return nil
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
