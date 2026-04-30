package decision

import (
	"testing"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

func TestHasHighConfidenceScriptFinding(t *testing.T) {
	req := api.DecisionRequest{
		ScriptEvidence: []api.ScriptPreflightEvidence{
			{
				Findings: []api.ScriptFinding{
					{RuleID: "script.credential_external_exfiltration", Confidence: "high"},
				},
			},
		},
	}

	if !hasHighConfidenceScriptFinding(req, "script.credential_external_exfiltration") {
		t.Fatalf("expected high-confidence finding to match")
	}
	if hasHighConfidenceScriptFinding(req, "script.download_execute_dynamic_eval") {
		t.Fatalf("unexpected different rule match")
	}
}

func TestHasScriptRecommendedAction(t *testing.T) {
	req := api.DecisionRequest{
		ScriptEvidence: []api.ScriptPreflightEvidence{
			{RecommendedAction: "deny"},
		},
	}

	if !hasScriptRecommendedAction(req, "deny") {
		t.Fatalf("expected recommended deny to match")
	}
	if hasScriptRecommendedAction(req, "allow") {
		t.Fatalf("unexpected allow match")
	}
}
