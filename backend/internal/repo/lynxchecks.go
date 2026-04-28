package repo

import (
	"database/sql"
	"errors"

	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type LynxChecksListQuery struct {
	FromMs          *int64
	ToMs            *int64
	SessionKey      *string
	Limit           *int
	Cursor          *string
	Source          *string
	Trigger         *string
	Status          *string
	MessageProvider *string
}

type lynxCheckListRow struct {
	RequestID           string
	Source              string
	Trigger             string
	PreferredTargetKind string
	SessionKey          sql.NullString
	TargetKey           sql.NullString
	ChannelID           sql.NullString
	MessageProvider     sql.NullString
	Status              string
	SendAttempted       int64
	SendSucceeded       int64
	Transport           sql.NullString
	ReportPath          sql.NullString
	ErrorMessage        sql.NullString
	CreatedAt           int64
	CompletedAt         sql.NullInt64
}

type lynxCheckDetailRow struct {
	lynxCheckListRow
	DeliveryAttemptsJSON sql.NullString
}

func (r *LynxChecksRepository) List(query LynxChecksListQuery) (service.CursorPage[map[string]any], error) {
	limit := service.ResolveListLimit(query.Limit)
	cursor := service.DecodeDescendingCursor(query.Cursor)

	filter := &Filter{}
	filter.AppendRange("created_at", query.FromMs, query.ToMs)
	filter.AppendEquals("session_key", query.SessionKey)
	filter.AppendEquals("source", query.Source)
	filter.AppendEquals("trigger", query.Trigger)
	filter.AppendEquals("status", query.Status)
	filter.AppendEquals("message_provider", query.MessageProvider)
	filter.AppendDescendingCursor("created_at", "request_id", cursor)

	rows, err := r.db.Query(
		`
		SELECT
			request_id, source, trigger, preferred_target_kind, session_key, target_key,
			channel_id, message_provider, status, send_attempted, send_succeeded,
			transport, report_path, error_message, created_at, completed_at
		FROM lynx_checks `+filter.Where()+`
		ORDER BY created_at DESC, request_id DESC
		LIMIT ?`,
		append(filter.Params(), limit+1)...,
	)
	if err != nil {
		return service.CursorPage[map[string]any]{}, err
	}
	defer rows.Close()

	all := make([]lynxCheckListRow, 0, limit+1)
	for rows.Next() {
		var row lynxCheckListRow
		if err := rows.Scan(
			&row.RequestID, &row.Source, &row.Trigger, &row.PreferredTargetKind,
			&row.SessionKey, &row.TargetKey, &row.ChannelID, &row.MessageProvider,
			&row.Status, &row.SendAttempted, &row.SendSucceeded, &row.Transport,
			&row.ReportPath, &row.ErrorMessage, &row.CreatedAt, &row.CompletedAt,
		); err != nil {
			return service.CursorPage[map[string]any]{}, err
		}
		all = append(all, row)
	}
	if err := rows.Err(); err != nil {
		return service.CursorPage[map[string]any]{}, err
	}

	return service.BuildCursorPage(
		all,
		limit,
		mapLynxCheckListRow,
		func(row lynxCheckListRow) service.DescendingCursor {
			return service.DescendingCursor{SortValue: row.CreatedAt, ID: row.RequestID}
		},
	), nil
}

func (r *LynxChecksRepository) GetByID(requestID string) (map[string]any, error) {
	var row lynxCheckDetailRow
	err := r.db.QueryRow(
		`
		SELECT
			request_id, source, trigger, preferred_target_kind, session_key, target_key,
			channel_id, message_provider, status, send_attempted, send_succeeded,
			transport, report_path, error_message, created_at, completed_at,
			delivery_attempts_json
		FROM lynx_checks
		WHERE request_id = ?`,
		requestID,
	).Scan(
		&row.RequestID, &row.Source, &row.Trigger, &row.PreferredTargetKind,
		&row.SessionKey, &row.TargetKey, &row.ChannelID, &row.MessageProvider,
		&row.Status, &row.SendAttempted, &row.SendSucceeded, &row.Transport,
		&row.ReportPath, &row.ErrorMessage, &row.CreatedAt, &row.CompletedAt,
		&row.DeliveryAttemptsJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	out := mapLynxCheckListRow(row.lynxCheckListRow)
	putJSONArray[map[string]any](out, "deliveryAttemptsJson", row.DeliveryAttemptsJSON)
	return out, nil
}

func mapLynxCheckListRow(row lynxCheckListRow) map[string]any {
	out := map[string]any{
		"requestId":           row.RequestID,
		"source":              row.Source,
		"trigger":             row.Trigger,
		"preferredTargetKind": row.PreferredTargetKind,
		"status":              row.Status,
		"sendAttempted":       fromBoolInt(row.SendAttempted),
		"sendSucceeded":       fromBoolInt(row.SendSucceeded),
		"createdAtMs":         row.CreatedAt,
	}
	putString(out, "sessionKey", row.SessionKey)
	putString(out, "targetKey", row.TargetKey)
	putString(out, "channelId", row.ChannelID)
	putString(out, "messageProvider", row.MessageProvider)
	putString(out, "transport", row.Transport)
	putString(out, "reportPath", row.ReportPath)
	putString(out, "errorMessage", row.ErrorMessage)
	putInt64(out, "completedAtMs", row.CompletedAt)
	return out
}
