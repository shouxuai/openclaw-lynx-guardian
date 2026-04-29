package backend_test

import (
	"net/http"
	"testing"
)

func TestQaRecordRoutesReturnListAndToolChainDetail(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	items := []any{
		qaRecordFixture("qa-alpha"),
		qaAuditEventFixture("qa-alpha"),
		qaToolCallFixture("qa-alpha"),
		qaApprovalFixture("qa-alpha"),
		qaTokenUsageFixture("qa-alpha"),
	}
	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("qa-record-contract", items), true)
	seedBody := decodeObjectStatus(t, seed, http.StatusOK)
	expectNumber(t, seedBody, "acceptedCount", len(items))
	expectNumber(t, seedBody, "rejectedCount", 0)

	list := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/qa-records?pageNum=1&pageSize=20", nil, false), http.StatusOK)
	expectNumber(t, list, "total", 1)
	expectNumber(t, list, "pageNum", 1)
	expectNumber(t, list, "pageSize", 20)
	itemsRaw, ok := list["items"].([]any)
	if !ok || len(itemsRaw) != 1 {
		t.Fatalf("expected one qa record list item, got %#v", list["items"])
	}
	listItem, ok := itemsRaw[0].(map[string]any)
	if !ok {
		t.Fatalf("expected qa list item object, got %T", itemsRaw[0])
	}
	expectString(t, listItem, "qaRecordId", "qa-alpha")
	expectString(t, listItem, "userPromptExcerpt", "请检查当前工程状态")
	expectNumber(t, listItem, "toolCallCount", 1)
	expectNumber(t, listItem, "approvalCount", 1)
	expectNumber(t, listItem, "totalTokens", 42)

	detail := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/qa-records/qa-alpha", nil, false), http.StatusOK)
	expectString(t, detail, "qaRecordId", "qa-alpha")
	expectString(t, detail, "finalAnswerExcerpt", "已完成检查")
	assertChainContainsNodeTypes(t, detail, []string{"userPrompt", "toolCall", "approval", "auditEvent", "tokenUsage", "finalAnswer"})
	if edges, ok := detail["chainEdges"].([]any); !ok || len(edges) == 0 {
		t.Fatalf("expected non-empty chainEdges, got %#v", detail["chainEdges"])
	}
}

func TestQaRecordKindSpecificIngestEndpointAcceptsQaRecordUpserts(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	seed := doJSON(
		t,
		handler,
		http.MethodPost,
		"/lynx/internal/v1/ingest/qa-records",
		fixtureBatchWithItems("qa-record-kind-specific", []any{qaRecordFixture("qa-kind-specific")}),
		true,
	)
	seedBody := decodeObjectStatus(t, seed, http.StatusOK)
	expectNumber(t, seedBody, "acceptedCount", 1)
	expectNumber(t, seedBody, "rejectedCount", 0)

	detail := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/qa-records/qa-kind-specific", nil, false), http.StatusOK)
	expectString(t, detail, "qaRecordId", "qa-kind-specific")
}

func TestQaRecordDetailUsesTerminalNodeWhenToolCallHasCommandDetail(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	items := []any{
		qaRecordFixture("qa-terminal"),
		qaTerminalToolCallFixture("qa-terminal"),
	}
	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("qa-terminal-contract", items), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	detail := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/qa-records/qa-terminal", nil, false), http.StatusOK)
	node := findChainNodeByType(t, detail, "terminal")
	expectString(t, node, "title", "终端命令")

	detailJSON, ok := node["detailJson"].(map[string]any)
	if !ok {
		t.Fatalf("expected terminal detailJson object, got %#v", node["detailJson"])
	}
	expectString(t, detailJSON, "command", "npm test")
	expectString(t, detailJSON, "cwd", "C:\\work\\repo")
	expectString(t, detailJSON, "stdout", "PASS")
	expectString(t, detailJSON, "stderr", "")
	expectNumber(t, detailJSON, "exitCode", 0)
	expectNumber(t, detailJSON, "durationMs", 1234)
}

func qaRecordFixture(qaRecordID string) map[string]any {
	return map[string]any{
		"kind":         "qaRecordUpsert",
		"itemId":       qaRecordID + "-item",
		"occurredAtMs": parityBaseTimeMs - 1000,
		"data": map[string]any{
			"qaRecordId":         qaRecordID,
			"sessionKey":         "session-qa",
			"runId":              "run-qa",
			"agentId":            "agent-main",
			"userPromptExcerpt":  "请检查当前工程状态",
			"userPromptHash":     "prompt-hash",
			"finalAnswerExcerpt": "已完成检查",
			"finalAnswerHash":    "answer-hash",
			"status":             "completed",
			"riskLevel":          "L2",
			"riskScore":          6,
			"toolCallCount":      1,
			"approvalCount":      1,
			"detectionCount":     0,
			"totalTokens":        42,
			"startedAtMs":        parityBaseTimeMs - 1000,
			"completedAtMs":      parityBaseTimeMs - 100,
			"linkOrigin":         "runtime",
			"payloadJson":        map[string]any{"source": "test"},
		},
	}
}

func qaAuditEventFixture(qaRecordID string) map[string]any {
	event := fixtureItems()[3].(map[string]any)
	data := cloneMap(event["data"].(map[string]any))
	data["eventId"] = "event-qa"
	data["qaRecordId"] = qaRecordID
	event["itemId"] = "event-qa-item"
	event["data"] = data
	return event
}

func qaToolCallFixture(qaRecordID string) map[string]any {
	toolCall := fixtureItems()[5].(map[string]any)
	data := cloneMap(toolCall["data"].(map[string]any))
	data["toolCallId"] = "tool-call-qa"
	data["qaRecordId"] = qaRecordID
	toolCall["itemId"] = "tool-call-qa-item"
	toolCall["data"] = data
	return toolCall
}

func qaTerminalToolCallFixture(qaRecordID string) map[string]any {
	toolCall := qaToolCallFixture(qaRecordID)
	data := toolCall["data"].(map[string]any)
	data["toolCallId"] = "tool-call-terminal"
	data["toolName"] = "exec"
	data["paramSummary"] = "command=npm test"
	data["metadataJson"] = map[string]any{
		"command":    "npm test",
		"cwd":        "C:\\work\\repo",
		"args":       []string{"test"},
		"envSummary": map[string]any{"NODE_ENV": "test"},
		"exitCode":   0,
		"durationMs": 1234,
		"stdout":     "PASS",
		"stderr":     "",
	}
	return toolCall
}

func qaApprovalFixture(qaRecordID string) map[string]any {
	approval := fixtureItems()[7].(map[string]any)
	data := cloneMap(approval["data"].(map[string]any))
	data["approvalId"] = "approval-qa"
	data["qaRecordId"] = qaRecordID
	approval["itemId"] = "approval-qa-item"
	approval["data"] = data
	return approval
}

func qaTokenUsageFixture(qaRecordID string) map[string]any {
	usage := tokenUsageFixture("usage-qa", "actual", 42, false, parityBaseTimeMs-50)
	usage["data"].(map[string]any)["qaRecordId"] = qaRecordID
	return usage
}

func assertChainContainsNodeTypes(t *testing.T, detail map[string]any, want []string) {
	t.Helper()
	rawNodes, ok := detail["chainNodes"].([]any)
	if !ok {
		t.Fatalf("expected chainNodes array, got %#v", detail["chainNodes"])
	}
	seen := map[string]bool{}
	for _, raw := range rawNodes {
		node, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("expected chain node object, got %T", raw)
		}
		if nodeType, _ := node["type"].(string); nodeType != "" {
			seen[nodeType] = true
		}
	}
	for _, nodeType := range want {
		if !seen[nodeType] {
			t.Fatalf("expected chain node type %s in %#v", nodeType, rawNodes)
		}
	}
}

func findChainNodeByType(t *testing.T, detail map[string]any, nodeType string) map[string]any {
	t.Helper()
	rawNodes, ok := detail["chainNodes"].([]any)
	if !ok {
		t.Fatalf("expected chainNodes array, got %#v", detail["chainNodes"])
	}
	for _, raw := range rawNodes {
		node, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("expected chain node object, got %T", raw)
		}
		if got, _ := node["type"].(string); got == nodeType {
			return node
		}
	}
	t.Fatalf("missing chain node type %s in %#v", nodeType, rawNodes)
	return nil
}

func cloneMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}
