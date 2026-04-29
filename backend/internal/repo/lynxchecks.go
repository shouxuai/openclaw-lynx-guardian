package repo

import (
	"database/sql"
	"errors"

	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type LynxChecksListQuery struct {
	Q               *string
	FromMs          *int64
	ToMs            *int64
	SessionKey      *string
	PageNum         *int
	PageSize        *int
	Limit           *int
	Cursor          *string
	Source          *string
	Trigger         *string
	Status          *string
	MessageProvider *string
}

type lynxCheckListRow struct {
	RequestID           string
	QARecordID          sql.NullString
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
	ReportMarkdown      sql.NullString
	ErrorMessage        sql.NullString
	CreatedAt           int64
	CompletedAt         sql.NullInt64
}

type lynxCheckDetailRow struct {
	lynxCheckListRow
	DeliveryAttemptsJSON sql.NullString
}

func (r *LynxChecksRepository) List(query LynxChecksListQuery) (service.PageResponse[map[string]any], error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	filter := &Filter{}
	filter.AppendTextSearch([]string{
		"request_id", "qa_record_id", "session_key", "target_key",
		"channel_id", "message_provider", "transport", "report_path", "error_message",
	}, query.Q)
	filter.AppendRange("created_at", query.FromMs, query.ToMs)
	filter.AppendEquals("session_key", query.SessionKey)
	filter.AppendEquals("source", query.Source)
	filter.AppendEquals("trigger", query.Trigger)
	filter.AppendEquals("status", query.Status)
	filter.AppendEquals("message_provider", query.MessageProvider)

	total, err := countRows(r.db, "lynx_checks", filter)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}

	rows, err := r.db.Query(
		`
		SELECT
			request_id, qa_record_id, source, trigger, preferred_target_kind, session_key, target_key,
			channel_id, message_provider, status, send_attempted, send_succeeded,
			transport, report_path, report_markdown, error_message, created_at, completed_at
		FROM lynx_checks `+filter.Where()+`
		ORDER BY created_at DESC, request_id DESC
		LIMIT ? OFFSET ?`,
		append(filter.Params(), page.PageSize, page.Offset)...,
	)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}
	defer rows.Close()

	all := make([]lynxCheckListRow, 0, page.PageSize)
	for rows.Next() {
		var row lynxCheckListRow
		if err := rows.Scan(
			&row.RequestID, &row.QARecordID, &row.Source, &row.Trigger, &row.PreferredTargetKind,
			&row.SessionKey, &row.TargetKey, &row.ChannelID, &row.MessageProvider,
			&row.Status, &row.SendAttempted, &row.SendSucceeded, &row.Transport,
			&row.ReportPath, &row.ReportMarkdown, &row.ErrorMessage, &row.CreatedAt, &row.CompletedAt,
		); err != nil {
			return service.PageResponse[map[string]any]{}, err
		}
		all = append(all, row)
	}
	if err := rows.Err(); err != nil {
		return service.PageResponse[map[string]any]{}, err
	}

	items := make([]map[string]any, 0, len(all))
	for _, row := range all {
		items = append(items, mapLynxCheckListRow(row))
	}
	return service.BuildPageResponse(items, total, page), nil
}

func (r *LynxChecksRepository) GetByID(requestID string) (map[string]any, error) {
	var row lynxCheckDetailRow
	err := r.db.QueryRow(
		`
		SELECT
			request_id, qa_record_id, source, trigger, preferred_target_kind, session_key, target_key,
			channel_id, message_provider, status, send_attempted, send_succeeded,
			transport, report_path, report_markdown, error_message, created_at, completed_at,
			delivery_attempts_json
		FROM lynx_checks
		WHERE request_id = ?`,
		requestID,
	).Scan(
		&row.RequestID, &row.QARecordID, &row.Source, &row.Trigger, &row.PreferredTargetKind,
		&row.SessionKey, &row.TargetKey, &row.ChannelID, &row.MessageProvider,
		&row.Status, &row.SendAttempted, &row.SendSucceeded, &row.Transport,
		&row.ReportPath, &row.ReportMarkdown, &row.ErrorMessage, &row.CreatedAt, &row.CompletedAt,
		&row.DeliveryAttemptsJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	out := mapLynxCheckListRow(row.lynxCheckListRow)
	putString(out, "reportMarkdown", row.ReportMarkdown)
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
	putString(out, "qaRecordId", row.QARecordID)
	putString(out, "targetKey", row.TargetKey)
	putString(out, "channelId", row.ChannelID)
	putString(out, "messageProvider", row.MessageProvider)
	putString(out, "transport", row.Transport)
	putString(out, "reportPath", row.ReportPath)
	putString(out, "errorMessage", row.ErrorMessage)
	putInt64(out, "completedAtMs", row.CompletedAt)
	return out
}
