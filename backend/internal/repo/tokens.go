package repo

import (
	"database/sql"

	"github.com/openclaw/lynx-guardian/backend/internal/service"
)

type TokenUsageListQuery struct {
	FromMs      *int64
	ToMs        *int64
	SessionKey  *string
	RunID       *string
	Limit       *int
	Cursor      *string
	Provider    *string
	Model       *string
	AgentID     *string
	IsEstimated *bool
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

type tokenUsageRow struct {
	UsageEventID       string
	SessionKey         sql.NullString
	RunID              sql.NullString
	AgentID            sql.NullString
	Provider           string
	Model              string
	InputTokens        int64
	OutputTokens       int64
	CacheReadTokens    int64
	CacheWriteTokens   int64
	TotalTokens        int64
	AssistantTextCount int64
	IsEstimated        int64
	OccurredAt         int64
}

func (r *TokensRepository) List(query TokenUsageListQuery) (service.CursorPage[map[string]any], error) {
	limit := service.ResolveListLimit(query.Limit)
	cursor := service.DecodeDescendingCursor(query.Cursor)
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
	filter.AppendDescendingCursor("occurred_at", "usage_event_id", cursor)

	rows, err := r.db.Query(
		`
		SELECT
			usage_event_id, session_key, run_id, agent_id, provider, model,
			input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
			total_tokens, assistant_text_count, is_estimated, occurred_at
		FROM token_usage `+filter.Where()+`
		ORDER BY occurred_at DESC, usage_event_id DESC
		LIMIT ?`,
		append(filter.Params(), limit+1)...,
	)
	if err != nil {
		return service.CursorPage[map[string]any]{}, err
	}
	defer rows.Close()

	all := make([]tokenUsageRow, 0, limit+1)
	for rows.Next() {
		var row tokenUsageRow
		if err := rows.Scan(
			&row.UsageEventID, &row.SessionKey, &row.RunID, &row.AgentID,
			&row.Provider, &row.Model, &row.InputTokens, &row.OutputTokens,
			&row.CacheReadTokens, &row.CacheWriteTokens, &row.TotalTokens,
			&row.AssistantTextCount, &row.IsEstimated, &row.OccurredAt,
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
		mapTokenUsageRow,
		func(row tokenUsageRow) service.DescendingCursor {
			return service.DescendingCursor{SortValue: row.OccurredAt, ID: row.UsageEventID}
		},
	), nil
}

func (r *TokensRepository) GetSummary(query TokenSummaryQuery) (map[string]any, error) {
	filter := tokenCommonFilter(query)
	var totalTokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, estimatedCount int64
	if err := r.db.QueryRow(
		`
		SELECT
			COALESCE(SUM(total_tokens), 0),
			COALESCE(SUM(input_tokens), 0),
			COALESCE(SUM(output_tokens), 0),
			COALESCE(SUM(cache_read_tokens), 0),
			COALESCE(SUM(cache_write_tokens), 0),
			COALESCE(SUM(CASE WHEN is_estimated = 1 THEN 1 ELSE 0 END), 0)
		FROM token_usage `+filter.Where(),
		filter.Params()...,
	).Scan(&totalTokens, &inputTokens, &outputTokens, &cacheReadTokens, &cacheWriteTokens, &estimatedCount); err != nil {
		return nil, err
	}

	rows, err := r.db.Query(
		`
		SELECT model, COALESCE(SUM(total_tokens), 0)
		FROM token_usage `+filter.Where()+`
		GROUP BY model
		ORDER BY 2 DESC, model ASC
		LIMIT 5`,
		filter.Params()...,
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
		"totalTokens":      totalTokens,
		"inputTokens":      inputTokens,
		"outputTokens":     outputTokens,
		"cacheReadTokens":  cacheReadTokens,
		"cacheWriteTokens": cacheWriteTokens,
		"estimatedCount":   estimatedCount,
		"topModels":        topModels,
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
	putString(out, "runId", row.RunID)
	putString(out, "agentId", row.AgentID)
	return out
}
