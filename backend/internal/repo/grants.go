package repo

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type GrantRepository struct {
	db *sql.DB
}

type GrantListQuery struct {
	Q           *string
	ChainID     *string
	RequesterID *string
	Revoked     *bool
	PageNum     *int
	PageSize    *int
	Limit       *int
}

func NewGrantRepository(db *sql.DB) *GrantRepository {
	return &GrantRepository{db: db}
}

func (r *GrantRepository) Insert(ctx context.Context, grant api.Grant) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO approval_grants (
			id, grant_id, approval_id, chain_id, session_key, channel_profile,
			channel_id, conversation_id, requester_id, requester_ou_id, approver_id,
			approver_ou_id, risk_family, tool_name, target_kind, target_hash,
			resource_scope_json, created_at, expires_at, revoked_at, revoked_reason
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '')`,
		grant.GrantID,
		grant.GrantID,
		grant.ApprovalID,
		grant.ChainID,
		grant.SessionKey,
		grant.ChannelProfile,
		grant.ChannelID,
		grant.ConversationID,
		grant.RequesterID,
		grant.RequesterOuID,
		grant.ApproverID,
		grant.ApproverOuID,
		grant.RiskFamily,
		grant.ToolName,
		grant.TargetKind,
		grant.TargetHash,
		jsonText(grant.ResourceScope, "{}"),
		grant.CreatedAt,
		grant.ExpiresAt,
	)
	return err
}

func (r *GrantRepository) FindLatestByChain(ctx context.Context, chainID string) (*api.Grant, error) {
	return r.findOne(ctx, `
		SELECT grant_id, approval_id, chain_id, session_key, channel_profile,
		       channel_id, conversation_id, requester_id, requester_ou_id,
		       approver_id, approver_ou_id, risk_family, tool_name, target_kind,
		       target_hash, resource_scope_json, created_at, expires_at,
		       COALESCE(revoked_at, ''), revoked_reason
		FROM approval_grants
		WHERE chain_id = ?
		ORDER BY created_at DESC, grant_id DESC
		LIMIT 1`,
		chainID,
	)
}

func (r *GrantRepository) FindActiveByChain(ctx context.Context, chainID string, now string) (*api.Grant, error) {
	return r.findOne(ctx, `
		SELECT grant_id, approval_id, chain_id, session_key, channel_profile,
		       channel_id, conversation_id, requester_id, requester_ou_id,
		       approver_id, approver_ou_id, risk_family, tool_name, target_kind,
		       target_hash, resource_scope_json, created_at, expires_at,
		       COALESCE(revoked_at, ''), revoked_reason
		FROM approval_grants
		WHERE chain_id = ? AND revoked_at IS NULL AND expires_at > ?
		ORDER BY created_at DESC, grant_id DESC
		LIMIT 1`,
		chainID,
		now,
	)
}

func (r *GrantRepository) Revoke(ctx context.Context, grantID string, reason string, now string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE approval_grants
		SET revoked_at = COALESCE(revoked_at, ?),
		    revoked_reason = CASE WHEN revoked_reason = '' THEN ? ELSE revoked_reason END
		WHERE grant_id = ?`,
		now,
		reason,
		grantID,
	)
	return err
}

func (r *GrantRepository) RevokeActiveByChain(ctx context.Context, chainID string, reason string, now string) error {
	_, err := r.db.ExecContext(ctx, `
		UPDATE approval_grants
		SET revoked_at = COALESCE(revoked_at, ?),
		    revoked_reason = CASE WHEN revoked_reason = '' THEN ? ELSE revoked_reason END
		WHERE chain_id = ? AND revoked_at IS NULL`,
		now,
		reason,
		chainID,
	)
	return err
}

func (r *GrantRepository) List(ctx context.Context, query GrantListQuery) (service.PageResponse[api.Grant], error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	filter := grantListFilter(query)

	total, err := countRowsContext(ctx, r.db, "approval_grants", filter)
	if err != nil {
		return service.PageResponse[api.Grant]{}, err
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT grant_id, approval_id, chain_id, session_key, channel_profile,
		       channel_id, conversation_id, requester_id, requester_ou_id,
		       approver_id, approver_ou_id, risk_family, tool_name, target_kind,
		       target_hash, resource_scope_json, created_at, expires_at,
		       COALESCE(revoked_at, ''), revoked_reason
		FROM approval_grants `+filter.Where()+`
		ORDER BY created_at DESC, grant_id DESC
		LIMIT ? OFFSET ?`,
		append(filter.Params(), page.PageSize, page.Offset)...,
	)
	if err != nil {
		return service.PageResponse[api.Grant]{}, err
	}
	defer rows.Close()

	out := make([]api.Grant, 0, page.PageSize)
	for rows.Next() {
		grant, err := scanGrant(rows)
		if err != nil {
			return service.PageResponse[api.Grant]{}, err
		}
		out = append(out, grant)
	}
	if err := rows.Err(); err != nil {
		return service.PageResponse[api.Grant]{}, err
	}
	return service.BuildPageResponse(out, total, page), nil
}

func grantListFilter(query GrantListQuery) *Filter {
	filter := &Filter{}
	filter.AppendTextSearch([]string{
		"grant_id",
		"approval_id",
		"chain_id",
		"session_key",
		"channel_profile",
		"channel_id",
		"conversation_id",
		"requester_id",
		"requester_ou_id",
		"approver_id",
		"approver_ou_id",
		"risk_family",
		"tool_name",
		"target_kind",
		"target_hash",
		"resource_scope_json",
		"revoked_reason",
	}, query.Q)
	filter.AppendEquals("chain_id", query.ChainID)
	if query.RequesterID != nil {
		requesterID := strings.TrimSpace(*query.RequesterID)
		if requesterID != "" {
			filter.clauses = append(filter.clauses, "(requester_id = ? OR requester_ou_id = ?)")
			filter.params = append(filter.params, requesterID, requesterID)
		}
	}
	if query.Revoked != nil {
		if *query.Revoked {
			filter.clauses = append(filter.clauses, "revoked_at IS NOT NULL")
		} else {
			filter.clauses = append(filter.clauses, "revoked_at IS NULL")
		}
	}
	return filter
}

func (r *GrantRepository) findOne(ctx context.Context, query string, args ...any) (*api.Grant, error) {
	grant, err := scanGrant(r.db.QueryRowContext(ctx, query, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &grant, nil
}

type grantScanner interface {
	Scan(dest ...any) error
}

func scanGrant(scanner grantScanner) (api.Grant, error) {
	var grant api.Grant
	var resourceScopeJSON string
	err := scanner.Scan(
		&grant.GrantID,
		&grant.ApprovalID,
		&grant.ChainID,
		&grant.SessionKey,
		&grant.ChannelProfile,
		&grant.ChannelID,
		&grant.ConversationID,
		&grant.RequesterID,
		&grant.RequesterOuID,
		&grant.ApproverID,
		&grant.ApproverOuID,
		&grant.RiskFamily,
		&grant.ToolName,
		&grant.TargetKind,
		&grant.TargetHash,
		&resourceScopeJSON,
		&grant.CreatedAt,
		&grant.ExpiresAt,
		&grant.RevokedAt,
		&grant.RevokedReason,
	)
	if err != nil {
		return api.Grant{}, err
	}
	unmarshalJSONText(resourceScopeJSON, &grant.ResourceScope)
	if grant.ResourceScope == nil {
		grant.ResourceScope = map[string]any{}
	}
	return grant, nil
}

func jsonText(value any, fallback string) string {
	if value == nil {
		return fallback
	}
	data, err := json.Marshal(value)
	if err != nil {
		return fallback
	}
	return string(data)
}
