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
