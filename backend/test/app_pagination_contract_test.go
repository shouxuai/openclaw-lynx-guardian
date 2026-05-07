package backend_test

import (
	"fmt"
	"net/http"
	"testing"
)

func TestNormalListRoutesReturnPageMetadata(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatch("pagination-contract"), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	cases := []struct {
		name       string
		path       string
		total      int
		totalPages int
	}{
		{name: "events", path: "/lynx/events?pageNum=1&pageSize=2&includeRoutineHeartbeat=true", total: 3, totalPages: 2},
		{name: "tool calls", path: "/lynx/tool-calls?pageNum=1&pageSize=1", total: 2, totalPages: 2},
		{name: "approvals", path: "/lynx/approvals?pageNum=1&pageSize=1", total: 1, totalPages: 1},
		{name: "lynx checks", path: "/lynx/lynx-checks?pageNum=1&pageSize=1", total: 1, totalPages: 1},
		{name: "sessions", path: "/lynx/sessions?pageNum=1&pageSize=1", total: 2, totalPages: 2},
		{name: "token usage", path: "/lynx/tokens/usage?pageNum=1&pageSize=1", total: 2, totalPages: 2},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, tc.path, nil, false), http.StatusOK)
			expectNumber(t, body, "total", tc.total)
			expectNumber(t, body, "pageNum", 1)
			expectNumber(t, body, "pageSize", pageSizeFromPath(tc.path))
			expectNumber(t, body, "totalPages", tc.totalPages)
		})
	}
}

func TestListRoutesClampInvalidPageParameters(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatch("pagination-clamp"), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	body := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/events?pageNum=-9&pageSize=0&includeRoutineHeartbeat=true", nil, false), http.StatusOK)
	expectNumber(t, body, "total", 3)
	expectNumber(t, body, "pageNum", 1)
	expectNumber(t, body, "pageSize", 20)
	expectNumber(t, body, "totalPages", 1)
}

func TestKeywordFiltersWorkForPagedTableRoutes(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatch("paged-keyword-filters"), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	cases := []struct {
		name    string
		path    string
		idKey   string
		wantID  string
		wantNum int
	}{
		{name: "tool calls", path: "/lynx/tool-calls?q=git%20status&pageNum=1&pageSize=20", idKey: "toolCallId", wantID: "tool-call-approval", wantNum: 1},
		{name: "approvals", path: "/lynx/approvals?q=definitely-not-present&pageNum=1&pageSize=20", idKey: "approvalId", wantNum: 0},
		{name: "sessions", path: "/lynx/sessions?q=account-alpha&pageNum=1&pageSize=20", idKey: "sessionKey", wantID: "session-alpha", wantNum: 1},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, tc.path, nil, false), http.StatusOK)
			expectNumber(t, body, "total", tc.wantNum)
			items := pageItems(t, body)
			if len(items) != tc.wantNum {
				t.Fatalf("expected %d filtered items, got %#v", tc.wantNum, items)
			}
			if tc.wantNum > 0 {
				expectString(t, items[0], tc.idKey, tc.wantID)
			}
		})
	}
}

func TestTokenSummarySeparatesActualEstimatedAndUnavailableUsage(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	items := []any{
		tokenUsageFixture("token-actual", "actual", 120, false, parityBaseTimeMs-300),
		tokenUsageFixture("token-estimated", "estimated", 1000, true, parityBaseTimeMs-200),
		tokenUsageFixture("token-unavailable", "unavailable", 0, false, parityBaseTimeMs-100),
	}
	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("token-summary-contract", items), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	body := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/tokens/summary?provider=openai", nil, false), http.StatusOK)
	expectNumber(t, body, "totalTokens", 120)
	expectNumber(t, body, "actualTokens", 120)
	expectNumber(t, body, "estimatedTokens", 1000)
	expectNumber(t, body, "measurableTokens", 1120)
	expectNumber(t, body, "measurableInputTokens", 1120)
	expectNumber(t, body, "measurableOutputTokens", 0)
	expectNumber(t, body, "estimatedCount", 1)
	expectNumber(t, body, "unavailableCount", 1)

	topModels, ok := body["topModels"].([]any)
	if !ok || len(topModels) != 1 {
		t.Fatalf("expected one measurable top model, got %#v", body["topModels"])
	}
	topModel, ok := topModels[0].(map[string]any)
	if !ok {
		t.Fatalf("expected top model object, got %#v", topModels[0])
	}
	expectNumber(t, topModel, "totalTokens", 1120)

	trend := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/tokens/trend?bucket=hour&provider=openai", nil, false), http.StatusOK)
	points, ok := trend["points"].([]any)
	if !ok || len(points) != 1 {
		t.Fatalf("expected one measurable trend point, got %#v", trend["points"])
	}
	point, ok := points[0].(map[string]any)
	if !ok {
		t.Fatalf("expected trend point object, got %#v", points[0])
	}
	expectNumber(t, point, "inputTokens", 1120)
	expectNumber(t, point, "outputTokens", 0)
	expectNumber(t, point, "totalTokens", 1120)
}

func TestToolCallAndApprovalDetailRoutesExposeRawDetailContracts(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatch("detail-contract"), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	toolDetail := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/tool-calls/tool-call-approval", nil, false), http.StatusOK)
	expectString(t, toolDetail, "toolCallId", "tool-call-approval")
	expectString(t, toolDetail, "paramSummary", "command=git status")
	expectStringSlice(t, toolDetail, "triggeredModules", []string{"M2:protected_file_access"})
	if _, ok := toolDetail["metadataJson"].(map[string]any); !ok {
		t.Fatalf("expected tool call metadataJson object, got %#v", toolDetail["metadataJson"])
	}

	approvalDetail := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/approvals/approval-alpha", nil, false), http.StatusOK)
	expectString(t, approvalDetail, "approvalId", "approval-alpha")
	expectString(t, approvalDetail, "channelProfile", "feishu")
	expectStringSlice(t, approvalDetail, "approverOuIds", []string{"ou_owner"})
	if _, ok := approvalDetail["auditSummaryJson"].(map[string]any); !ok {
		t.Fatalf("expected approval auditSummaryJson object, got %#v", approvalDetail["auditSummaryJson"])
	}

	decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/tool-calls/missing-tool-call", nil, false), http.StatusNotFound)
	decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/approvals/missing-approval", nil, false), http.StatusNotFound)
}

func pageSizeFromPath(path string) int {
	switch path {
	case "/lynx/events?pageNum=1&pageSize=2&includeRoutineHeartbeat=true":
		return 2
	default:
		return 1
	}
}

func tokenUsageFixture(id string, sourceType string, totalTokens int, estimated bool, occurredAtMs int64) map[string]any {
	return map[string]any{
		"kind":         "tokenUsage",
		"itemId":       fmt.Sprintf("%s-item", id),
		"occurredAtMs": occurredAtMs,
		"data": map[string]any{
			"usageEventId":       id,
			"sessionKey":         "session-token-contract",
			"runId":              "run-token-contract",
			"agentId":            "agent-main",
			"provider":           "openai",
			"model":              "openclaw/main",
			"sourceType":         sourceType,
			"inputTokens":        totalTokens,
			"outputTokens":       0,
			"cacheReadTokens":    0,
			"cacheWriteTokens":   0,
			"totalTokens":        totalTokens,
			"assistantTextCount": 1,
			"isEstimated":        estimated,
		},
	}
}
