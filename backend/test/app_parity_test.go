package backend_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	backendapp "github.com/openclaw/lynx-guardian/backend/internal/app"
	"github.com/openclaw/lynx-guardian/backend/internal/config"
)

const parityBaseTimeMs int64 = 1776928800000

func TestIngestPersistsValidItemsAndCountsDuplicates(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	first := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatch("batch-1"), true)
	if first.Code != http.StatusOK {
		t.Fatalf("expected first ingest 200, got %d: %s", first.Code, first.Body.String())
	}
	firstBody := decodeObject(t, first)
	expectNumber(t, firstBody, "acceptedCount", 11)
	expectNumber(t, firstBody, "persistedCount", 11)
	expectNumber(t, firstBody, "duplicateCount", 0)
	expectNumber(t, firstBody, "rejectedCount", 0)

	duplicate := map[string]any{
		"schemaVersion": "lynx-server.ingest.v1",
		"producer":      map[string]any{"pluginId": "openclaw-lynx-guardian"},
		"sentAtMs":      parityBaseTimeMs,
		"batchId":       "batch-duplicate",
		"items":         []any{fixtureItems()[2]},
	}
	second := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", duplicate, true)
	if second.Code != http.StatusOK {
		t.Fatalf("expected duplicate ingest 200, got %d: %s", second.Code, second.Body.String())
	}
	secondBody := decodeObject(t, second)
	expectNumber(t, secondBody, "acceptedCount", 1)
	expectNumber(t, secondBody, "persistedCount", 0)
	expectNumber(t, secondBody, "duplicateCount", 1)
	expectNumber(t, secondBody, "rejectedCount", 0)
}

func TestIngestRejectsInvalidEnumValues(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	payload := map[string]any{
		"schemaVersion": "lynx-server.ingest.v1",
		"producer":      map[string]any{"pluginId": "openclaw-lynx-guardian"},
		"sentAtMs":      parityBaseTimeMs,
		"batchId":       "invalid-enum-batch",
		"items": []any{
			map[string]any{
				"kind":         "auditEvent",
				"itemId":       "invalid-source-kind-item",
				"occurredAtMs": parityBaseTimeMs,
				"data": map[string]any{
					"eventId":           "invalid-source-kind-event",
					"sourceKind":        "not_a_source",
					"hookName":          "message_received",
					"eventType":         "input_guard",
					"category":          "input",
					"enforcementAction": "allow",
					"title":             "Invalid enum",
				},
			},
		},
	}

	response := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", payload, true)
	body := decodeObjectStatus(t, response, http.StatusOK)
	expectNumber(t, body, "acceptedCount", 0)
	expectNumber(t, body, "persistedCount", 0)
	expectNumber(t, body, "rejectedCount", 1)
}

func TestSplitIngestEndpointPersistsOnlyMatchingItems(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	items := fixtureItems()
	response := doJSON(
		t,
		handler,
		http.MethodPost,
		"/lynx/internal/v1/ingest/tool-calls",
		fixtureBatchWithItems("tool-calls-split", []any{items[5]}),
		true,
	)
	body := decodeObjectStatus(t, response, http.StatusOK)
	expectNumber(t, body, "acceptedCount", 1)
	expectNumber(t, body, "persistedCount", 1)
	expectNumber(t, body, "rejectedCount", 0)

	mismatch := doJSON(
		t,
		handler,
		http.MethodPost,
		"/lynx/internal/v1/ingest/tool-calls",
		fixtureBatchWithItems("tool-calls-mismatch", []any{items[2]}),
		true,
	)
	mismatchBody := decodeObjectStatus(t, mismatch, http.StatusOK)
	expectNumber(t, mismatchBody, "acceptedCount", 0)
	expectNumber(t, mismatchBody, "persistedCount", 0)
	expectNumber(t, mismatchBody, "rejectedCount", 1)
}

func TestLynxCheckUpsertCompatibilityPreservesTaskStateMachineStatus(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	start := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/start", map[string]any{
		"requestId":  "compat-task-1",
		"trigger":    "manual",
		"source":     "lynx_command",
		"sessionKey": "agent:main:main",
		"targetKey":  "current",
	}, true)
	decodeObjectStatus(t, start, http.StatusOK)

	legacyRunning := map[string]any{
		"kind":         "lynxCheckUpsert",
		"itemId":       "compat-task-running",
		"occurredAtMs": parityBaseTimeMs,
		"data": map[string]any{
			"requestId":           "compat-task-1",
			"source":              "manual",
			"trigger":             "lynx_command",
			"preferredTargetKind": "current",
			"sessionKey":          "agent:main:main",
			"targetKey":           "current",
			"status":              "running",
			"sendAttempted":       false,
			"sendSucceeded":       false,
			"transport":           "precomputed",
			"reportPath":          "/tmp/compat-report.md",
			"createdAtMs":         parityBaseTimeMs,
		},
	}
	ingest := doJSON(
		t,
		handler,
		http.MethodPost,
		"/lynx/internal/v1/ingest/batch",
		fixtureBatchWithItems("compat-task-running-batch", []any{legacyRunning}),
		true,
	)
	decodeObjectStatus(t, ingest, http.StatusOK)

	complete := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/compat-task-1/event", map[string]any{
		"status":          "completed",
		"deliveryChannel": "inline-message",
		"deliveryStatus":  "sent",
	}, true)
	decodeObjectStatus(t, complete, http.StatusOK)

	detail := doJSON(t, handler, http.MethodGet, "/lynx/lynx-checks/compat-task-1", nil, false)
	detailBody := decodeObjectStatus(t, detail, http.StatusOK)
	expectString(t, detailBody, "status", "completed")
	expectBool(t, detailBody, "sendSucceeded", true)

	lateRunning := legacyRunning
	lateRunning["itemId"] = "compat-task-running-late"
	lateRunning["occurredAtMs"] = parityBaseTimeMs + 1000
	lateData := make(map[string]any)
	for key, value := range legacyRunning["data"].(map[string]any) {
		lateData[key] = value
	}
	lateData["createdAtMs"] = parityBaseTimeMs + 1000
	lateRunning["data"] = lateData
	lateIngest := doJSON(
		t,
		handler,
		http.MethodPost,
		"/lynx/internal/v1/ingest/batch",
		fixtureBatchWithItems("compat-task-late-running-batch", []any{lateRunning}),
		true,
	)
	decodeObjectStatus(t, lateIngest, http.StatusOK)

	afterLate := doJSON(t, handler, http.MethodGet, "/lynx/lynx-checks/compat-task-1", nil, false)
	afterLateBody := decodeObjectStatus(t, afterLate, http.StatusOK)
	expectString(t, afterLateBody, "status", "completed")
}

func TestToolCallAfterUpsertDoesNotDowngradeRiskEnforcement(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	before := map[string]any{
		"kind":         "toolCallUpsert",
		"itemId":       "tool-call-risk-before",
		"occurredAtMs": parityBaseTimeMs - 2000,
		"data": map[string]any{
			"toolCallId":        "tool-call-risk",
			"sessionKey":        "session-risk",
			"runId":             "run-risk",
			"toolName":          "exec",
			"paramSummary":      "rm -rf /important",
			"paramHash":         "hash-risk",
			"triggeredModules":  []string{"M5:dangerous_exec"},
			"riskLevel":         "L4",
			"riskScore":         10,
			"policyDecision":    "deny",
			"enforcementAction": "block",
			"startedAtMs":       parityBaseTimeMs - 2000,
		},
	}
	after := map[string]any{
		"kind":         "toolCallUpsert",
		"itemId":       "tool-call-risk-after",
		"occurredAtMs": parityBaseTimeMs - 1500,
		"data": map[string]any{
			"toolCallId":        "tool-call-risk",
			"sessionKey":        "session-risk",
			"runId":             "run-risk",
			"toolName":          "exec",
			"enforcementAction": "allow",
			"startedAtMs":       parityBaseTimeMs - 1500,
			"finishedAtMs":      parityBaseTimeMs - 1400,
			"durationMs":        100,
			"resultStatus":      "completed",
		},
	}

	seed := doJSON(
		t,
		handler,
		http.MethodPost,
		"/lynx/internal/v1/ingest/batch",
		fixtureBatchWithItems("risk-before", []any{before}),
		true,
	)
	decodeObjectStatus(t, seed, http.StatusOK)

	update := doJSON(
		t,
		handler,
		http.MethodPost,
		"/lynx/internal/v1/ingest/batch",
		fixtureBatchWithItems("risk-after", []any{after}),
		true,
	)
	decodeObjectStatus(t, update, http.StatusOK)

	detail := doJSON(t, handler, http.MethodGet, "/lynx/tool-calls/tool-call-risk", nil, false)
	body := decodeObjectStatus(t, detail, http.StatusOK)
	expectString(t, body, "policyDecision", "deny")
	expectString(t, body, "enforcementAction", "block")
	expectString(t, body, "resultStatus", "completed")
}

func TestQueryRoutesServeIngestedFixtureData(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatch("fixture-batch"), true)
	if seed.Code != http.StatusOK {
		t.Fatalf("expected seed ingest 200, got %d: %s", seed.Code, seed.Body.String())
	}

	events := doJSON(t, handler, http.MethodGet, "/lynx/events?pageNum=1&pageSize=1", nil, false)
	eventItems := expectItems(t, events, http.StatusOK)
	expectString(t, eventItems[0], "eventId", "event-approval")
	expectString(t, eventItems[0], "enforcementAction", "requireApproval")
	expectString(t, eventItems[0], "recommendation", "Review requester identity before approving exec.")
	eventsBody := decodeObject(t, events)
	expectNumber(t, eventsBody, "total", 3)
	expectNumber(t, eventsBody, "pageNum", 1)
	expectNumber(t, eventsBody, "pageSize", 1)
	expectNumber(t, eventsBody, "totalPages", 3)

	l0Events := doJSON(t, handler, http.MethodGet, "/lynx/events?pageNum=1&pageSize=5&riskLevel=L0", nil, false)
	l0EventItems := expectItems(t, l0Events, http.StatusOK)
	l0EventsBody := decodeObject(t, l0Events)
	expectNumber(t, l0EventsBody, "total", 1)
	expectString(t, l0EventItems[0], "eventId", "event-allow")
	expectString(t, l0EventItems[0], "riskLevel", "L0")

	eventDetail := doJSON(t, handler, http.MethodGet, "/lynx/events/event-approval", nil, false)
	eventDetailBody := decodeObjectStatus(t, eventDetail, http.StatusOK)
	expectString(t, eventDetailBody, "eventId", "event-approval")
	expectString(t, eventDetailBody, "enforcementAction", "requireApproval")
	expectStringSlice(t, eventDetailBody, "modules", []string{"M2:protected_file_access"})

	toolCalls := doJSON(t, handler, http.MethodGet, "/lynx/tool-calls?limit=5&toolName=exec&approvalId=approval-alpha", nil, false)
	toolItems := expectItems(t, toolCalls, http.StatusOK)
	expectString(t, toolItems[0], "toolCallId", "tool-call-approval")
	expectString(t, toolItems[0], "enforcementAction", "requireApproval")

	toolDetail := doJSON(t, handler, http.MethodGet, "/lynx/tool-calls/tool-call-approval", nil, false)
	toolDetailBody := decodeObjectStatus(t, toolDetail, http.StatusOK)
	expectStringSlice(t, toolDetailBody, "triggeredModules", []string{"M2:protected_file_access"})

	approvals := doJSON(t, handler, http.MethodGet, "/lynx/approvals?limit=5&module=M2:protected_file_access&scopeType=singleTool&requesterOuId=ou_alpha", nil, false)
	approvalItems := expectItems(t, approvals, http.StatusOK)
	expectString(t, approvalItems[0], "approvalId", "approval-alpha")
	expectString(t, approvalItems[0], "scopeType", "singleTool")

	checks := doJSON(t, handler, http.MethodGet, "/lynx/lynx-checks?limit=5&source=manual&trigger=lynx_command&status=completed&messageProvider=feishu", nil, false)
	checkItems := expectItems(t, checks, http.StatusOK)
	expectString(t, checkItems[0], "requestId", "lynx-check-alpha")
	expectBool(t, checkItems[0], "sendAttempted", true)

	sessions := doJSON(t, handler, http.MethodGet, "/lynx/sessions?limit=5&channelProfile=feishu&requesterOuId=ou_alpha&isGroup=false", nil, false)
	sessionItems := expectItems(t, sessions, http.StatusOK)
	expectString(t, sessionItems[0], "sessionKey", "session-alpha")
	expectNumber(t, sessionItems[0], "eventCount", 2)
	expectNumber(t, sessionItems[0], "toolCallCount", 1)

	sessionDetail := doJSON(t, handler, http.MethodGet, "/lynx/sessions/session-alpha", nil, false)
	sessionDetailBody := decodeObjectStatus(t, sessionDetail, http.StatusOK)
	expectString(t, sessionDetailBody, "sessionKey", "session-alpha")
	if _, ok := sessionDetailBody["tokenSummary"].(map[string]any); !ok {
		t.Fatalf("expected session tokenSummary")
	}

	dashboardPath := fmt.Sprintf("/lynx/dashboard/overview?fromMs=%d&toMs=%d", parityBaseTimeMs-10000, parityBaseTimeMs)
	dashboard := doJSON(t, handler, http.MethodGet, dashboardPath, nil, false)
	dashboardBody := decodeObjectStatus(t, dashboard, http.StatusOK)
	totals, ok := dashboardBody["totals"].(map[string]any)
	if !ok {
		t.Fatalf("expected dashboard totals object")
	}
	expectNumber(t, totals, "eventCount", 3)
	if _, ok := totals["highRiskEventCount"]; ok {
		t.Fatalf("dashboard overview should expose independent L0-L4 buckets instead of a combined highRiskEventCount")
	}
	expectNumber(t, totals, "toolCallCount", 2)
	expectNumber(t, totals, "approvalCount", 1)
	expectNumber(t, totals, "lynxCheckCount", 1)
	expectNumber(t, totals, "totalTokens", 315)
	if _, ok := totals["rawAuditEventCount"]; ok {
		t.Fatalf("dashboard overview should not expose rawAuditEventCount to the frontend")
	}
	riskDistribution, ok := dashboardBody["riskDistribution"].([]any)
	if !ok {
		t.Fatalf("expected dashboard riskDistribution array")
	}
	expectRiskBucketCount(t, riskDistribution, "L1", 1)
	expectRiskBucketCount(t, riskDistribution, "L2", 1)
	expectRiskBucketCount(t, riskDistribution, "L3", 1)
	expectRiskBucketTotal(t, riskDistribution, 3)
	if _, ok := dashboardBody["recentSecurityEvents"].([]any); !ok {
		t.Fatalf("expected dashboard recentSecurityEvents array")
	}
	if _, ok := dashboardBody["recentHighRiskEvents"]; ok {
		t.Fatalf("dashboard overview should expose recentSecurityEvents instead of recentHighRiskEvents")
	}

	tokenUsage := doJSON(t, handler, http.MethodGet, "/lynx/tokens/usage?limit=5&provider=openai&isEstimated=true", nil, false)
	tokenItems := expectItems(t, tokenUsage, http.StatusOK)
	expectString(t, tokenItems[0], "usageEventId", "usage-secondary")
	expectBool(t, tokenItems[0], "isEstimated", true)

	tokenSummary := doJSON(t, handler, http.MethodGet, "/lynx/tokens/summary?provider=openai", nil, false)
	tokenSummaryBody := decodeObjectStatus(t, tokenSummary, http.StatusOK)
	expectNumber(t, tokenSummaryBody, "totalTokens", 315)
	expectNumber(t, tokenSummaryBody, "actualTokens", 315)
	expectNumber(t, tokenSummaryBody, "estimatedTokens", 120)
	expectNumber(t, tokenSummaryBody, "measurableTokens", 435)
	expectNumber(t, tokenSummaryBody, "estimatedCount", 1)

	tokenTrend := doJSON(t, handler, http.MethodGet, "/lynx/tokens/trend?bucket=hour&provider=openai", nil, false)
	tokenTrendBody := decodeObjectStatus(t, tokenTrend, http.StatusOK)
	expectString(t, tokenTrendBody, "bucket", "hour")
}

func buildParityHandler(t *testing.T) (http.Handler, backendapp.Closer) {
	t.Helper()

	tempDir := t.TempDir()
	cfg := &config.Config{
		Host:              "127.0.0.1",
		ListenHost:        "127.0.0.1",
		Port:              "31789",
		DataDir:           tempDir,
		DatabasePath:      tempDir + "/lynx.db",
		IngestToken:       "test-token",
		TokenPath:         tempDir + "/console.token",
		FrontendDistPath:  tempDir,
		TokenUsageEnabled: true,
		TrustedProxyIPs:   nil,
	}

	handler, closer, err := backendapp.Build(cfg)
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	return handler, closer
}

func doJSON(t *testing.T, handler http.Handler, method, path string, payload any, authorized bool) *httptest.ResponseRecorder {
	t.Helper()

	var body *bytes.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		body = bytes.NewReader(data)
	} else {
		body = bytes.NewReader(nil)
	}

	request := httptest.NewRequest(method, path, body)
	request.RemoteAddr = "127.0.0.1:12345"
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if authorized {
		request.Header.Set("Authorization", "Bearer test-token")
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func decodeObjectStatus(t *testing.T, response *httptest.ResponseRecorder, status int) map[string]any {
	t.Helper()
	if response.Code != status {
		t.Fatalf("expected status %d, got %d: %s", status, response.Code, response.Body.String())
	}
	return decodeObject(t, response)
}

func decodeObject(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response JSON: %v: %s", err, response.Body.String())
	}
	return payload
}

func expectItems(t *testing.T, response *httptest.ResponseRecorder, status int) []map[string]any {
	t.Helper()
	payload := decodeObjectStatus(t, response, status)
	rawItems, ok := payload["items"].([]any)
	if !ok {
		t.Fatalf("expected items array in %v", payload)
	}
	items := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("expected item object, got %T", raw)
		}
		items = append(items, item)
	}
	if len(items) == 0 {
		t.Fatalf("expected at least one item")
	}
	return items
}

func expectString(t *testing.T, payload map[string]any, key, want string) {
	t.Helper()
	if got, _ := payload[key].(string); got != want {
		t.Fatalf("expected %s=%q, got %#v in %#v", key, want, payload[key], payload)
	}
}

func expectBool(t *testing.T, payload map[string]any, key string, want bool) {
	t.Helper()
	if got, _ := payload[key].(bool); got != want {
		t.Fatalf("expected %s=%v, got %#v in %#v", key, want, payload[key], payload)
	}
}

func expectNumber(t *testing.T, payload map[string]any, key string, want int) {
	t.Helper()
	got, ok := payload[key].(float64)
	if !ok || int(got) != want {
		t.Fatalf("expected %s=%d, got %#v in %#v", key, want, payload[key], payload)
	}
}

func expectStringSlice(t *testing.T, payload map[string]any, key string, want []string) {
	t.Helper()
	raw, ok := payload[key].([]any)
	if !ok {
		t.Fatalf("expected %s array, got %#v", key, payload[key])
	}
	if len(raw) != len(want) {
		t.Fatalf("expected %s length %d, got %d", key, len(want), len(raw))
	}
	for i := range want {
		if got, _ := raw[i].(string); got != want[i] {
			t.Fatalf("expected %s[%d]=%q, got %#v", key, i, want[i], raw[i])
		}
	}
}

func expectRiskBucketCount(t *testing.T, raw []any, riskLevel string, want int) {
	t.Helper()
	for _, item := range raw {
		bucket, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("expected risk bucket object, got %T", item)
		}
		if got, _ := bucket["riskLevel"].(string); got != riskLevel {
			continue
		}
		expectNumber(t, bucket, "count", want)
		return
	}
	t.Fatalf("expected risk bucket %s in %#v", riskLevel, raw)
}

func expectRiskBucketTotal(t *testing.T, raw []any, want int) {
	t.Helper()
	total := 0
	for _, item := range raw {
		bucket, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("expected risk bucket object, got %T", item)
		}
		got, ok := bucket["count"].(float64)
		if !ok {
			t.Fatalf("expected risk bucket count number, got %#v", bucket["count"])
		}
		total += int(got)
	}
	if total != want {
		t.Fatalf("expected risk bucket total %d, got %d in %#v", want, total, raw)
	}
}

func fixtureBatch(batchID string) map[string]any {
	return fixtureBatchWithItems(batchID, fixtureItems())
}

func fixtureBatchWithItems(batchID string, items []any) map[string]any {
	return map[string]any{
		"schemaVersion": "lynx-server.ingest.v1",
		"producer":      map[string]any{"pluginId": "openclaw-lynx-guardian"},
		"sentAtMs":      parityBaseTimeMs,
		"batchId":       batchID,
		"items":         items,
	}
}

func fixtureItems() []any {
	return []any{
		map[string]any{
			"kind":         "sessionUpsert",
			"itemId":       "session-alpha-upsert",
			"occurredAtMs": parityBaseTimeMs - 5000,
			"data": map[string]any{
				"sessionKey":     "session-alpha",
				"channelProfile": "feishu",
				"channelId":      "feishu",
				"requesterId":    "user-alpha",
				"requesterOuId":  "ou_alpha",
				"accountId":      "account-alpha",
				"conversationId": "conv-alpha",
				"threadId":       "thread-alpha",
				"isGroup":        false,
				"firstSeenAtMs":  parityBaseTimeMs - 5000,
				"lastSeenAtMs":   parityBaseTimeMs - 1000,
				"metadataJson":   map[string]any{"source": "fixture"},
			},
		},
		map[string]any{
			"kind":         "sessionUpsert",
			"itemId":       "session-beta-upsert",
			"occurredAtMs": parityBaseTimeMs - 4000,
			"data": map[string]any{
				"sessionKey":     "session-beta",
				"channelProfile": "feishu",
				"channelId":      "group-chat",
				"requesterId":    "user-beta",
				"requesterOuId":  "ou_beta",
				"accountId":      "account-beta",
				"conversationId": "conv-beta",
				"threadId":       "thread-beta",
				"isGroup":        true,
				"firstSeenAtMs":  parityBaseTimeMs - 4000,
				"lastSeenAtMs":   parityBaseTimeMs - 2000,
			},
		},
		map[string]any{
			"kind":         "auditEvent",
			"itemId":       "event-allow-item",
			"occurredAtMs": parityBaseTimeMs - 4200,
			"data": map[string]any{
				"eventId":           "event-allow",
				"sessionKey":        "session-alpha",
				"runId":             "run-alpha",
				"sourceKind":        "plugin_hook",
				"hookName":          "message_received",
				"eventType":         "input_guard",
				"category":          "input",
				"direction":         "input",
				"enforcementAction": "allow",
				"title":             "Inbound message received",
				"summary":           "The input was allowed.",
			},
		},
		map[string]any{
			"kind":         "auditEvent",
			"itemId":       "event-approval-item",
			"occurredAtMs": parityBaseTimeMs - 1000,
			"data": map[string]any{
				"eventId":           "event-approval",
				"sessionKey":        "session-alpha",
				"runId":             "run-alpha",
				"toolCallId":        "tool-call-approval",
				"approvalId":        "approval-alpha",
				"sourceKind":        "plugin_hook",
				"hookName":          "before_tool_call",
				"eventType":         "tool_call_evaluated",
				"category":          "tool",
				"subCategory":       "approval",
				"direction":         "internal",
				"primaryModule":     "M2:protected_file_access",
				"modules":           []string{"M2:protected_file_access"},
				"riskLevel":         "L3",
				"riskScore":         8,
				"policyDecision":    "confirm",
				"enforcementAction": "requireApproval",
				"title":             "Tool call evaluated",
				"summary":           "Approval is required before running exec.",
				"recommendation":    "Review requester identity before approving exec.",
				"contentExcerpt":    "exec command requires approval",
				"payloadJson":       map[string]any{"toolName": "exec"},
			},
		},
		map[string]any{
			"kind":         "auditEvent",
			"itemId":       "event-beta-item",
			"occurredAtMs": parityBaseTimeMs - 2000,
			"data": map[string]any{
				"eventId":           "event-beta",
				"sessionKey":        "session-beta",
				"runId":             "run-beta",
				"requestId":         "lynx-check-alpha",
				"sourceKind":        "plugin_hook",
				"hookName":          "before_agent_start",
				"eventType":         "agent_start_evaluated",
				"category":          "agent",
				"direction":         "input",
				"riskLevel":         "L2",
				"riskScore":         6,
				"policyDecision":    "allow",
				"enforcementAction": "warn",
				"title":             "Agent start evaluated",
				"summary":           "Managed lynx check started.",
			},
		},
		map[string]any{
			"kind":         "toolCallUpsert",
			"itemId":       "tool-call-approval-item",
			"occurredAtMs": parityBaseTimeMs - 1000,
			"data": map[string]any{
				"toolCallId":        "tool-call-approval",
				"sessionKey":        "session-alpha",
				"runId":             "run-alpha",
				"approvalId":        "approval-alpha",
				"toolName":          "exec",
				"paramSummary":      "command=git status",
				"paramHash":         "hash-exec",
				"triggeredModules":  []string{"M2:protected_file_access"},
				"riskLevel":         "L3",
				"riskScore":         8,
				"policyDecision":    "confirm",
				"enforcementAction": "requireApproval",
				"startedAtMs":       parityBaseTimeMs - 1000,
				"finishedAtMs":      parityBaseTimeMs - 900,
				"durationMs":        100,
				"resultStatus":      "approved",
				"resultExcerpt":     "git status",
				"metadataJson":      map[string]any{"phase": "before"},
			},
		},
		map[string]any{
			"kind":         "toolCallUpsert",
			"itemId":       "tool-call-read-item",
			"occurredAtMs": parityBaseTimeMs - 2500,
			"data": map[string]any{
				"toolCallId":        "tool-call-read",
				"sessionKey":        "session-beta",
				"runId":             "run-beta",
				"toolName":          "read",
				"paramSummary":      "path=/tmp/report.md",
				"paramHash":         "hash-read",
				"triggeredModules":  []string{"M1:normal_read"},
				"riskLevel":         "L1",
				"riskScore":         2,
				"policyDecision":    "allow",
				"enforcementAction": "allow",
				"startedAtMs":       parityBaseTimeMs - 2500,
				"finishedAtMs":      parityBaseTimeMs - 2350,
				"durationMs":        150,
				"resultStatus":      "completed",
				"resultExcerpt":     "report body",
			},
		},
		map[string]any{
			"kind":         "approvalUpsert",
			"itemId":       "approval-item",
			"occurredAtMs": parityBaseTimeMs - 1100,
			"data": map[string]any{
				"approvalId":             "approval-alpha",
				"pendingId":              "approval-alpha",
				"sessionKey":             "session-alpha",
				"runId":                  "run-alpha",
				"transport":              "local-chat",
				"channelProfile":         "feishu",
				"channelId":              "feishu",
				"accountId":              "account-alpha",
				"conversationId":         "conv-alpha",
				"requesterOuId":          "ou_alpha",
				"approverOuIds":          []string{"ou_owner"},
				"resolvedApproverOuId":   "ou_owner",
				"requestFingerprintHash": "fingerprint-alpha",
				"module":                 "M2:protected_file_access",
				"riskLevel":              "L3",
				"toolName":               "exec",
				"scopeType":              "singleTool",
				"requestedAtMs":          parityBaseTimeMs - 1100,
				"expiresAtMs":            parityBaseTimeMs + 60000,
				"resolvedAtMs":           parityBaseTimeMs - 950,
				"resolution":             "allow-once",
				"promptExcerpt":          "Need approval before exec.",
				"auditSummaryJson":       map[string]any{"reason": "protected file access"},
				"metadataJson":           map[string]any{"source": "fixture"},
			},
		},
		map[string]any{
			"kind":         "lynxCheckUpsert",
			"itemId":       "lynx-check-item",
			"occurredAtMs": parityBaseTimeMs - 1800,
			"data": map[string]any{
				"requestId":           "lynx-check-alpha",
				"source":              "manual",
				"trigger":             "lynx_command",
				"preferredTargetKind": "current",
				"sessionKey":          "session-beta",
				"targetKey":           "feishu:group-chat:conv-beta",
				"channelId":           "group-chat",
				"messageProvider":     "feishu",
				"status":              "completed",
				"sendAttempted":       true,
				"sendSucceeded":       true,
				"transport":           "feishu",
				"reportPath":          "/tmp/report.md",
				"createdAtMs":         parityBaseTimeMs - 2000,
				"completedAtMs":       parityBaseTimeMs - 1800,
			},
		},
		map[string]any{
			"kind":         "tokenUsage",
			"itemId":       "token-usage-primary-item",
			"occurredAtMs": parityBaseTimeMs - 800,
			"data": map[string]any{
				"usageEventId":       "usage-primary",
				"sessionKey":         "session-alpha",
				"runId":              "run-alpha",
				"agentId":            "agent-main",
				"provider":           "openai",
				"model":              "openclaw/main",
				"inputTokens":        200,
				"outputTokens":       100,
				"cacheReadTokens":    10,
				"cacheWriteTokens":   5,
				"totalTokens":        315,
				"assistantTextCount": 1,
			},
		},
		map[string]any{
			"kind":         "tokenUsage",
			"itemId":       "token-usage-secondary-item",
			"occurredAtMs": parityBaseTimeMs - 600,
			"data": map[string]any{
				"usageEventId":       "usage-secondary",
				"sessionKey":         "session-beta",
				"runId":              "run-beta",
				"agentId":            "agent-main",
				"provider":           "openai",
				"model":              "openclaw/default",
				"inputTokens":        80,
				"outputTokens":       40,
				"cacheReadTokens":    0,
				"cacheWriteTokens":   0,
				"totalTokens":        120,
				"assistantTextCount": 1,
				"isEstimated":        true,
			},
		},
	}
}
