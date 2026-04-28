package backend_test

import (
	"fmt"
	"strings"
	"testing"

	backendapp "github.com/openclaw/lynx-guardian/backend/internal/app"
	"github.com/openclaw/lynx-guardian/backend/internal/config"
)

func TestBuildReturnsGinEngine(t *testing.T) {
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

	handler, closer, err := backendapp.Build(cfg)
	if err != nil {
		t.Fatalf("Build returned error: %v", err)
	}
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	handlerType := fmt.Sprintf("%T", handler)
	if !strings.Contains(handlerType, "gin.Engine") {
		t.Fatalf("expected Gin engine handler, got %s", handlerType)
	}
}
