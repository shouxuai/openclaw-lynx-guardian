package repo

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

type GrantRepository struct {
	db *sql.DB
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

func (r *GrantRepository) List(ctx context.Context) ([]api.Grant, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT grant_id, approval_id, chain_id, session_key, channel_profile,
		       channel_id, conversation_id, requester_id, requester_ou_id,
		       approver_id, approver_ou_id, risk_family, tool_name, target_kind,
		       target_hash, resource_scope_json, created_at, expires_at,
		       COALESCE(revoked_at, ''), revoked_reason
		FROM approval_grants
		ORDER BY created_at DESC, grant_id DESC
		LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]api.Grant, 0)
	for rows.Next() {
		grant, err := scanGrant(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, grant)
	}
	return out, rows.Err()
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
