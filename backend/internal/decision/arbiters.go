package decision

import (
	"context"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

type semanticArbiter struct{}
type evidenceArbiter struct{}

func (semanticArbiter) Name() string { return "semantic_intent" }
func (evidenceArbiter) Name() string { return "evidence_score" }

func (semanticArbiter) Evaluate(
	_ context.Context,
	req api.DecisionRequest,
	_ ChainSummary,
) (api.ArbiterResult, error) {
	text := normalizeDecisionText(req.Content + " " + req.ToolName + " " + req.TargetURI)
	if containsAny(text, "system prompt", "developer instruction", "系统提示", "系统提示词", "开发者指令", "安全规则原文") {
		return arbiterResult("semantic_intent", "L4", "deny", 100, "semantic.system_prompt_extraction", "request asks for protected instruction text"), nil
	}
	if containsAny(text, "绕过审批", "跳过授权", "免确认", "不要授权", "别弹", "queren", "shouquan", "shenpi") {
		return arbiterResult("semantic_intent", "L3", "require_approval", 70, "semantic.approval_bypass", "request asks to bypass confirmation or approval"), nil
	}
	return arbiterResult("semantic_intent", "L0", "allow", 0, "semantic.ordinary_business", "ordinary business request"), nil
}

func (evidenceArbiter) Evaluate(
	_ context.Context,
	req api.DecisionRequest,
	_ ChainSummary,
) (api.ArbiterResult, error) {
	text := normalizeDecisionText(req.Content + " " + req.ToolName + " " + req.TargetURI)
	if containsAny(text, "id_rsa", "private key", "-----begin", ".env", "api_key", "api key", "token") {
		return arbiterResult("evidence_score", "L4", "deny", 100, "evidence.credential_read", "request targets credentials or private key material"), nil
	}
	if containsAny(text, "告警记录", "风险提示", "warn", "warning") {
		return arbiterResult("evidence_score", "L2", "warn", 35, "evidence.warn_signal", "risk signal should be logged as warning without blocking"), nil
	}
	return arbiterResult("evidence_score", "L0", "allow", 0, "evidence.no_match", "no evidence rule matched"), nil
}

func normalizeDecisionText(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}

func arbiterResult(
	arbiter api.DecisionArbiterName,
	riskLevel api.RiskLevel,
	action api.DecisionAction,
	score float64,
	ruleID string,
	reason string,
) api.ArbiterResult {
	severity := api.EventSeverity("info")
	if riskLevel == "L4" {
		severity = "critical"
	} else if riskLevel == "L2" || riskLevel == "L3" {
		severity = "warn"
	}
	module := ruleID
	if dot := strings.Index(ruleID, "."); dot > 0 {
		module = ruleID[:dot]
	}
	return api.ArbiterResult{
		Arbiter:        arbiter,
		RiskLevel:      riskLevel,
		Action:         action,
		Score:          score,
		MatchedModules: []string{module},
		Evidence: []api.EvidenceItem{{
			ID:         ruleID,
			Module:     module,
			Kind:       "rule_match",
			Value:      ruleID,
			Severity:   severity,
			ScoreDelta: score,
			Source:     "input",
		}},
		ScoreBreakdown: []api.ScoreBreakdown{{
			RuleID: ruleID,
			Label:  ruleID,
			Delta:  score,
			Reason: reason,
		}},
		Reason: reason,
	}
}
