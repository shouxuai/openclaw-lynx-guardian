package decision

import (
	"regexp"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

type runtimePolicyRule struct {
	RuleID      string
	Kind        string
	Scope       string
	PatternType string
	Pattern     string
	RiskDelta   float64
	Enabled     bool
}

func extractRuntimePolicyRules(req api.DecisionRequest) []runtimePolicyRule {
	if req.ProviderSafety == nil {
		return nil
	}
	switch raw := req.ProviderSafety["policyRules"].(type) {
	case []api.PolicyRule:
		rules := make([]runtimePolicyRule, 0, len(raw))
		for _, item := range raw {
			rules = append(rules, runtimePolicyRule{
				RuleID:      item.RuleID,
				Kind:        item.Kind,
				Scope:       item.Scope,
				PatternType: item.PatternType,
				Pattern:     item.Pattern,
				RiskDelta:   float64(item.RiskDelta),
				Enabled:     item.Enabled,
			})
		}
		return rules
	case []any:
		rules := make([]runtimePolicyRule, 0, len(raw))
		for _, item := range raw {
			record, ok := item.(map[string]any)
			if !ok {
				continue
			}
			rules = append(rules, runtimePolicyRule{
				RuleID:      stringMapValue(record, "ruleId"),
				Kind:        stringMapValue(record, "kind"),
				Scope:       stringMapValue(record, "scope"),
				PatternType: stringMapValue(record, "patternType"),
				Pattern:     stringMapValue(record, "pattern"),
				RiskDelta:   floatMapValue(record, "riskDelta"),
				Enabled:     boolMapValue(record, "enabled"),
			})
		}
		return rules
	default:
		return nil
	}
}

func policyRuleMatches(rule runtimePolicyRule, req api.DecisionRequest, text string) bool {
	if !rule.Enabled || rule.Pattern == "" {
		return false
	}
	target := strings.ToLower(text + " " + req.Content + " " + req.TargetURI + " " + toolArgsFlatText(req.ToolArgs))
	if rule.PatternType == "regex" {
		pattern, err := regexp.Compile(rule.Pattern)
		return err == nil && pattern.MatchString(target)
	}
	return strings.Contains(target, strings.ToLower(rule.Pattern))
}

func stringMapValue(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return value
}

func floatMapValue(record map[string]any, key string) float64 {
	switch value := record[key].(type) {
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case float64:
		return value
	case jsonNumber:
		parsed, _ := value.Float64()
		return parsed
	default:
		return 0
	}
}

func boolMapValue(record map[string]any, key string) bool {
	value, _ := record[key].(bool)
	return value
}

type jsonNumber interface {
	Float64() (float64, error)
	String() string
}
