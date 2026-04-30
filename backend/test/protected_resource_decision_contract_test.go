package backend_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

func TestDecisionDeniesProtectedResourceWriteViolation(t *testing.T) {
	service, _, _ := newDecisionContractService(t)
	response := decideWithContractService(t, service, api.DecisionRequest{
		RequestID: "req-resource-write",
		Stage:     "tool_call",
		Hook:      "before_tool_call",
		ToolName:  "write",
		ToolArgs:  map[string]any{"file_path": "C:\\Projects\\ProtectedDocs\\report.txt"},
		ResourceEvidence: []api.ResourcePolicyEvidence{
			{
				EvidenceID:    "resource-1-write",
				ResourceID:    "resource-1",
				MatchedPath:   "C:\\Projects\\ProtectedDocs",
				RealPath:      "C:\\Projects\\ProtectedDocs\\report.txt",
				Preset:        "read_only",
				Operation:     "write",
				Allowed:       false,
				Reason:        "read_only forbids write",
				PolicyVersion: 4,
			},
		},
	})

	if !response.Block || response.RiskLevel != "L4" || response.Action != "deny" {
		t.Fatalf("expected L4 deny, got block=%v risk=%s action=%s", response.Block, response.RiskLevel, response.Action)
	}
}

func TestDecisionRouteEnrichesProtectedResourceEvidenceFromGoPolicy(t *testing.T) {
	router, closer := buildParityHandler(t)
	defer closer()

	create := policyPostJSON(t, router, "/lynx/protected-resources", map[string]any{
		"path":          "C:\\Projects\\ProtectedDocs",
		"preset":        "read_only",
		"enabled":       true,
		"actorId":       "alice",
		"changeSummary": "protect local project documents",
	})
	if create.Code != http.StatusOK {
		t.Fatalf("create protected resource status=%d body=%s", create.Code, create.Body.String())
	}

	recorder := doJSON(t, router, http.MethodPost, "/lynx/internal/v1/decision/tool", api.DecisionRequest{
		RequestID: "req-go-policy-resource",
		Stage:     "tool_call",
		Hook:      "before_tool_call",
		ToolName:  "write",
		ToolArgs: map[string]any{
			"file_path": "C:\\Projects\\ProtectedDocs\\report.txt",
			"content":   "new report",
		},
	}, true)
	if recorder.Code != http.StatusOK {
		t.Fatalf("decision status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response api.DecisionResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode decision response: %v", err)
	}

	if !response.Block || response.RiskLevel != "L4" || response.Action != "deny" {
		t.Fatalf("expected Go policy enrichment L4 deny, got block=%v risk=%s action=%s", response.Block, response.RiskLevel, response.Action)
	}
	if !containsString(response.MatchedModules, "protected_resource") {
		t.Fatalf("expected protected_resource module, got %#v", response.MatchedModules)
	}
	if !strings.Contains(response.UserMessage, "resource_policy.protected_resource_violation") {
		t.Fatalf("expected user message to include protected resource rule, got %q", response.UserMessage)
	}
}
