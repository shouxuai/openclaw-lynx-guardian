package repo

import (
	"database/sql"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type TokenUsageListQuery struct {
	FromMs      *int64
	ToMs        *int64
	SessionKey  *string
	RunID       *string
	PageNum     *int
	PageSize    *int
	Limit       *int
	Cursor      *string
	Provider    *string
	Model       *string
	AgentID     *string
	IsEstimated *bool
	SourceType  *string
}

type TokenSummaryQuery struct {
	FromMs     *int64
	ToMs       *int64
	SessionKey *string
	RunID      *string
	Provider   *string
	Model      *string
}

type TokenTrendQuery struct {
	TokenSummaryQuery
	Bucket *string
}

type TokenHeatmapQuery struct {
	TokenSummaryQuery
}

type tokenUsageRow struct {
	UsageEventID       string
	QARecordID         sql.NullString
	SessionKey         sql.NullString
	RunID              sql.NullString
	AgentID            sql.NullString
	Provider           string
	Model              string
	SourceType         string
	InputTokens        int64
	OutputTokens       int64
	CacheReadTokens    int64
	CacheWriteTokens   int64
	TotalTokens        int64
	AssistantTextCount int64
	IsEstimated        int64
	OccurredAt         int64
}

func (r *TokensRepository) List(query TokenUsageListQuery) (service.PageResponse[map[string]any], error) {
	page := service.ResolvePageRequest(query.PageNum, query.PageSize, query.Limit)
	filter := tokenCommonFilter(TokenSummaryQuery{
		FromMs:     query.FromMs,
		ToMs:       query.ToMs,
		SessionKey: query.SessionKey,
		RunID:      query.RunID,
		Provider:   query.Provider,
		Model:      query.Model,
	})
	filter.AppendEquals("agent_id", query.AgentID)
	filter.AppendBool("is_estimated", query.IsEstimated)
	filter.AppendEquals("source_type", query.SourceType)

	total, err := countRows(r.db, "token_usage", filter)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}

	rows, err := r.db.Query(
		`
		SELECT
			usage_event_id, qa_record_id, session_key, run_id, agent_id, provider, model,
			source_type, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
			total_tokens, assistant_text_count, is_estimated, occurred_at
		FROM token_usage `+filter.Where()+`
		ORDER BY occurred_at DESC, usage_event_id DESC
		LIMIT ? OFFSET ?`,
		append(filter.Params(), page.PageSize, page.Offset)...,
	)
	if err != nil {
		return service.PageResponse[map[string]any]{}, err
	}
	defer rows.Close()

	all := make([]tokenUsageRow, 0, page.PageSize)
	for rows.Next() {
		var row tokenUsageRow
		if err := rows.Scan(
			&row.UsageEventID, &row.QARecordID, &row.SessionKey, &row.RunID, &row.AgentID,
			&row.Provider, &row.Model, &row.SourceType, &row.InputTokens, &row.OutputTokens,
			&row.CacheReadTokens, &row.CacheWriteTokens, &row.TotalTokens,
			&row.AssistantTextCount, &row.IsEstimated, &row.OccurredAt,
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
		items = append(items, mapTokenUsageRow(row))
	}
	return service.BuildPageResponse(items, total, page), nil
}

func (r *TokensRepository) GetSummary(query TokenSummaryQuery) (map[string]any, error) {
	filter := tokenCommonFilter(query)
	var totalTokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens int64
	var actualTokens, estimatedTokens, measurableTokens, estimatedCount, unavailableCount int64
	var measurableInputTokens, measurableOutputTokens, measurableCacheReadTokens, measurableCacheWriteTokens int64
	if err := r.db.QueryRow(
		`
		SELECT
			COALESCE(SUM(CASE WHEN source_type = 'actual' THEN total_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type = 'actual' THEN input_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type = 'actual' THEN output_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type = 'actual' THEN cache_read_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type = 'actual' THEN cache_write_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type = 'actual' THEN total_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type = 'estimated' THEN total_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type IN ('actual', 'estimated') THEN total_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type = 'estimated' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type = 'unavailable' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type IN ('actual', 'estimated') THEN input_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type IN ('actual', 'estimated') THEN output_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type IN ('actual', 'estimated') THEN cache_read_tokens ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN source_type IN ('actual', 'estimated') THEN cache_write_tokens ELSE 0 END), 0)
		FROM token_usage `+filter.Where(),
		filter.Params()...,
	).Scan(
		&totalTokens, &inputTokens, &outputTokens, &cacheReadTokens, &cacheWriteTokens,
		&actualTokens, &estimatedTokens, &measurableTokens, &estimatedCount, &unavailableCount,
		&measurableInputTokens, &measurableOutputTokens, &measurableCacheReadTokens, &measurableCacheWriteTokens,
	); err != nil {
		return nil, err
	}

	measurableFilter := tokenCommonFilter(query)
	measurableFilter.AppendIn("source_type", []string{"actual", "estimated"})
	rows, err := r.db.Query(
		`
		SELECT model, COALESCE(SUM(total_tokens), 0)
		FROM token_usage `+measurableFilter.Where()+`
		GROUP BY model
		ORDER BY 2 DESC, model ASC
		LIMIT 5`,
		measurableFilter.Params()...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	topModels := make([]map[string]any, 0)
	for rows.Next() {
		var model string
		var total int64
		if err := rows.Scan(&model, &total); err != nil {
			return nil, err
		}
		topModels = append(topModels, map[string]any{
			"model":       model,
			"totalTokens": total,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"totalTokens":                totalTokens,
		"inputTokens":                inputTokens,
		"outputTokens":               outputTokens,
		"cacheReadTokens":            cacheReadTokens,
		"cacheWriteTokens":           cacheWriteTokens,
		"actualTokens":               actualTokens,
		"estimatedTokens":            estimatedTokens,
		"measurableTokens":           measurableTokens,
		"measurableInputTokens":      measurableInputTokens,
		"measurableOutputTokens":     measurableOutputTokens,
		"measurableCacheReadTokens":  measurableCacheReadTokens,
		"measurableCacheWriteTokens": measurableCacheWriteTokens,
		"estimatedCount":             estimatedCount,
		"unavailableCount":           unavailableCount,
		"topModels":                  topModels,
	}, nil
}

func (r *TokensRepository) GetTrend(query TokenTrendQuery) (map[string]any, error) {
	bucket := "hour"
	if query.Bucket != nil && *query.Bucket == "day" {
		bucket = "day"
	}
	bucketSizeMs := int64(3600000)
	if bucket == "day" {
		bucketSizeMs = 86400000
	}
	filter := tokenCommonFilter(query.TokenSummaryQuery)
	filter.AppendIn("source_type", []string{"actual", "estimated"})

	rows, err := r.db.Query(
		`
		SELECT
			CAST(occurred_at / ? AS INTEGER) * ? AS bucket_start_ms,
			COALESCE(SUM(input_tokens), 0),
			COALESCE(SUM(output_tokens), 0),
			COALESCE(SUM(total_tokens), 0)
		FROM token_usage `+filter.Where()+`
		GROUP BY bucket_start_ms
		ORDER BY bucket_start_ms ASC`,
		append([]any{bucketSizeMs, bucketSizeMs}, filter.Params()...)...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	points := make([]map[string]any, 0)
	for rows.Next() {
		var bucketStartMs, inputTokens, outputTokens, totalTokens int64
		if err := rows.Scan(&bucketStartMs, &inputTokens, &outputTokens, &totalTokens); err != nil {
			return nil, err
		}
		points = append(points, map[string]any{
			"bucketStartMs": bucketStartMs,
			"inputTokens":   inputTokens,
			"outputTokens":  outputTokens,
			"totalTokens":   totalTokens,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"bucket": bucket,
		"points": points,
	}, nil
}

func (r *TokensRepository) GetHeatmap(query TokenSummaryQuery) (map[string]any, error) {
	filter := tokenCommonFilter(query)
	rows, err := r.db.Query(
		`
		SELECT occurred_at, total_tokens
		FROM token_usage `+filter.Where()+`
		ORDER BY occurred_at ASC, usage_event_id ASC`,
		filter.Params()...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	hourTotals := make([]int64, 24)
	weekdayTotals := make([]int64, 7)
	var totalTokens int64

	for rows.Next() {
		var occurredAtMs, rowTokens int64
		if err := rows.Scan(&occurredAtMs, &rowTokens); err != nil {
			return nil, err
		}
		totalTokens += rowTokens
		localTime := time.UnixMilli(occurredAtMs).In(time.Local)
		hourTotals[localTime.Hour()] += rowTokens
		weekdayTotals[int(localTime.Weekday())] += rowTokens
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	weekdayLabels := []string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}
	return map[string]any{
		"timeZone":    "local",
		"totalTokens": totalTokens,
		"hourTotals": buildTokenHeatmapTotals(hourTotals, "hour"),
		"weekdayTotals": buildTokenHeatmapWeekdayTotals(
			weekdayTotals,
			weekdayLabels,
		),
	}, nil
}

func buildTokenHeatmapTotals(values []int64, _ string) []map[string]any {
	out := make([]map[string]any, 0, len(values))
	for index, total := range values {
		out = append(out, map[string]any{
			"hour":        index,
			"totalTokens": total,
		})
	}
	return out
}

func buildTokenHeatmapWeekdayTotals(values []int64, labels []string) []map[string]any {
	out := make([]map[string]any, 0, len(values))
	for index, total := range values {
		label := ""
		if index >= 0 && index < len(labels) {
			label = labels[index]
		}
		out = append(out, map[string]any{
			"weekday":     index,
			"label":       label,
			"totalTokens": total,
		})
	}
	return out
}

func tokenCommonFilter(query TokenSummaryQuery) *Filter {
	filter := &Filter{}
	filter.AppendRange("occurred_at", query.FromMs, query.ToMs)
	filter.AppendEquals("session_key", query.SessionKey)
	filter.AppendEquals("run_id", query.RunID)
	filter.AppendEquals("provider", query.Provider)
	filter.AppendEquals("model", query.Model)
	return filter
}

func mapTokenUsageRow(row tokenUsageRow) map[string]any {
	out := map[string]any{
		"usageEventId":       row.UsageEventID,
		"provider":           row.Provider,
		"model":              row.Model,
		"sourceType":         row.SourceType,
		"inputTokens":        row.InputTokens,
		"outputTokens":       row.OutputTokens,
		"cacheReadTokens":    row.CacheReadTokens,
		"cacheWriteTokens":   row.CacheWriteTokens,
		"totalTokens":        row.TotalTokens,
		"assistantTextCount": row.AssistantTextCount,
		"isEstimated":        fromBoolInt(row.IsEstimated),
		"occurredAtMs":       row.OccurredAt,
	}
	putString(out, "sessionKey", row.SessionKey)
	putString(out, "qaRecordId", row.QARecordID)
	putString(out, "runId", row.RunID)
	putString(out, "agentId", row.AgentID)
	return out
}
