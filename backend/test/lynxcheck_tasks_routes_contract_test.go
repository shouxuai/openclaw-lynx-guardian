package backend_test

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/openclaw/lynx-guardian/backend/internal/db"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
	"github.com/openclaw/lynx-guardian/backend/internal/routes"
	"github.com/openclaw/lynx-guardian/backend/internal/tasks"
	_ "modernc.org/sqlite"
)

func TestLynxCheckTaskManualLifecycle(t *testing.T) {
	router := setupLynxCheckTaskRouter(t)

	started := postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/start", map[string]any{
		"requestId":   "manual-1",
		"trigger":     "manual",
		"source":      "lynx_command",
		"requesterId": "user-1",
		"sessionKey":  "session-1",
		"targetKey":   "current",
	})
	assertLynxField(t, started, "status", "created")
	assertLynxField(t, started, "trigger", "manual")

	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/manual-1/event", map[string]any{
		"status": "collecting",
		"facts": map[string]any{
			"scanner": "started",
		},
	})
	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/manual-1/event", map[string]any{
		"status": "analyzing",
		"evidenceBundle": map[string]any{
			"policy": "ok",
		},
	})
	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/manual-1/event", map[string]any{
		"status":         "completed",
		"reportSkeleton": "manual report skeleton",
	})

	detail := getLynxJSON(t, router, "/lynx/lynx-checks/manual-1")
	assertLynxField(t, detail, "status", "completed")
	assertLynxField(t, detail, "requestId", "manual-1")
	assertLynxField(t, detail, "reportSkeleton", "manual report skeleton")
	assertLynxNestedField(t, detail, "facts", "scanner", "started")
	assertLynxNestedField(t, detail, "evidenceBundle", "policy", "ok")
}

func TestLynxCheckTaskScheduledUsesSameTable(t *testing.T) {
	router := setupLynxCheckTaskRouter(t)

	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/start", map[string]any{
		"requestId":  "scheduled-1",
		"trigger":    "scheduled",
		"source":     "scheduled_lynx_check",
		"sessionKey": "cron:lynx-check",
		"targetKey":  "recent",
	})

	page := getLynxJSON(t, router, "/lynx/lynx-checks?trigger=scheduled")
	items, ok := page["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected one scheduled task in list, got %#v", page["items"])
	}
	item, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected object list item, got %#v", items[0])
	}
	assertLynxField(t, item, "requestId", "scheduled-1")
	assertLynxField(t, item, "trigger", "scheduled")
	assertLynxField(t, item, "status", "created")
}

func TestLynxCheckTaskFailedEventRecordsError(t *testing.T) {
	router := setupLynxCheckTaskRouter(t)

	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/start", map[string]any{
		"requestId": "failed-1",
		"trigger":   "manual",
		"source":    "lynx_command",
	})
	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/failed-1/event", map[string]any{
		"status":       "failed",
		"errorMessage": "report generation failed",
	})

	detail := getLynxJSON(t, router, "/lynx/lynx-checks/failed-1")
	assertLynxField(t, detail, "status", "failed")
	assertLynxField(t, detail, "errorMessage", "report generation failed")
}

func TestLynxCheckTaskIgnoresStaleEventsAfterTerminalState(t *testing.T) {
	router := setupLynxCheckTaskRouter(t)

	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/start", map[string]any{
		"requestId": "stale-1",
		"trigger":   "manual",
		"source":    "lynx_command",
	})
	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/stale-1/event", map[string]any{
		"status":       "failed",
		"errorMessage": "delivery failed",
	})
	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/stale-1/event", map[string]any{
		"status": "collecting",
		"facts": map[string]any{
			"late": "scanner-started",
		},
	})

	detail := getLynxJSON(t, router, "/lynx/lynx-checks/stale-1")
	assertLynxField(t, detail, "status", "failed")
	assertLynxField(t, detail, "errorMessage", "delivery failed")
}

func TestLynxCheckTaskDeliveryLifecycle(t *testing.T) {
	router := setupLynxCheckTaskRouter(t)

	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/start", map[string]any{
		"requestId": "delivery-1",
		"trigger":   "manual",
		"source":    "lynx_command",
	})
	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/delivery-1/event", map[string]any{
		"status":          "delivering",
		"deliveryChannel": "feishu",
		"deliveryTarget":  "chat-1",
		"deliveryStatus":  "attempting",
	})
	postLynxJSON(t, router, http.MethodPost, "/lynx/internal/v1/tasks/lynx-check/delivery-1/event", map[string]any{
		"status":         "completed",
		"deliveryStatus": "sent",
	})

	detail := getLynxJSON(t, router, "/lynx/lynx-checks/delivery-1")
	assertLynxField(t, detail, "status", "completed")
	assertLynxField(t, detail, "deliveryChannel", "feishu")
	assertLynxField(t, detail, "deliveryTarget", "chat-1")
	assertLynxField(t, detail, "deliveryStatus", "sent")
}

func setupLynxCheckTaskRouter(t *testing.T) *gin.Engine {
	t.Helper()

	gin.SetMode(gin.TestMode)
	database, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	database.SetMaxOpenConns(1)
	if err := db.Migrate(database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	repository := repo.NewLynxCheckTaskRepository(database)
	service := tasks.NewLynxCheckService(repository)
	router := gin.New()
	query := router.Group("/lynx")
	internal := query.Group("/internal/v1")
	routes.RegisterLynxCheckTasks(query, internal, service, repository)
	return router
}

func postLynxJSON(t *testing.T, router http.Handler, method string, path string, body any) map[string]any {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(string(data)))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d for %s: %s", recorder.Code, path, recorder.Body.String())
	}
	return decodeLynxJSON(t, recorder)
}

func getLynxJSON(t *testing.T, router http.Handler, path string) map[string]any {
	t.Helper()
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	router.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status %d for %s: %s", recorder.Code, path, recorder.Body.String())
	}
	return decodeLynxJSON(t, recorder)
}

func decodeLynxJSON(t *testing.T, recorder *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v body=%s", err, recorder.Body.String())
	}
	return out
}

func assertLynxField(t *testing.T, value map[string]any, key string, expected string) {
	t.Helper()
	if actual, _ := value[key].(string); actual != expected {
		t.Fatalf("expected %s=%q, got %#v", key, expected, value[key])
	}
}

func assertLynxNestedField(t *testing.T, value map[string]any, key string, nestedKey string, expected string) {
	t.Helper()
	nested, ok := value[key].(map[string]any)
	if !ok {
		t.Fatalf("expected nested map at %s, got %#v", key, value[key])
	}
	assertLynxField(t, nested, nestedKey, expected)
}
