package backend_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAPISpecAndDocsAreServed(t *testing.T) {
	handler, closer := buildTestHandler(t)
	t.Cleanup(func() {
		if err := closer(); err != nil {
			t.Fatalf("closer returned error: %v", err)
		}
	})

	specResponse := httptest.NewRecorder()
	specRequest := httptest.NewRequest(http.MethodGet, "/lynx/openapi.yaml", nil)
	specRequest.RemoteAddr = "127.0.0.1:12345"
	handler.ServeHTTP(specResponse, specRequest)

	if specResponse.Code != http.StatusOK {
		t.Fatalf("expected openapi spec status 200, got %d with body %s", specResponse.Code, specResponse.Body.String())
	}
	specBody := specResponse.Body.String()
	for _, want := range []string{
		"openapi: 3.0.3",
		"title: Lynx Server API",
		"/lynx/health:",
		"/lynx/internal/v1/ingest/batch:",
		"/lynx/internal/v1/ingest/tool-calls:",
		"/lynx/internal/v1/ingest/lynx-checks:",
		"Ingest one plugin event batch.",
		"Ingest tool call upsert items.",
	} {
		if !strings.Contains(specBody, want) {
			t.Fatalf("expected openapi spec to contain %q, got %s", want, specBody)
		}
	}
	docsResponse := httptest.NewRecorder()
	docsRequest := httptest.NewRequest(http.MethodGet, "/lynx/docs", nil)
	docsRequest.RemoteAddr = "127.0.0.1:12345"
	handler.ServeHTTP(docsResponse, docsRequest)

	if docsResponse.Code != http.StatusOK {
		t.Fatalf("expected docs status 200, got %d with body %s", docsResponse.Code, docsResponse.Body.String())
	}
	docsBody := docsResponse.Body.String()
	for _, want := range []string{"SwaggerUIBundle", "/lynx/openapi.yaml", "Lynx Server API Docs"} {
		if !strings.Contains(docsBody, want) {
			t.Fatalf("expected docs page to contain %q, got %s", want, docsBody)
		}
	}
}
