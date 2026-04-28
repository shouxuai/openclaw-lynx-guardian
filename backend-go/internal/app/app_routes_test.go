package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/openclaw/lynx-guardian/backend-go/internal/config"
)

func TestMetaCapabilitiesMatchesSharedQueryVersion(t *testing.T) {
	handler, closer := buildTestHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/lynx/meta/capabilities", nil)
	request.RemoteAddr = "127.0.0.1:12345"

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %s", response.Code, response.Body.String())
	}

	var payload struct {
		QueryAPIVersion string `json:"queryApiVersion"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.QueryAPIVersion != "v1" {
		t.Fatalf("expected queryApiVersion v1, got %q", payload.QueryAPIVersion)
	}
}

func buildTestHandler(t *testing.T) (http.Handler, Closer) {
	t.Helper()

	tempDir := t.TempDir()
	cfg := &config.Config{
		Host:              "127.0.0.1",
		ListenHost:        "127.0.0.1",
		Port:              "31789",
		DataDir:           tempDir,
		DatabasePath:      tempDir + "/lynx.db",
		TokenPath:         tempDir + "/console.token",
		FrontendDistPath:  tempDir,
		TokenUsageEnabled: true,
		TrustedProxyIPs:   nil,
	}

	handler, closer, err := Build(cfg)
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	return handler, closer
}
