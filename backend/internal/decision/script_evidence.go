package decision

import "github.com/openclaw/lynx-guardian/backend/internal/api"

func hasScriptFinding(req api.DecisionRequest, ruleIDs ...string) bool {
	wanted := map[string]bool{}
	for _, ruleID := range ruleIDs {
		wanted[ruleID] = true
	}
	for _, evidence := range req.ScriptEvidence {
		for _, finding := range evidence.Findings {
			if wanted[finding.RuleID] {
				return true
			}
		}
	}
	return false
}

func hasHighConfidenceScriptFinding(req api.DecisionRequest, ruleIDs ...string) bool {
	wanted := map[string]bool{}
	for _, ruleID := range ruleIDs {
		wanted[ruleID] = true
	}
	for _, evidence := range req.ScriptEvidence {
		for _, finding := range evidence.Findings {
			if wanted[finding.RuleID] && finding.Confidence == "high" {
				return true
			}
		}
	}
	return false
}

func hasScriptRecommendedAction(req api.DecisionRequest, actions ...api.DecisionAction) bool {
	wanted := map[api.DecisionAction]bool{}
	for _, action := range actions {
		wanted[action] = true
	}
	for _, evidence := range req.ScriptEvidence {
		if wanted[evidence.RecommendedAction] {
			return true
		}
	}
	return false
}
