package decision

import (
	"context"
	"fmt"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

type evidenceArbiter struct{}

func (evidenceArbiter) Name() string { return "evidence_score" }

func (evidenceArbiter) Evaluate(
	_ context.Context,
	req api.DecisionRequest,
	chain ChainSummary,
) (api.ArbiterResult, error) {
	rules := evidenceRulesFor(req)
	evidence := make([]api.EvidenceItem, 0)
	breakdown := make([]api.ScoreBreakdown, 0)
	matchedModules := make([]string, 0)
	moduleSeen := map[string]struct{}{}
	score := 0.0
	hard := api.ArbiterResult{RiskLevel: "L0", Action: "allow"}

	for _, rule := range rules {
		if !rule.matches(req) {
			continue
		}
		score += rule.ScoreDelta
		evidence = append(evidence, rule.evidenceItem())
		breakdown = append(breakdown, rule.scoreBreakdown())
		if _, ok := moduleSeen[rule.Module]; !ok {
			moduleSeen[rule.Module] = struct{}{}
			matchedModules = append(matchedModules, rule.Module)
		}
		if rule.HardRiskLevel != "" {
			hard = stricterResult(hard, api.ArbiterResult{
				RiskLevel: rule.HardRiskLevel,
				Action:    rule.HardAction,
			})
		}
	}
	for _, item := range chainEvidenceItems(chain) {
		score += item.ScoreDelta
		evidence = append(evidence, item)
		breakdown = append(breakdown, api.ScoreBreakdown{
			RuleID: item.ID,
			Label:  item.ID,
			Delta:  item.ScoreDelta,
			Reason: chainEvidenceReason(item.ID),
		})
		if _, ok := moduleSeen[item.Module]; !ok {
			moduleSeen[item.Module] = struct{}{}
			matchedModules = append(matchedModules, item.Module)
		}
	}

	riskLevel, action := riskActionForScore(score)
	mapped := api.ArbiterResult{RiskLevel: riskLevel, Action: action}
	winner := stricterResult(mapped, hard)
	return api.ArbiterResult{
		Arbiter:        "evidence_score",
		RiskLevel:      winner.RiskLevel,
		Action:         winner.Action,
		Score:          score,
		MatchedModules: matchedModules,
		Evidence:       evidence,
		ScoreBreakdown: breakdown,
		Reason:         evidenceReason(winner.RiskLevel, score, breakdown),
	}, nil
}

func chainEvidenceItems(chain ChainSummary) []api.EvidenceItem {
	items := make([]api.EvidenceItem, 0)
	if len(chain.RecentDenials) > 0 {
		items = append(items, api.EvidenceItem{
			ID:         "chain.recent_denial",
			Module:     "chain_context",
			Kind:       "recent_denial",
			Value:      chain.RecentDenials[len(chain.RecentDenials)-1],
			Severity:   "warn",
			ScoreDelta: 30,
			Source:     "chain",
		})
	}
	if len(chain.RecentEvasions) > 0 {
		items = append(items, api.EvidenceItem{
			ID:         "chain.recent_evasion",
			Module:     "chain_context",
			Kind:       "recent_evasion",
			Value:      chain.RecentEvasions[len(chain.RecentEvasions)-1],
			Severity:   "warn",
			ScoreDelta: 40,
			Source:     "chain",
		})
	}
	if chain.PendingApproval != "" {
		items = append(items, api.EvidenceItem{
			ID:         "chain.pending_approval",
			Module:     "chain_context",
			Kind:       "pending_approval",
			Value:      chain.PendingApproval,
			Severity:   "warn",
			ScoreDelta: 30,
			Source:     "chain",
		})
	}
	if chain.ActiveGrantID != "" {
		items = append(items, api.EvidenceItem{
			ID:         "chain.active_grant",
			Module:     "chain_context",
			Kind:       "active_grant",
			Value:      chain.ActiveGrantID,
			Severity:   "info",
			ScoreDelta: 0,
			Source:     "chain",
		})
	}
	if len(chain.RecentTaintReads) > 0 || len(chain.TaintSummary) > 0 {
		value := lastOrFallback(chain.RecentTaintReads, "taint_summary")
		items = append(items, api.EvidenceItem{
			ID:         "taint.recent_sensitive_read",
			Module:     "taint_context",
			Kind:       "recent_sensitive_read",
			Value:      value,
			Severity:   "warn",
			ScoreDelta: 30,
			Source:     "taint",
		})
	}
	return items
}

func chainEvidenceReason(ruleID string) string {
	switch ruleID {
	case "chain.recent_denial":
		return "chain has a recent denial signal"
	case "chain.recent_evasion":
		return "chain has recent evasion or hidden execution signal"
	case "chain.pending_approval":
		return "chain has a pending approval"
	case "chain.active_grant":
		return "chain has an active approval grant"
	case "taint.recent_sensitive_read":
		return "chain or request carries recent sensitive taint"
	default:
		return "chain context evidence"
	}
}

func lastOrFallback(values []string, fallback string) string {
	if len(values) == 0 {
		return fallback
	}
	return values[len(values)-1]
}

type evidenceRule struct {
	ID            string
	Module        string
	Kind          string
	Source        api.EvidenceSource
	Severity      api.EventSeverity
	ScoreDelta    float64
	Reason        string
	AnyTerms      []string
	AllTerms      []string
	Matcher       func(api.DecisionRequest, string) bool
	HardRiskLevel api.RiskLevel
	HardAction    api.DecisionAction
}

func (r evidenceRule) matches(req api.DecisionRequest) bool {
	text := requestText(req)
	if r.Matcher != nil {
		return r.Matcher(req, text)
	}
	if len(r.AnyTerms) > 0 && !containsAny(text, r.AnyTerms...) {
		return false
	}
	if len(r.AllTerms) > 0 && !containsAll(text, r.AllTerms...) {
		return false
	}
	return len(r.AnyTerms) > 0 || len(r.AllTerms) > 0
}

func (r evidenceRule) evidenceItem() api.EvidenceItem {
	return api.EvidenceItem{
		ID:         r.ID,
		Module:     r.Module,
		Kind:       r.Kind,
		Value:      r.ID,
		Severity:   r.Severity,
		ScoreDelta: r.ScoreDelta,
		Source:     r.Source,
	}
}

func (r evidenceRule) scoreBreakdown() api.ScoreBreakdown {
	return api.ScoreBreakdown{
		RuleID: r.ID,
		Label:  r.ID,
		Delta:  r.ScoreDelta,
		Reason: r.Reason,
	}
}

func evidenceRulesFor(req api.DecisionRequest) []evidenceRule {
	rules := make([]evidenceRule, 0, len(inputEvidenceRules)+len(toolEvidenceRules)+len(outputEvidenceRules)+1)
	switch req.Stage {
	case "install":
		rules = append(rules, installEvidenceRules...)
	case "tool_call":
		rules = append(rules, toolEvidenceRules...)
	case "tool_result", "assistant_output", "outbound_message":
		rules = append(rules, outputEvidenceRules...)
	default:
		rules = append(rules, inputEvidenceRules...)
	}
	if providerRule, ok := providerContentSafetyRule(req); ok {
		rules = append(rules, providerRule)
	}
	return rules
}

func providerContentSafetyRule(req api.DecisionRequest) (evidenceRule, bool) {
	if req.ProviderSafety == nil {
		return evidenceRule{}, false
	}
	isSafe, ok := req.ProviderSafety["is_safe"].(bool)
	if !ok || isSafe {
		return evidenceRule{}, false
	}
	severity := api.EventSeverity("warn")
	score := 40.0
	if strings.EqualFold(fmt.Sprint(req.ProviderSafety["severity"]), "critical") {
		severity = "critical"
		score = 80
	}
	return evidenceRule{
		ID:         "provider.content_safety",
		Module:     "provider_content_safety",
		Kind:       "provider_safety",
		Source:     "provider",
		Severity:   severity,
		ScoreDelta: score,
		Reason:     "upstream provider marked content as unsafe",
		Matcher:    func(api.DecisionRequest, string) bool { return true },
	}, true
}

func riskActionForScore(score float64) (api.RiskLevel, api.DecisionAction) {
	switch {
	case score >= 80:
		return "L4", "deny"
	case score >= 60:
		return "L3", "require_approval"
	case score >= 40:
		return "L2", "warn"
	case score >= 20:
		return "L1", "log_only"
	default:
		return "L0", "allow"
	}
}

func evidenceReason(riskLevel api.RiskLevel, score float64, breakdown []api.ScoreBreakdown) string {
	if len(breakdown) == 0 {
		return "no evidence rule matched"
	}
	return fmt.Sprintf("evidence score %.0f mapped to %s from %d matched rule(s)", score, riskLevel, len(breakdown))
}

func severityForRisk(riskLevel api.RiskLevel) api.EventSeverity {
	switch riskLevel {
	case "L4":
		return "critical"
	case "L2", "L3":
		return "warn"
	default:
		return "info"
	}
}
