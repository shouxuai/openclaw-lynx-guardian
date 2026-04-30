package backend_test

import (
	"net/http"
	"testing"
)

func TestSecurityEventsListIncludesInputToolOutput(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	items := []any{
		securityQARecordFixture("qa-security"),
		securityToolCallFixture("qa-security", "tool-security", "exec", "L4", "block"),
		securityAuditEventFixture("event-security-tool", "qa-security", "tool-security", "tool", "before_tool_call", "tool_call_evaluated", "L4", "block"),
	}
	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("security-events-qa", items), true)
	seedBody := decodeObjectStatus(t, seed, http.StatusOK)
	expectNumber(t, seedBody, "acceptedCount", len(items))
	expectNumber(t, seedBody, "rejectedCount", 0)

	page := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/security-events?pageNum=1&pageSize=20", nil, false), http.StatusOK)
	expectNumber(t, page, "total", 3)

	itemsByKind := securityEventsByKind(t, page)
	expectString(t, itemsByKind["input"], "eventKind", "input")
	expectString(t, itemsByKind["input"], "processKind", "conversation")
	expectString(t, itemsByKind["input"], "riskLevel", "L0")
	expectString(t, itemsByKind["input"], "enforcementAction", "allow")
	expectNumber(t, itemsByKind["input"], "occurredAtMs", int(parityBaseTimeMs-3000))

	expectString(t, itemsByKind["tool"], "eventKind", "tool")
	expectString(t, itemsByKind["tool"], "processKind", "conversation")
	expectString(t, itemsByKind["tool"], "riskLevel", "L4")
	expectString(t, itemsByKind["tool"], "enforcementAction", "block")
	expectString(t, itemsByKind["tool"], "toolCallId", "tool-security")

	expectString(t, itemsByKind["output"], "eventKind", "output")
	expectString(t, itemsByKind["output"], "processKind", "conversation")
	expectString(t, itemsByKind["output"], "riskLevel", "L0")
	expectString(t, itemsByKind["output"], "enforcementAction", "allow")
}

func TestSecurityEventsEveryEventHasRiskLevel(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	items := []any{
		securityQARecordFixture("qa-risk-default"),
		securityToolCallFixture("qa-risk-default", "tool-risk-default", "read", "", "allow"),
		securityLynxCheckFixture("lynx-risk-default"),
	}
	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("security-risk-defaults", items), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	page := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/security-events?pageNum=1&pageSize=20", nil, false), http.StatusOK)
	rawItems := securityEventItems(t, page)
	if len(rawItems) == 0 {
		t.Fatalf("expected security events")
	}
	for _, item := range rawItems {
		if got, _ := item["riskLevel"].(string); got == "" {
			t.Fatalf("expected non-empty riskLevel in %#v", item)
		}
		if got, _ := item["enforcementAction"].(string); got == "" {
			t.Fatalf("expected non-empty enforcementAction in %#v", item)
		}
	}
}

func TestSecurityEventsInstallEventUsesInstallDecision(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	install := securityAuditEventFixture("event-install-skill", "", "", "decision", "before_install", "install", "L3", "requireApproval")
	data := install["data"].(map[string]any)
	data["requestId"] = "install-request-1"
	data["title"] = "Skill 安装检查"
	data["contentExcerpt"] = "安装 skill: repo/test-skill"
	data["payloadJson"] = map[string]any{"targetUri": "skill://repo/test-skill", "installType": "skill"}
	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("security-install", []any{install}), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	page := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/security-events?eventKind=install&pageNum=1&pageSize=20", nil, false), http.StatusOK)
	expectNumber(t, page, "total", 1)
	item := securityEventItems(t, page)[0]
	expectString(t, item, "eventKind", "install")
	expectString(t, item, "processKind", "skill_install")
	expectString(t, item, "riskLevel", "L3")
	expectString(t, item, "enforcementAction", "requireApproval")
	expectString(t, item, "processId", "install-request-1")
}

func TestSecurityEventsLynxCheckProcessEvent(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("security-lynx-check", []any{securityLynxCheckFixture("lynx-process-1")}), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	page := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/security-events?eventKind=process&pageNum=1&pageSize=20", nil, false), http.StatusOK)
	expectNumber(t, page, "total", 1)
	item := securityEventItems(t, page)[0]
	expectString(t, item, "eventKind", "process")
	expectString(t, item, "processKind", "lynx_check")
	expectString(t, item, "riskLevel", "L0")
	expectString(t, item, "enforcementAction", "allow")
	expectString(t, item, "runId", "lynx-process-1")
}

func TestSecurityEventsTimeIsTopLevelField(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("security-time", []any{securityQARecordFixture("qa-time")}), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	page := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, "/lynx/security-events?pageNum=1&pageSize=20", nil, false), http.StatusOK)
	for _, item := range securityEventItems(t, page) {
		if _, ok := item["occurredAtMs"].(float64); !ok {
			t.Fatalf("expected top-level occurredAtMs in %#v", item)
		}
	}
}

func securityQARecordFixture(qaRecordID string) map[string]any {
	return map[string]any{
		"kind":         "qaRecordUpsert",
		"itemId":       qaRecordID + "-item",
		"occurredAtMs": parityBaseTimeMs - 3000,
		"data": map[string]any{
			"qaRecordId":         qaRecordID,
			"sessionKey":         "session-security",
			"runId":              "run-" + qaRecordID,
			"agentId":            "agent-main",
			"userPromptExcerpt":  "请检查当前项目",
			"userPromptHash":     "prompt-" + qaRecordID,
			"finalAnswerExcerpt": "检查完成",
			"finalAnswerHash":    "answer-" + qaRecordID,
			"status":             "completed",
			"riskLevel":          "L0",
			"riskScore":          0,
			"toolCallCount":      1,
			"approvalCount":      0,
			"detectionCount":     0,
			"totalTokens":        30,
			"startedAtMs":        parityBaseTimeMs - 3000,
			"completedAtMs":      parityBaseTimeMs - 1000,
			"linkOrigin":         "runtime",
		},
	}
}

func securityToolCallFixture(qaRecordID, toolCallID, toolName, riskLevel, enforcementAction string) map[string]any {
	data := map[string]any{
		"toolCallId":        toolCallID,
		"qaRecordId":        qaRecordID,
		"sessionKey":        "session-security",
		"runId":             "run-" + qaRecordID,
		"toolName":          toolName,
		"paramSummary":      "command=Remove-Item -Recurse C:\\important",
		"paramHash":         "hash-" + toolCallID,
		"policyDecision":    "deny",
		"enforcementAction": enforcementAction,
		"startedAtMs":       parityBaseTimeMs - 2200,
		"finishedAtMs":      parityBaseTimeMs - 2100,
		"durationMs":        100,
		"resultStatus":      "blocked",
		"resultExcerpt":     "blocked by policy",
		"metadataJson": map[string]any{
			"command":  "Remove-Item -Recurse C:\\important",
			"cwd":      "C:\\work\\repo",
			"exitCode": 1,
			"stderr":   "blocked",
		},
	}
	if riskLevel != "" {
		data["riskLevel"] = riskLevel
		data["riskScore"] = 10
	}
	return map[string]any{
		"kind":         "toolCallUpsert",
		"itemId":       toolCallID + "-item",
		"occurredAtMs": parityBaseTimeMs - 2200,
		"data":         data,
	}
}

func securityAuditEventFixture(eventID, qaRecordID, toolCallID, category, hookName, eventType, riskLevel, enforcementAction string) map[string]any {
	data := map[string]any{
		"eventId":           eventID,
		"sessionKey":        "session-security",
		"runId":             "run-" + qaRecordID,
		"sourceKind":        "plugin_hook",
		"hookName":          hookName,
		"eventType":         eventType,
		"category":          category,
		"direction":         "internal",
		"policyDecision":    "deny",
		"enforcementAction": enforcementAction,
		"title":             "Security decision",
		"summary":           "Security decision summary.",
		"contentExcerpt":    "decision content",
	}
	if qaRecordID != "" {
		data["qaRecordId"] = qaRecordID
	}
	if toolCallID != "" {
		data["toolCallId"] = toolCallID
	}
	if riskLevel != "" {
		data["riskLevel"] = riskLevel
		data["riskScore"] = 10
	}
	return map[string]any{
		"kind":         "auditEvent",
		"itemId":       eventID + "-item",
		"occurredAtMs": parityBaseTimeMs - 2200,
		"data":         data,
	}
}

func securityLynxCheckFixture(requestID string) map[string]any {
	return map[string]any{
		"kind":         "lynxCheckUpsert",
		"itemId":       requestID + "-item",
		"occurredAtMs": parityBaseTimeMs - 1800,
		"data": map[string]any{
			"requestId":           requestID,
			"source":              "manual",
			"trigger":             "lynx_command",
			"preferredTargetKind": "current",
			"sessionKey":          "session-security",
			"targetKey":           "current",
			"status":              "completed",
			"sendAttempted":       true,
			"sendSucceeded":       true,
			"transport":           "local",
			"reportPath":          "/tmp/report.md",
			"createdAtMs":         parityBaseTimeMs - 1800,
			"completedAtMs":       parityBaseTimeMs - 1600,
		},
	}
}

func securityEventsByKind(t *testing.T, payload map[string]any) map[string]map[string]any {
	t.Helper()
	out := map[string]map[string]any{}
	for _, item := range securityEventItems(t, payload) {
		kind, _ := item["eventKind"].(string)
		if kind != "" {
			out[kind] = item
		}
	}
	for _, kind := range []string{"input", "tool", "output"} {
		if _, ok := out[kind]; !ok {
			t.Fatalf("expected security event kind %s in %#v", kind, payload["items"])
		}
	}
	return out
}

func securityEventItems(t *testing.T, payload map[string]any) []map[string]any {
	t.Helper()
	rawItems, ok := payload["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %#v", payload["items"])
	}
	items := make([]map[string]any, 0, len(rawItems))
	for index, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("expected item %d object, got %T", index, raw)
		}
		items = append(items, item)
	}
	return items
}
