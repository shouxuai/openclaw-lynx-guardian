package decision

import (
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

func normalizeDecisionText(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func requestText(req api.DecisionRequest) string {
	return normalizeDecisionText(req.Content + " " + req.ToolName + " " + req.TargetURI)
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}

func containsAll(value string, needles ...string) bool {
	for _, needle := range needles {
		if !strings.Contains(value, strings.ToLower(needle)) {
			return false
		}
	}
	return true
}

func moduleFromRuleID(ruleID string) string {
	if dot := strings.Index(ruleID, "."); dot > 0 {
		return ruleID[:dot]
	}
	return ruleID
}
