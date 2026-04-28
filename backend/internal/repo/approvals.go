package repo

import (
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

// ApprovalsListQuery mirrors the TS ApprovalsListQuery.
type ApprovalsListQuery struct {
	FromMs        *int64
	ToMs          *int64
	SessionKey    *string
	RunID         *string
	RiskLevel     []string
	Limit         *int
	Cursor        *string
	Resolution    *string
	ToolName      *string
	Module        *string
	ScopeType     *string
	RequesterOuID *string
}

// ApprovalsRepository mirrors ApprovalsRepository in approvals-repository.ts.
type ApprovalsRepository struct {
	db *sql.DB
}

func NewApprovalsRepository(db *sql.DB) *ApprovalsRepository {
	return &ApprovalsRepository{db: db}
}

type approvalListRow struct {
	ApprovalID    string
	PendingID     sql.NullString
	SessionKey    sql.NullString
	RunID         sql.NullString
	Transport     sql.NullString
	RequesterOuID sql.NullString
	Module        string
	RiskLevel     string
	ToolName      sql.NullString
	ScopeType     string
	RequestedAt   int64
	ExpiresAt     int64
	ResolvedAt    sql.NullInt64
	Resolution    sql.NullString
	PromptExcerpt sql.NullString
}

type approvalDetailRow struct {
	approvalListRow
	ChannelProfile         sql.NullString
	ChannelID              sql.NullString
	AccountID              sql.NullString
	ConversationID         sql.NullString
	ApproverOuIDsJSON      sql.NullString
	ResolvedApproverOuID   sql.NullString
	RequestFingerprintHash sql.NullString
	AuditSummaryJSON       sql.NullString
	MetadataJSON           sql.NullString
}

func (r *ApprovalsRepository) List(query ApprovalsListQuery) (service.CursorPage[api.ApprovalListItem], error) {
	limit := service.ResolveListLimit(query.Limit)
	cursor := service.DecodeDescendingCursor(query.Cursor)

	filter := &Filter{}
	filter.AppendRange("requested_at", query.FromMs, query.ToMs)
	filter.AppendEquals("session_key", query.SessionKey)
	filter.AppendEquals("run_id", query.RunID)
	filter.AppendEquals("resolution", query.Resolution)
	filter.AppendEquals("tool_name", query.ToolName)
	filter.AppendEquals("module", query.Module)
	filter.AppendEquals("requester_ou_id", query.RequesterOuID)
	filter.AppendIn("risk_level", query.RiskLevel)
	filter.AppendEquals("scope_type", mapStringPtr(query.ScopeType, toDBApprovalScopeType))
	filter.AppendDescendingCursor("requested_at", "approval_id", cursor)

	sqlStmt := `
		SELECT approval_id, pending_id, session_key, run_id, transport, requester_ou_id,
		       module, risk_level, tool_name, scope_type, requested_at, expires_at,
		       resolved_at, resolution, prompt_excerpt
		FROM approvals ` + filter.Where() + `
		ORDER BY requested_at DESC, approval_id DESC
		LIMIT ?`
	params := append(filter.Params(), limit+1)

	rows, err := r.db.Query(sqlStmt, params...)
	if err != nil {
		return service.CursorPage[api.ApprovalListItem]{}, err
	}
	defer rows.Close()

	var all []approvalListRow
	for rows.Next() {
		var row approvalListRow
		if err := rows.Scan(
			&row.ApprovalID, &row.PendingID, &row.SessionKey, &row.RunID,
			&row.Transport, &row.RequesterOuID, &row.Module, &row.RiskLevel,
			&row.ToolName, &row.ScopeType, &row.RequestedAt, &row.ExpiresAt,
			&row.ResolvedAt, &row.Resolution, &row.PromptExcerpt,
		); err != nil {
			return service.CursorPage[api.ApprovalListItem]{}, err
		}
		all = append(all, row)
	}
	if err := rows.Err(); err != nil {
		return service.CursorPage[api.ApprovalListItem]{}, err
	}

	page := service.BuildCursorPage(
		all, limit,
		mapApprovalListRow,
		func(row approvalListRow) service.DescendingCursor {
			return service.DescendingCursor{SortValue: row.RequestedAt, ID: row.ApprovalID}
		},
	)
	return page, nil
}

func (r *ApprovalsRepository) GetByID(approvalID string) (*api.ApprovalDetail, error) {
	const stmt = `
		SELECT approval_id, pending_id, session_key, run_id, transport,
		       channel_profile, channel_id, account_id, conversation_id,
		       requester_ou_id, approver_ou_ids_json, resolved_approver_ou_id,
		       request_fingerprint_hash, module, risk_level, tool_name, scope_type,
		       requested_at, expires_at, resolved_at, resolution, prompt_excerpt,
		       audit_summary_json, metadata_json
		FROM approvals
		WHERE approval_id = ?`

	var row approvalDetailRow
	err := r.db.QueryRow(stmt, approvalID).Scan(
		&row.ApprovalID, &row.PendingID, &row.SessionKey, &row.RunID, &row.Transport,
		&row.ChannelProfile, &row.ChannelID, &row.AccountID, &row.ConversationID,
		&row.RequesterOuID, &row.ApproverOuIDsJSON, &row.ResolvedApproverOuID,
		&row.RequestFingerprintHash, &row.Module, &row.RiskLevel, &row.ToolName,
		&row.ScopeType, &row.RequestedAt, &row.ExpiresAt, &row.ResolvedAt,
		&row.Resolution, &row.PromptExcerpt, &row.AuditSummaryJSON, &row.MetadataJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	detail := api.ApprovalDetail{
		ApprovalListItem:       mapApprovalListRow(row.approvalListRow),
		ChannelProfile:         nullableString(row.ChannelProfile),
		ChannelID:              nullableString(row.ChannelID),
		AccountID:              nullableString(row.AccountID),
		ConversationID:         nullableString(row.ConversationID),
		ApproverOuIDs:          parseJSONArray[string](row.ApproverOuIDsJSON),
		ResolvedApproverOuID:   nullableString(row.ResolvedApproverOuID),
		RequestFingerprintHash: nullableString(row.RequestFingerprintHash),
		AuditSummaryJson:       parseJSONRecord(row.AuditSummaryJSON),
		MetadataJson:           parseJSONRecord(row.MetadataJSON),
	}
	return &detail, nil
}

func mapApprovalListRow(row approvalListRow) api.ApprovalListItem {
	return api.ApprovalListItem{
		ApprovalID:    row.ApprovalID,
		PendingID:     nullableString(row.PendingID),
		SessionKey:    nullableString(row.SessionKey),
		RunID:         nullableString(row.RunID),
		Transport:     nullableString(row.Transport),
		RequesterOuID: nullableString(row.RequesterOuID),
		Module:        row.Module,
		RiskLevel:     row.RiskLevel,
		ToolName:      nullableString(row.ToolName),
		ScopeType:     fromDBApprovalScopeType(row.ScopeType),
		RequestedAtMs: row.RequestedAt,
		ExpiresAtMs:   row.ExpiresAt,
		ResolvedAtMs:  nullableInt64(row.ResolvedAt),
		Resolution:    nullableString(row.Resolution),
		PromptExcerpt: nullableString(row.PromptExcerpt),
	}
}

func nullableString(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

func nullableInt64(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

func parseJSONArray[T any](v sql.NullString) []T {
	if !v.Valid || v.String == "" {
		return nil
	}
	var out []T
	if err := json.Unmarshal([]byte(v.String), &out); err != nil {
		return nil
	}
	return out
}

func parseJSONRecord(v sql.NullString) map[string]any {
	if !v.Valid || v.String == "" {
		return nil
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(v.String), &out); err != nil {
		return nil
	}
	return out
}
