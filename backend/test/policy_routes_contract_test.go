package backend_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/openclaw/lynx-guardian/backend/internal/db"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
	_ "modernc.org/sqlite"
)

func TestPolicyMigrationCreatesPolicyTables(t *testing.T) {
	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	for _, table := range []string{"policy_rules", "protected_resources", "policy_versions", "script_findings", "script_taints"} {
		var name string
		err := database.QueryRowContext(context.Background(), "SELECT name FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&name)
		if err != nil {
			t.Fatalf("expected table %s: %v", table, err)
		}
	}

	repository := repo.NewPolicyRepository(database)
	version, err := repository.CreatePolicyVersion(context.Background(), "test", "initial policy")
	if err != nil {
		t.Fatalf("create policy version: %v", err)
	}
	if version.Version <= 0 {
		t.Fatalf("expected positive version, got %d", version.Version)
	}
}

func TestPolicyRoutesManageProtectedResourcesAndRules(t *testing.T) {
	router, closer := buildTestHandler(t)
	defer closer()

	protectedResource := policyPostJSON(t, router, "/lynx/protected-resources", map[string]any{
		"path":          "C:\\Users\\alice\\Secrets",
		"preset":        "read_only",
		"enabled":       true,
		"actorId":       "alice",
		"changeSummary": "protect local secrets",
	})
	if protectedResource.Code != http.StatusOK {
		t.Fatalf("create protected resource status=%d body=%s", protectedResource.Code, protectedResource.Body.String())
	}

	rule := policyPostJSON(t, router, "/lynx/policy-rules", map[string]any{
		"kind":          "blacklist",
		"scope":         "script",
		"patternType":   "literal",
		"pattern":       "Invoke-Expression",
		"riskDelta":     70,
		"enabled":       true,
		"actorId":       "alice",
		"changeSummary": "flag powershell dynamic execution",
	})
	if rule.Code != http.StatusOK {
		t.Fatalf("create policy rule status=%d body=%s", rule.Code, rule.Body.String())
	}

	overview := policyGetJSON(t, router, "/lynx/policies")
	if overview.Code != http.StatusOK {
		t.Fatalf("policy overview status=%d body=%s", overview.Code, overview.Body.String())
	}
	if !policyBodyContains(overview.Body.String(), "read_only") || !policyBodyContains(overview.Body.String(), "Invoke-Expression") {
		t.Fatalf("overview missing created policy items: %s", overview.Body.String())
	}
}

func TestPolicyRoutesUpdateExistingProtectedResourceAndRuleById(t *testing.T) {
	router, closer := buildTestHandler(t)
	defer closer()

	protectedResource := policyPostJSON(t, router, "/lynx/protected-resources", map[string]any{
		"path":          "C:\\Users\\alice\\Secrets",
		"preset":        "read_only",
		"enabled":       true,
		"actorId":       "alice",
		"changeSummary": "protect local secrets",
	})
	if protectedResource.Code != http.StatusOK {
		t.Fatalf("create protected resource status=%d body=%s", protectedResource.Code, protectedResource.Body.String())
	}
	var createdResource struct {
		ResourceID string `json:"resourceId"`
	}
	if err := json.Unmarshal(protectedResource.Body.Bytes(), &createdResource); err != nil {
		t.Fatalf("decode protected resource: %v", err)
	}

	updatedResource := policyPostJSON(t, router, "/lynx/protected-resources", map[string]any{
		"resourceId":    createdResource.ResourceID,
		"path":          "C:\\Users\\alice\\Secrets2",
		"preset":        "no_modify",
		"enabled":       true,
		"actorId":       "alice",
		"changeSummary": "tighten local secrets",
	})
	if updatedResource.Code != http.StatusOK {
		t.Fatalf("update protected resource status=%d body=%s", updatedResource.Code, updatedResource.Body.String())
	}

	rule := policyPostJSON(t, router, "/lynx/policy-rules", map[string]any{
		"kind":          "blacklist",
		"scope":         "script",
		"patternType":   "literal",
		"pattern":       "Invoke-Expression",
		"riskDelta":     70,
		"enabled":       true,
		"actorId":       "alice",
		"changeSummary": "flag powershell dynamic execution",
	})
	if rule.Code != http.StatusOK {
		t.Fatalf("create policy rule status=%d body=%s", rule.Code, rule.Body.String())
	}
	var createdRule struct {
		RuleID string `json:"ruleId"`
	}
	if err := json.Unmarshal(rule.Body.Bytes(), &createdRule); err != nil {
		t.Fatalf("decode policy rule: %v", err)
	}

	updatedRule := policyPostJSON(t, router, "/lynx/policy-rules", map[string]any{
		"ruleId":        createdRule.RuleID,
		"kind":          "blacklist",
		"scope":         "script",
		"patternType":   "literal",
		"pattern":       "Invoke-Expression downloaded payload",
		"riskDelta":     70,
		"enabled":       true,
		"actorId":       "alice",
		"changeSummary": "tighten powershell dynamic execution",
	})
	if updatedRule.Code != http.StatusOK {
		t.Fatalf("update policy rule status=%d body=%s", updatedRule.Code, updatedRule.Body.String())
	}

	overview := policyGetJSON(t, router, "/lynx/policies")
	if overview.Code != http.StatusOK {
		t.Fatalf("policy overview status=%d body=%s", overview.Code, overview.Body.String())
	}
	body := overview.Body.String()
	if !policyBodyContains(body, "Secrets2") || !policyBodyContains(body, "no_modify") {
		t.Fatalf("overview missing updated protected resource: %s", body)
	}
	if policyBodyContains(body, "C:\\\\Users\\\\alice\\\\Secrets\"") {
		t.Fatalf("overview kept old protected resource path after id update: %s", body)
	}
	if !policyBodyContains(body, "Invoke-Expression downloaded payload") {
		t.Fatalf("overview missing updated policy rule: %s", body)
	}
}

func policyPostJSON(t *testing.T, router http.Handler, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(data))
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	return recorder
}

func policyGetJSON(t *testing.T, router http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.RemoteAddr = "127.0.0.1:12345"
	router.ServeHTTP(recorder, request)
	return recorder
}

func policyBodyContains(body string, needle string) bool {
	return strings.Contains(body, needle)
}
