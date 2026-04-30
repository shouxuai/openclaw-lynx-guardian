package backend_test

import (
	"testing"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

func TestUserBlacklistRuleCanEscalateScriptRisk(t *testing.T) {
	service, _, _ := newDecisionContractService(t)
	response := decideWithContractService(t, service, api.DecisionRequest{
		RequestID: "req-policy-blacklist",
		Stage:     "tool_call",
		Hook:      "before_tool_call",
		Content:   "Invoke-Expression downloaded payload",
		ToolName:  "exec",
		ToolArgs:  map[string]any{"command": "pwsh ./setup.ps1"},
		ProviderSafety: map[string]any{
			"policyRules": []any{
				map[string]any{
					"ruleId":      "rule-iex",
					"kind":        "blacklist",
					"scope":       "script",
					"patternType": "literal",
					"pattern":     "Invoke-Expression",
					"riskDelta":   70,
					"enabled":     true,
				},
			},
		},
	})

	if response.Score < 70 {
		t.Fatalf("expected policy blacklist score contribution, got %.1f", response.Score)
	}
}

func TestAllowlistDoesNotOverrideL4ScriptDeny(t *testing.T) {
	service, _, _ := newDecisionContractService(t)
	response := decideWithContractService(t, service, api.DecisionRequest{
		RequestID: "req-policy-allowlist-l4",
		Stage:     "tool_call",
		Hook:      "before_tool_call",
		ToolName:  "exec",
		ToolArgs:  map[string]any{"command": "python trusted.py"},
		ProviderSafety: map[string]any{
			"policyRules": []any{
				map[string]any{
					"ruleId":      "allow-trusted",
					"kind":        "allowlist",
					"scope":       "script",
					"patternType": "literal",
					"pattern":     "trusted.py",
					"riskDelta":   -50,
					"enabled":     true,
				},
			},
		},
		ScriptEvidence: []api.ScriptPreflightEvidence{
			{
				EvidenceID:        "script-1",
				EntrypointKind:    "direct_file",
				Source:            "script_file",
				ScriptPath:        "trusted.py",
				Language:          "python",
				ReadStatus:        "read",
				RiskLevel:         "L4",
				RecommendedAction: "deny",
				Findings: []api.ScriptFinding{
					{
						RuleID:     "script.credential_external_exfiltration",
						Module:     "exfiltration",
						Severity:   "critical",
						Behavior:   "exfiltrates credentials",
						Confidence: "high",
					},
				},
			},
		},
	})

	if !response.Block || response.RiskLevel != "L4" {
		t.Fatalf("allowlist must not override L4 deny, got block=%v risk=%s", response.Block, response.RiskLevel)
	}
}
