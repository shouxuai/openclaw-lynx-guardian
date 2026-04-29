package backend_test

import (
	"net/http"
	"strings"
	"testing"
)

func TestLynxCheckDetailReturnsFullReportMarkdown(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	reportMarkdown := "# Lynx 检测报告\n\n" + strings.Repeat("## Full Section\n\n完整检测内容。\n\n", 120)
	item := map[string]any{
		"kind":         "lynxCheckUpsert",
		"itemId":       "full-report-item",
		"occurredAtMs": parityBaseTimeMs - 100,
		"data": map[string]any{
			"requestId":           "full-report-check",
			"source":              "manual",
			"trigger":             "lynx_command",
			"preferredTargetKind": "current",
			"sessionKey":          "session-report",
			"targetKey":           "current",
			"status":              "completed",
			"sendAttempted":       true,
			"sendSucceeded":       true,
			"transport":           "precomputed",
			"reportPath":          "/tmp/full-report.md",
			"reportMarkdown":      reportMarkdown,
			"createdAtMs":         parityBaseTimeMs - 200,
			"completedAtMs":       parityBaseTimeMs - 100,
		},
	}
	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("full-report-contract", []any{item}), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	detail := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/lynx-checks/full-report-check", nil, false), http.StatusOK)
	if got, _ := detail["reportMarkdown"].(string); got != reportMarkdown {
		t.Fatalf("expected full reportMarkdown length %d, got length %d", len(reportMarkdown), len(got))
	}
}

func TestLynxCheckListFiltersByKeyword(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	items := []any{
		map[string]any{
			"kind":         "lynxCheckUpsert",
			"itemId":       "keyword-match-item",
			"occurredAtMs": parityBaseTimeMs - 100,
			"data": map[string]any{
				"requestId":           "check-keyword-match",
				"qaRecordId":          "qa-keyword-42",
				"source":              "manual",
				"trigger":             "lynx_command",
				"preferredTargetKind": "current",
				"sessionKey":          "session-keyword",
				"targetKey":           "current",
				"status":              "completed",
				"sendAttempted":       true,
				"sendSucceeded":       true,
				"transport":           "precomputed",
				"reportPath":          "/tmp/keyword-match.md",
				"createdAtMs":         parityBaseTimeMs - 200,
				"completedAtMs":       parityBaseTimeMs - 100,
			},
		},
		map[string]any{
			"kind":         "lynxCheckUpsert",
			"itemId":       "keyword-miss-item",
			"occurredAtMs": parityBaseTimeMs - 300,
			"data": map[string]any{
				"requestId":           "check-other",
				"source":              "manual",
				"trigger":             "lynx_command",
				"preferredTargetKind": "current",
				"sessionKey":          "session-other",
				"targetKey":           "current",
				"status":              "completed",
				"sendAttempted":       true,
				"sendSucceeded":       true,
				"transport":           "precomputed",
				"reportPath":          "/tmp/other.md",
				"createdAtMs":         parityBaseTimeMs - 400,
				"completedAtMs":       parityBaseTimeMs - 300,
			},
		},
	}
	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("keyword-filter-contract", items), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	page := doJSON(t, handler, http.MethodGet, "/lynx/lynx-checks?q=session-keyword", nil, false)
	checkItems := expectItems(t, page, http.StatusOK)
	if len(checkItems) != 1 {
		t.Fatalf("expected one keyword match, got %d items: %#v", len(checkItems), checkItems)
	}
	expectString(t, checkItems[0], "requestId", "check-keyword-match")
}
