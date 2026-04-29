package decision

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

type legacyPluginCase struct {
	Name                   string   `json:"name"`
	Content                string   `json:"content"`
	ExpectDetected         bool     `json:"expectDetected"`
	ExpectFamilies         []string `json:"expectFamilies"`
	ExpectAbsentFamilies   []string `json:"expectAbsentFamilies"`
	ExpectPluginSeverity   string   `json:"expectPluginSeverity"`
	ExpectPluginScoreDelta float64  `json:"expectPluginScoreDelta"`
	ExpectRiskLevel        string   `json:"expectRiskLevel"`
	ExpectAction           string   `json:"expectAction"`
	ExpectSemanticModule   string   `json:"expectSemanticModule"`
	ExpectEvidenceRule     string   `json:"expectEvidenceRule"`
}

func TestGoDecisionEngineCoversLegacyPluginEvasiveIntentCases(t *testing.T) {
	cases := loadLegacyPluginCases(t)
	if len(cases) < 16 {
		t.Fatalf("legacy fixture has %d cases, want at least 16 ported detector cases from test/evasive-intent-cn.test.ts", len(cases))
	}

	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			req := api.DecisionRequest{Stage: "input", Hook: "before_agent_start", Content: tc.Content}
			semantic := evaluateSemantic(t, tc.Content)
			evidence := evaluateEvidence(t, req)
			winner := stricterResult(semantic, evidence)

			if string(winner.RiskLevel) != tc.ExpectRiskLevel || string(winner.Action) != tc.ExpectAction {
				t.Fatalf("winner risk/action = %s/%s, want %s/%s; semantic=%s evidence=%s",
					winner.RiskLevel, winner.Action, tc.ExpectRiskLevel, tc.ExpectAction, semantic.Reason, evidence.Reason)
			}
			if tc.ExpectSemanticModule != "" && !legacyContainsString(semantic.MatchedModules, tc.ExpectSemanticModule) {
				t.Fatalf("semantic modules = %v, want %s", semantic.MatchedModules, tc.ExpectSemanticModule)
			}
			if tc.ExpectEvidenceRule != "" && !legacyHasScoreRule(evidence, tc.ExpectEvidenceRule) {
				t.Fatalf("evidence breakdown = %#v, want rule %s", evidence.ScoreBreakdown, tc.ExpectEvidenceRule)
			}
		})
	}
}

func loadLegacyPluginCases(t *testing.T) []legacyPluginCase {
	t.Helper()
	path := filepath.Join("testdata", "plugin_evasive_intent_cases.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var cases []legacyPluginCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return cases
}

func legacyHasScoreRule(result api.ArbiterResult, ruleID string) bool {
	for _, item := range result.ScoreBreakdown {
		if item.RuleID == ruleID {
			return true
		}
	}
	return false
}

func legacyContainsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
