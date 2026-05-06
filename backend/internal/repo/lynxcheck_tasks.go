package repo

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

const maxLynxCheckReportMarkdownBytes = 1_000_000

type LynxCheckTaskListQuery struct {
	Q          *string
	FromMs     *int64
	ToMs       *int64
	SessionKey *string
	PageNum    *int
	PageSize   *int
	Limit      *int
	Cursor     *string
	Source     *string
	Trigger    *string
	Status     *string
}

type LynxCheckTaskRepository struct {
	db *sql.DB
}

func NewLynxCheckTaskRepository(db *sql.DB) *LynxCheckTaskRepository {
	return &LynxCheckTaskRepository{db: db}
}

func (r *LynxCheckTaskRepository) Upsert(ctx context.Context, task api.LynxCheckTask) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO lynx_check_tasks (
			id, request_id, trigger, source, requester_id, session_key, target_key,
			status, facts_json, evidence_bundle_json, report_skeleton, report_markdown,
			delivery_channel, delivery_target, delivery_status, delivery_error, created_at, updated_at,
			delivered_at, completed_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(request_id) DO UPDATE SET
			trigger = excluded.trigger,
			source = excluded.source,
			requester_id = excluded.requester_id,
			session_key = excluded.session_key,
			target_key = excluded.target_key,
			status = excluded.status,
			facts_json = excluded.facts_json,
			evidence_bundle_json = excluded.evidence_bundle_json,
			report_skeleton = excluded.report_skeleton,
			report_markdown = excluded.report_markdown,
			delivery_channel = excluded.delivery_channel,
			delivery_target = excluded.delivery_target,
			delivery_status = excluded.delivery_status,
			delivery_error = excluded.delivery_error,
			updated_at = excluded.updated_at,
			delivered_at = excluded.delivered_at,
			completed_at = excluded.completed_at`,
		task.RequestID,
		task.RequestID,
		task.Trigger,
		task.Source,
		task.RequesterID,
		task.SessionKey,
		task.TargetKey,
		task.Status,
		jsonText(task.Facts, "{}"),
		jsonText(task.EvidenceBundle, "{}"),
		task.ReportSkeleton,
		task.ReportMarkdown,
		task.DeliveryChannel,
		task.DeliveryTarget,
		task.DeliveryStatus,
		task.DeliveryError,
		task.CreatedAt,
		task.UpdatedAt,
		nullableDBString(task.DeliveredAt),
		nullableDBString(task.CompletedAt),
	)
	return err
}

func (r *LynxCheckTaskRepository) AppendEvidence(
	ctx context.Context,
	requestID string,
	items []api.LynxCheckEvidenceItem,
	now string,
) error {
	for index, item := range items {
		if _, err := r.db.ExecContext(ctx, `
			INSERT INTO lynx_check_evidence (id, request_id, module, severity, evidence_json, created_at)
			VALUES (?, ?, ?, ?, ?, ?)`,
			fmt.Sprintf("%s-evidence-%d-%s", requestID, index, now),
			requestID,
			item.Module,
			item.Severity,
			jsonText(item.Evidence, "{}"),
			now,
		); err != nil {
			return err
		}
	}
	return nil
}

func (r *LynxCheckTaskRepository) Get(ctx context.Context, requestID string) (api.LynxCheckTask, error) {
	task, err := scanLynxCheckTask(r.db.QueryRowContext(ctx, `
		SELECT
			request_id, trigger, source, requester_id, session_key, target_key, status,
			facts_json, evidence_bundle_json, report_skeleton, report_markdown, delivery_channel,
			delivery_target, delivery_status, delivery_error, created_at, updated_at,
			COALESCE(delivered_at, ''), COALESCE(completed_at, '')
		FROM lynx_check_tasks
		WHERE request_id = ?`,
		requestID,
	))
	if errors.Is(err, sql.ErrNoRows) {
		return api.LynxCheckTask{}, nil
	}
	return task, err
}

func (r *LynxCheckTaskRepository) List(ctx context.Context, query LynxCheckTaskListQuery) (service.PageResponse[api.LynxCheckTask], error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	filter := &Filter{}
	filter.AppendTextSearch([]string{
		"request_id", "requester_id", "session_key", "target_key",
		"source", "trigger", "status", "report_skeleton", "report_markdown",
		"delivery_channel", "delivery_target", "delivery_status", "delivery_error",
	}, query.Q)
	filter.AppendEquals("session_key", query.SessionKey)
	filter.AppendEquals("source", query.Source)
	filter.AppendEquals("trigger", query.Trigger)
	filter.AppendEquals("status", query.Status)
	appendTimeRange(filter, "created_at", query.FromMs, query.ToMs)

	total, err := countRowsContext(ctx, r.db, "lynx_check_tasks", filter)
	if err != nil {
		return service.PageResponse[api.LynxCheckTask]{}, err
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT
			request_id, trigger, source, requester_id, session_key, target_key, status,
			facts_json, evidence_bundle_json, report_skeleton, report_markdown, delivery_channel,
			delivery_target, delivery_status, delivery_error, created_at, updated_at,
			COALESCE(delivered_at, ''), COALESCE(completed_at, '')
		FROM lynx_check_tasks `+filter.Where()+`
		ORDER BY created_at DESC, request_id DESC
		LIMIT ? OFFSET ?`,
		append(filter.Params(), page.PageSize, page.Offset)...,
	)
	if err != nil {
		return service.PageResponse[api.LynxCheckTask]{}, err
	}
	defer rows.Close()

	tasks := make([]api.LynxCheckTask, 0, page.PageSize)
	for rows.Next() {
		task, err := scanLynxCheckTask(rows)
		if err != nil {
			return service.PageResponse[api.LynxCheckTask]{}, err
		}
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return service.PageResponse[api.LynxCheckTask]{}, err
	}

	return service.BuildPageResponse(tasks, total, page), nil
}

type lynxCheckTaskScanner interface {
	Scan(dest ...any) error
}

func scanLynxCheckTask(scanner lynxCheckTaskScanner) (api.LynxCheckTask, error) {
	var task api.LynxCheckTask
	var factsJSON string
	var evidenceBundleJSON string
	err := scanner.Scan(
		&task.RequestID,
		&task.Trigger,
		&task.Source,
		&task.RequesterID,
		&task.SessionKey,
		&task.TargetKey,
		&task.Status,
		&factsJSON,
		&evidenceBundleJSON,
		&task.ReportSkeleton,
		&task.ReportMarkdown,
		&task.DeliveryChannel,
		&task.DeliveryTarget,
		&task.DeliveryStatus,
		&task.DeliveryError,
		&task.CreatedAt,
		&task.UpdatedAt,
		&task.DeliveredAt,
		&task.CompletedAt,
	)
	if err != nil {
		return api.LynxCheckTask{}, err
	}
	unmarshalJSONText(factsJSON, &task.Facts)
	unmarshalJSONText(evidenceBundleJSON, &task.EvidenceBundle)
	if task.Facts == nil {
		task.Facts = map[string]any{}
	}
	if task.EvidenceBundle == nil {
		task.EvidenceBundle = map[string]any{}
	}
	task.ReportPath = firstStringValue("reportPath", task.EvidenceBundle, task.Facts)
	if task.ReportMarkdown == "" {
		task.ReportMarkdown = readLynxCheckReportMarkdown(task.ReportPath)
	}
	task.PreferredTargetKind = taskPreferredTargetKind(task.Trigger, task.TargetKey)
	task.ErrorMessage = task.DeliveryError
	task.Transport = task.DeliveryChannel
	task.SendAttempted = task.DeliveryStatus != "" || task.DeliveryChannel != "" || task.DeliveredAt != ""
	task.SendSucceeded = task.DeliveryStatus == "sent" || task.DeliveryStatus == "completed"
	task.CreatedAtMs = parseRFC3339Millis(task.CreatedAt)
	task.CompletedAtMs = parseRFC3339Millis(task.CompletedAt)
	return task, nil
}

func firstStringValue(key string, maps ...map[string]any) string {
	for _, item := range maps {
		value, ok := item[key]
		if !ok {
			continue
		}
		text, ok := value.(string)
		if !ok {
			continue
		}
		if trimmed := strings.TrimSpace(text); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func readLynxCheckReportMarkdown(reportPath string) string {
	trimmed := strings.TrimSpace(reportPath)
	if trimmed == "" || !isAllowedLynxCheckReportPath(trimmed) {
		return ""
	}

	info, err := os.Stat(trimmed)
	if err != nil || info.IsDir() || info.Size() <= 0 || info.Size() > maxLynxCheckReportMarkdownBytes {
		return ""
	}

	content, err := os.ReadFile(trimmed)
	if err != nil {
		return ""
	}
	return string(content)
}

func isAllowedLynxCheckReportPath(reportPath string) bool {
	cleaned := filepath.Clean(reportPath)
	if absolute, err := filepath.Abs(cleaned); err == nil {
		cleaned = absolute
	}
	if resolved, err := filepath.EvalSymlinks(cleaned); err == nil {
		cleaned = resolved
	}

	normalized := strings.ToLower(strings.ReplaceAll(filepath.Clean(cleaned), "\\", "/"))
	return strings.HasSuffix(normalized, ".report.md") &&
		strings.Contains(normalized, "/.openclaw/lynx/check-runs/")
}

func appendTimeRange(filter *Filter, field string, fromMs *int64, toMs *int64) {
	if fromMs != nil {
		filter.clauses = append(filter.clauses, field+" >= ?")
		filter.params = append(filter.params, time.UnixMilli(*fromMs).UTC().Format(time.RFC3339Nano))
	}
	if toMs != nil {
		filter.clauses = append(filter.clauses, field+" <= ?")
		filter.params = append(filter.params, time.UnixMilli(*toMs).UTC().Format(time.RFC3339Nano))
	}
}

func nullableDBString(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func parseRFC3339Millis(value string) int64 {
	if value == "" {
		return 0
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return parsed.UnixMilli()
}

func taskPreferredTargetKind(trigger string, targetKey string) string {
	if trigger == "scheduled" || targetKey == "recent" {
		return "recent"
	}
	return "current"
}
