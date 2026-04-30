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
	pattern := strings.TrimSpace(rule.Pattern)
	if !rule.Enabled || pattern == "" {
		return false
	}
	for _, target := range policyRuleTargetCandidates(rule, req, text) {
		if policyRuleFullTextMatches(rule.PatternType, pattern, target) {
			return true
		}
	}
	return false
}

func policyRuleTargetCandidates(rule runtimePolicyRule, req api.DecisionRequest, text string) []string {
	values := []string{}
	switch rule.Scope {
	case "input", "output":
		values = append(values, req.Content)
	case "tool":
		values = append(values, req.TargetURI, toolArgsFlatText(req.ToolArgs), policyRuleToolArgsValueText(req.ToolArgs), text)
	case "script":
		values = append(values, req.Content, req.TargetURI, toolArgsFlatText(req.ToolArgs), policyRuleToolArgsValueText(req.ToolArgs))
	default:
		values = append(values, req.Content, req.TargetURI, toolArgsFlatText(req.ToolArgs), policyRuleToolArgsValueText(req.ToolArgs), text)
	}
	for _, evidence := range req.ScriptEvidence {
		values = append(values, evidence.Command, evidence.ScriptPath, evidence.RealPath)
	}

	candidates := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		normalized := normalizePolicyRuleText(value)
		if normalized == "" {
			continue
		}
		if _, ok := seen[normalized]; ok {
			continue
		}
		seen[normalized] = struct{}{}
		candidates = append(candidates, value)
	}
	return candidates
}

func policyRuleFullTextMatches(patternType string, pattern string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	if patternType == "regex" {
		compiled, err := regexp.Compile(pattern)
		if err != nil {
			return false
		}
		match := compiled.FindStringIndex(target)
		return match != nil && match[0] == 0 && match[1] == len(target)
	}
	return normalizePolicyRuleText(pattern) == normalizePolicyRuleText(target)
}

func normalizePolicyRuleText(value string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(value))), " ")
}

func policyRuleToolArgsValueText(args map[string]any) string {
	if len(args) == 0 {
		return ""
	}
	parts := make([]string, 0, len(args))
	for _, value := range args {
		parts = append(parts, policyRuleToolArgValueText(value))
	}
	return strings.Join(parts, " ")
}

func policyRuleToolArgValueText(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			parts = append(parts, policyRuleToolArgValueText(item))
		}
		return strings.Join(parts, " ")
	case map[string]any:
		return policyRuleToolArgsValueText(typed)
	default:
		return ""
	}
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
