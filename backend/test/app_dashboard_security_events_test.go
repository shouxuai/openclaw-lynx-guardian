package backend_test

import (
	"fmt"
	"net/http"
	"testing"
)

func TestDashboardRiskDistributionUsesSecurityEvents(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	items := []any{
		securityQARecordFixture("qa-dashboard"),
		securityToolCallFixture("qa-dashboard", "tool-dashboard", "exec", "L4", "block"),
		securityAuditEventFixture("event-dashboard-tool", "qa-dashboard", "tool-dashboard", "tool", "before_tool_call", "tool_call_evaluated", "L4", "block"),
	}
	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("dashboard-security-events", items), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	path := fmt.Sprintf("/lynx/dashboard/overview?fromMs=%d&toMs=%d", parityBaseTimeMs-5000, parityBaseTimeMs)
	body := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, path, nil, false), http.StatusOK)
	totals, ok := body["totals"].(map[string]any)
	if !ok {
		t.Fatalf("expected dashboard totals object")
	}
	expectNumber(t, totals, "eventCount", 3)
	if _, ok := totals["highRiskEventCount"]; ok {
		t.Fatalf("dashboard overview should expose independent L0-L4 buckets instead of a combined highRiskEventCount")
	}
	if _, ok := totals["rawAuditEventCount"]; ok {
		t.Fatalf("dashboard overview should not expose rawAuditEventCount to the frontend")
	}

	riskDistribution, ok := body["riskDistribution"].([]any)
	if !ok {
		t.Fatalf("expected dashboard riskDistribution array")
	}
	expectRiskBucketCount(t, riskDistribution, "L0", 2)
	expectRiskBucketCount(t, riskDistribution, "L4", 1)
	expectRiskBucketTotal(t, riskDistribution, 3)

	recentEvents, ok := body["recentSecurityEvents"].([]any)
	if !ok {
		t.Fatalf("expected dashboard recentSecurityEvents array")
	}
	if len(recentEvents) != 3 {
		t.Fatalf("expected 3 recent security events, got %d in %#v", len(recentEvents), recentEvents)
	}
	latest, ok := recentEvents[0].(map[string]any)
	if !ok {
		t.Fatalf("expected latest recent security event object, got %T", recentEvents[0])
	}
	expectString(t, latest, "eventKind", "output")
	expectString(t, latest, "riskLevel", "L0")
	if _, ok := body["recentHighRiskEvents"]; ok {
		t.Fatalf("dashboard overview should expose recentSecurityEvents instead of recentHighRiskEvents")
	}
}

func TestDashboardOverviewReturnsRecentQARecords(t *testing.T) {
	handler, closer := buildParityHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	items := make([]any, 0, 7)
	for index := 0; index < 6; index++ {
		record := qaRecordFixture(fmt.Sprintf("qa-dashboard-recent-%d", index))
		startedAtMs := parityBaseTimeMs - int64(index+1)*100
		setQARecordTimes(record, startedAtMs, startedAtMs+50)
		data := record["data"].(map[string]any)
		data["userPromptExcerpt"] = fmt.Sprintf("dashboard prompt %d", index)
		data["toolCallCount"] = index + 1
		items = append(items, record)
	}

	outOfRange := qaRecordFixture("qa-dashboard-out-of-range")
	setQARecordTimes(outOfRange, parityBaseTimeMs-10_000, parityBaseTimeMs-9_900)
	items = append(items, outOfRange)

	seed := doJSON(t, handler, http.MethodPost, "/lynx/internal/v1/ingest/batch", fixtureBatchWithItems("dashboard-qa-records", items), true)
	decodeObjectStatus(t, seed, http.StatusOK)

	path := fmt.Sprintf("/lynx/dashboard/overview?fromMs=%d&toMs=%d", parityBaseTimeMs-1_000, parityBaseTimeMs)
	body := decodeObjectStatus(t, doJSON(t, handler, http.MethodGet, path, nil, false), http.StatusOK)
	recentRecords, ok := body["recentQaRecords"].([]any)
	if !ok {
		t.Fatalf("expected dashboard recentQaRecords array")
	}
	if len(recentRecords) != 5 {
		t.Fatalf("expected dashboard to return five recent QA records, got %d in %#v", len(recentRecords), recentRecords)
	}

	latest, ok := recentRecords[0].(map[string]any)
	if !ok {
		t.Fatalf("expected latest recent QA record object, got %T", recentRecords[0])
	}
	expectString(t, latest, "qaRecordId", "qa-dashboard-recent-0")
	expectString(t, latest, "userPromptExcerpt", "dashboard prompt 0")
	expectString(t, latest, "status", "completed")
	expectString(t, latest, "riskLevel", "L2")
	expectNumber(t, latest, "toolCallCount", 1)
	expectNumber(t, latest, "startedAtMs", int(parityBaseTimeMs-100))

	oldestVisible, ok := recentRecords[4].(map[string]any)
	if !ok {
		t.Fatalf("expected fifth recent QA record object, got %T", recentRecords[4])
	}
	expectString(t, oldestVisible, "qaRecordId", "qa-dashboard-recent-4")
}
