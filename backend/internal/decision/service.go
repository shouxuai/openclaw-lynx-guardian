package decision

import (
	"context"
	"fmt"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

func (s *Service) Decide(ctx context.Context, req api.DecisionRequest) (api.DecisionResponse, error) {
	chain := ChainSummary{}
	semantic, err := s.semanticArbiter.Evaluate(ctx, req, chain)
	if err != nil {
		return api.DecisionResponse{}, err
	}
	evidence, err := s.evidenceArbiter.Evaluate(ctx, req, chain)
	if err != nil {
		return api.DecisionResponse{}, err
	}

	winner := stricterResult(semantic, evidence)
	decisionID := strings.TrimSpace(req.RequestID)
	if decisionID == "" {
		decisionID = fmt.Sprintf("decision-%d", s.clock().UnixNano())
	}

	response := api.DecisionResponse{
		DecisionID:       decisionID,
		Stage:            req.Stage,
		Block:            finalActionBlocks(winner.Action),
		Action:           winner.Action,
		RiskLevel:        winner.RiskLevel,
		Score:            winner.Score,
		WinningArbiter:   api.WinningArbiter(winner.Arbiter),
		Arbiters:         []api.ArbiterResult{semantic, evidence},
		MatchedModules:   mergeMatchedModules(semantic.MatchedModules, evidence.MatchedModules),
		RequiresApproval: requiresApproval(winner.Action),
		Audit: api.DecisionAudit{
			EventSeverity:     eventSeverityFor(winner.RiskLevel, winner.Action),
			PolicyDecision:    winner.Action,
			EnforcementAction: winner.Action,
			Color:             auditColorFor(winner.RiskLevel, winner.Action),
		},
	}
	if err := s.repo.InsertDecision(ctx, response); err != nil {
		return api.DecisionResponse{}, err
	}
	return response, nil
}

func mergeMatchedModules(groups ...[]string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0)
	for _, group := range groups {
		for _, module := range group {
			if module == "" {
				continue
			}
			if _, ok := seen[module]; ok {
				continue
			}
			seen[module] = struct{}{}
			out = append(out, module)
		}
	}
	return out
}

func eventSeverityFor(riskLevel api.RiskLevel, action api.DecisionAction) api.EventSeverity {
	if riskLevel == "L4" || action == "deny" || action == "block" {
		return "critical"
	}
	if riskLevel == "L2" || riskLevel == "L3" || action == "warn" || action == "require_approval" {
		return "warn"
	}
	return "info"
}

func auditColorFor(riskLevel api.RiskLevel, action api.DecisionAction) api.AuditColor {
	if riskLevel == "L4" || action == "deny" || action == "block" {
		return "red"
	}
	if riskLevel == "L3" || action == "require_approval" {
		return "orange"
	}
	if riskLevel == "L2" || action == "warn" {
		return "yellow"
	}
	if riskLevel == "L1" || action == "log_only" {
		return "blue"
	}
	return "neutral"
}
