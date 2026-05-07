package backend_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/db"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
	"github.com/openclaw/lynx-guardian/backend/internal/routes"
	"github.com/openclaw/lynx-guardian/backend/internal/skills"
	_ "modernc.org/sqlite"
)

func TestSkillInstallDecisionDeniesMaliciousSource(t *testing.T) {
	router, _ := setupDecisionRouter(t)

	response := postDecision(t, router, "/lynx/internal/v1/decision/install", api.DecisionRequest{
		RequestID: "install-malicious-1",
		Stage:     "install",
		Hook:      "before_install",
		Content:   "install skill from https://raw.githubusercontent.com/evil/keylogger-skill/main/SKILL.md",
		TargetURI: "https://raw.githubusercontent.com/evil/keylogger-skill/main/SKILL.md",
		ToolArgs: map[string]any{
			"source": "https://raw.githubusercontent.com/evil/keylogger-skill/main/SKILL.md",
			"name":   "keylogger-skill",
		},
		CreatedAt: "2026-04-28T00:00:00Z",
	})

	if response.RiskLevel != "L4" || response.Action != "deny" || !response.Block {
		t.Fatalf("expected malicious install source to be denied, got risk=%s action=%s block=%v", response.RiskLevel, response.Action, response.Block)
	}
}

func TestSkillInventorySyncUpdatesCurrentHash(t *testing.T) {
	router := setupSkillRouter(t)

	postSkillJSON(t, router, http.MethodPost, "/lynx/internal/v1/skills/inventory/sync", map[string]any{
		"items": []map[string]any{
			{
				"skillId":       "skill-safe",
				"name":          "Safe Skill",
				"source":        "local",
				"installPath":   "C:/Users/example/.openclaw/skills/safe",
				"manifestPath":  "C:/Users/example/.openclaw/skills/safe/SKILL.md",
				"hashAlgorithm": "sha256",
				"baselineHash":  "hash-a",
				"currentHash":   "hash-a",
				"trustState":    "trusted",
				"lastSeenAt":    "2026-04-28T00:00:00Z",
			},
		},
	})

	postSkillJSON(t, router, http.MethodPost, "/lynx/internal/v1/skills/inventory/sync", map[string]any{
		"items": []map[string]any{
			{
				"skillId":       "skill-safe",
				"name":          "Safe Skill",
				"source":        "local",
				"installPath":   "C:/Users/example/.openclaw/skills/safe",
				"manifestPath":  "C:/Users/example/.openclaw/skills/safe/SKILL.md",
				"hashAlgorithm": "sha256",
				"baselineHash":  "hash-a",
				"currentHash":   "hash-b",
				"trustState":    "trusted",
				"lastSeenAt":    "2026-04-28T00:01:00Z",
			},
		},
	})

	detail := getSkillJSON(t, router, "/lynx/skills/skill-safe")
	assertSkillField(t, detail, "currentHash", "hash-b")
	assertSkillField(t, detail, "baselineHash", "hash-a")
}

func TestSkillHashMismatchCreatesFinding(t *testing.T) {
	router := setupSkillRouter(t)

	postSkillJSON(t, router, http.MethodPost, "/lynx/internal/v1/skills/inventory/sync", map[string]any{
		"items": []map[string]any{
			{
				"skillId":       "skill-drift",
				"name":          "Drift Skill",
				"source":        "local",
				"installPath":   "C:/Users/example/.openclaw/skills/drift",
				"manifestPath":  "C:/Users/example/.openclaw/skills/drift/SKILL.md",
				"hashAlgorithm": "sha256",
				"baselineHash":  "baseline-hash",
				"currentHash":   "changed-hash",
				"trustState":    "trusted",
				"lastSeenAt":    "2026-04-28T00:00:00Z",
			},
		},
	})

	detail := getSkillJSON(t, router, "/lynx/skills/skill-drift")
	findings, ok := detail["findings"].([]any)
	if !ok || len(findings) == 0 {
		t.Fatalf("expected hash mismatch finding, got %#v", detail["findings"])
	}
	first, ok := findings[0].(map[string]any)
	if !ok {
		t.Fatalf("expected finding object, got %#v", findings[0])
	}
	assertSkillField(t, first, "ruleId", "hash_mismatch")
}

func TestSkillInventoryListDoesNotBlockWhileLoadingFindings(t *testing.T) {
	router := setupSkillRouter(t)

	postSkillJSON(t, router, http.MethodPost, "/lynx/internal/v1/skills/inventory/sync", map[string]any{
		"items": []map[string]any{
			{
				"skillId":       "skill-list-drift",
				"name":          "List Drift Skill",
				"source":        "local",
				"installPath":   "C:/Users/example/.openclaw/skills/list-drift",
				"manifestPath":  "C:/Users/example/.openclaw/skills/list-drift/SKILL.md",
				"hashAlgorithm": "sha256",
				"baselineHash":  "baseline-hash",
				"currentHash":   "changed-hash",
				"trustState":    "trusted",
				"lastSeenAt":    "2026-04-28T00:00:00Z",
			},
		},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/lynx/skills", nil).WithContext(ctx)
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d for list: %s", recorder.Code, recorder.Body.String())
	}
	page := decodeSkillJSON(t, recorder)
	items, ok := page["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected one skill list item, got %#v", page["items"])
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected skill object, got %#v", items[0])
	}
	findings, ok := item["findings"].([]any)
	if !ok || len(findings) == 0 {
		t.Fatalf("expected list item findings, got %#v", item["findings"])
	}
}

func TestSkillInventoryListPaginatesAndReturnsSourceBreakdown(t *testing.T) {
	router := setupSkillRouter(t)

	postSkillJSON(t, router, http.MethodPost, "/lynx/internal/v1/skills/inventory/sync", map[string]any{
		"items": []map[string]any{
			newSkillInventoryTestItem("skill-native-bundled", "Native Bundled", "openclaw-bundled", "2026-04-28T00:03:00Z"),
			newSkillInventoryTestItem("skill-extension", "Extension Skill", "openclaw-extension", "2026-04-28T00:02:00Z"),
			newSkillInventoryTestItem("skill-local", "Local Skill", "local", "2026-04-28T00:01:00Z"),
		},
	})

	firstPage := getSkillJSON(t, router, "/lynx/skills?pageNum=1&pageSize=2")
	items, ok := firstPage["items"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("expected two first-page skills, got %#v", firstPage["items"])
	}
	assertSkillField(t, firstPage, "total", float64(3))
	assertSkillField(t, firstPage, "pageNum", float64(1))
	assertSkillField(t, firstPage, "pageSize", float64(2))
	assertSkillField(t, firstPage, "totalPages", float64(2))
	assertSourceBreakdownCount(t, firstPage, "openclaw-bundled", 1)
	assertSourceBreakdownCount(t, firstPage, "openclaw-extension", 1)
	assertSourceBreakdownCount(t, firstPage, "local", 1)

	secondPage := getSkillJSON(t, router, "/lynx/skills?pageNum=2&pageSize=2")
	secondItems, ok := secondPage["items"].([]any)
	if !ok || len(secondItems) != 1 {
		t.Fatalf("expected one second-page skill, got %#v", secondPage["items"])
	}
}

func TestSkillInventoryListFiltersBySourceKind(t *testing.T) {
	router := setupSkillRouter(t)

	postSkillJSON(t, router, http.MethodPost, "/lynx/internal/v1/skills/inventory/sync", map[string]any{
		"items": []map[string]any{
			newSkillInventoryTestItem("skill-native-bundled", "Native Bundled", "openclaw-bundled", "2026-04-28T00:03:00Z"),
			newSkillInventoryTestItem("skill-extension", "Extension Skill", "openclaw-extension", "2026-04-28T00:02:00Z"),
			newSkillInventoryTestItem("skill-local", "Local Skill", "local", "2026-04-28T00:01:00Z"),
		},
	})

	page := getSkillJSON(t, router, "/lynx/skills?sourceKind=openclaw-extension&pageNum=1&pageSize=20")
	items, ok := page["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected one plugin extension skill, got %#v", page["items"])
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected skill object, got %#v", items[0])
	}
	assertSkillField(t, item, "skillId", "skill-extension")
	assertSkillField(t, page, "total", float64(1))
	assertSourceBreakdownCount(t, page, "openclaw-bundled", 1)
	assertSourceBreakdownCount(t, page, "openclaw-extension", 1)
	assertSourceBreakdownCount(t, page, "local", 1)
}

func TestRemoteSkillSecurityRoutesReturnDisabledDiagnostics(t *testing.T) {
	router := setupSkillRouter(t)

	blacklist := getSkillJSON(t, router, "/lynx/internal/v1/security/skill-blacklist")
	if blacklist["message"] != "remote safety disabled" {
		t.Fatalf("unexpected blacklist diagnostic: %#v", blacklist)
	}

	check := postSkillJSON(t, router, http.MethodPost, "/lynx/internal/v1/security/skill-check", map[string]any{
		"id":        "user-1",
		"skillName": "demo-skill",
		"skillHash": "hash",
	})
	result, ok := check["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected check result object, got %#v", check["result"])
	}
	if result["risk_level"] != float64(0) {
		t.Fatalf("expected disabled skill check risk_level=0, got %#v", result["risk_level"])
	}
}

func TestTokenSummaryAggregatesActualOnly(t *testing.T) {
	router, database := setupTokenRouter(t)

	insertTokenUsage(t, database, "actual-1", "actual", 120, false)
	insertTokenUsage(t, database, "estimated-1", "estimated", 1000, true)
	insertTokenUsage(t, database, "unavailable-1", "unavailable", 0, false)

	summary := getSkillJSON(t, router, "/lynx/tokens/summary")
	if summary["totalTokens"] != float64(120) {
		t.Fatalf("expected actual-only totalTokens=120, got %#v", summary["totalTokens"])
	}
	if summary["estimatedCount"] != float64(1) {
		t.Fatalf("expected estimatedCount=1, got %#v", summary["estimatedCount"])
	}
	if summary["unavailableCount"] != float64(1) {
		t.Fatalf("expected unavailableCount=1, got %#v", summary["unavailableCount"])
	}
}

func TestTokenUsageUnavailableKeepsZeroTokensAndSourceType(t *testing.T) {
	router, database := setupTokenRouter(t)

	insertTokenUsage(t, database, "unavailable-1", "unavailable", 0, false)

	page := getSkillJSON(t, router, "/lynx/tokens/usage?sourceType=unavailable")
	items, ok := page["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected one unavailable token row, got %#v", page["items"])
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected token row object, got %#v", items[0])
	}
	assertSkillField(t, item, "sourceType", "unavailable")
	if item["totalTokens"] != float64(0) {
		t.Fatalf("expected unavailable token row totalTokens=0, got %#v", item["totalTokens"])
	}
}

func setupSkillRouter(t *testing.T) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	database := openMigratedTestDB(t)
	repository := repo.NewSkillRepository(database)
	service := skills.NewService(repository)

	router := gin.New()
	query := router.Group("/lynx")
	internal := query.Group("/internal/v1")
	routes.RegisterSkills(query, internal, service, repository)
	return router
}

func setupTokenRouter(t *testing.T) (*gin.Engine, *sql.DB) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	database := openMigratedTestDB(t)
	router := gin.New()
	query := router.Group("/lynx")
	routes.RegisterTokens(query, repo.NewTokensRepository(database))
	return router, database
}

func openMigratedTestDB(t *testing.T) *sql.DB {
	t.Helper()

	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	database.SetMaxOpenConns(1)
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return database
}

func postSkillJSON(t *testing.T, router http.Handler, method string, path string, body any) map[string]any {
	t.Helper()

	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d for %s: %s", recorder.Code, path, recorder.Body.String())
	}
	return decodeSkillJSON(t, recorder)
}

func getSkillJSON(t *testing.T, router http.Handler, path string) map[string]any {
	t.Helper()

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d for %s: %s", recorder.Code, path, recorder.Body.String())
	}
	return decodeSkillJSON(t, recorder)
}

func decodeSkillJSON(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()

	var out map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v body=%s", err, recorder.Body.String())
	}
	return out
}

func assertSkillField(t *testing.T, value map[string]any, key string, expected any) {
	t.Helper()
	if value[key] != expected {
		t.Fatalf("expected %s=%#v, got %#v", key, expected, value[key])
	}
}

func newSkillInventoryTestItem(skillID string, name string, source string, lastSeenAt string) map[string]any {
	return map[string]any{
		"skillId":       skillID,
		"name":          name,
		"source":        source,
		"installPath":   "C:/Users/example/.openclaw/skills/" + skillID,
		"manifestPath":  "C:/Users/example/.openclaw/skills/" + skillID + "/SKILL.md",
		"hashAlgorithm": "sha256",
		"baselineHash":  "hash-" + skillID,
		"currentHash":   "hash-" + skillID,
		"trustState":    "trusted",
		"lastSeenAt":    lastSeenAt,
	}
}

func assertSourceBreakdownCount(t *testing.T, page map[string]any, sourceKind string, expected int) {
	t.Helper()
	breakdown, ok := page["sourceBreakdown"].([]any)
	if !ok {
		t.Fatalf("expected sourceBreakdown array, got %#v", page["sourceBreakdown"])
	}
	for _, raw := range breakdown {
		item, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("expected source breakdown object, got %#v", raw)
		}
		if item["sourceKind"] == sourceKind {
			if item["count"] != float64(expected) {
				t.Fatalf("expected sourceBreakdown[%s]=%d, got %#v", sourceKind, expected, item["count"])
			}
			return
		}
	}
	t.Fatalf("expected sourceBreakdown to include %s, got %#v", sourceKind, breakdown)
}

func insertTokenUsage(t *testing.T, database *sql.DB, id string, sourceType string, totalTokens int64, isEstimated bool) {
	t.Helper()

	estimated := 0
	if isEstimated {
		estimated = 1
	}
	_, err := database.Exec(
		`
		INSERT INTO token_usage (
			usage_event_id, source_type, session_key, run_id, agent_id, provider, model,
			input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
			total_tokens, assistant_text_count, is_estimated, occurred_at, ingested_at,
			payload_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
		id,
		sourceType,
		"session-1",
		"run-1",
		"agent-1",
		"provider-1",
		"model-1",
		totalTokens,
		0,
		0,
		0,
		totalTokens,
		1,
		estimated,
		int64(1760000000000),
		int64(1760000000001),
		"{}",
	)
	if err != nil {
		t.Fatalf("insert token usage %s: %v", id, err)
	}
}
