package decision

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/remote"
)

type remoteSafetyClient interface {
	Enabled() bool
	CheckContent(ctx context.Context, id string, content string, contentType int) (remote.ContentCheckResponse, error)
	CheckTool(ctx context.Context, id string, content string) (remote.ToolCheckResponse, error)
	CheckSkill(ctx context.Context, id string, skillName string, skillHash string) (remote.SkillCheckResponse, error)
}

type remoteSafetyReporter interface {
	PushRecord(ctx context.Context, id string, content string, riskLevel int) (remote.PushRecordResponse, error)
}

type remoteSafetyArbiter struct {
	client remoteSafetyClient
}

func (remoteSafetyArbiter) Name() string { return "remote_safety" }

func (r remoteSafetyArbiter) Evaluate(ctx context.Context, req api.DecisionRequest, _ ChainSummary) (api.ArbiterResult, error) {
	if r.client == nil || !r.client.Enabled() {
		return remoteUnavailableResult("remote safety disabled"), nil
	}

	id := strings.TrimSpace(req.RequesterID)
	if id == "" {
		id = "anonymous"
	}

	switch req.Stage {
	case "install":
		response, err := r.client.CheckSkill(ctx, id, remoteSkillName(req), remoteSkillHash(req))
		if err != nil {
			return remoteUnavailableResult(err.Error()), nil
		}
		return remoteSkillResult(response), nil
	case "tool_call":
		response, err := r.client.CheckTool(ctx, id, remoteToolContent(req))
		if err != nil {
			return remoteUnavailableResult(err.Error()), nil
		}
		return remoteToolResult(response), nil
	case "assistant_output", "outbound_message", "tool_result", "output":
		response, err := r.client.CheckContent(ctx, id, req.Content, 2)
		if err != nil {
			return remoteUnavailableResult(err.Error()), nil
		}
		return remoteContentResult(response, "remote:content_check", "remote.content_check.risk_level"), nil
	default:
		response, err := r.client.CheckContent(ctx, id, req.Content, 1)
		if err != nil {
			return remoteUnavailableResult(err.Error()), nil
		}
		return remoteContentResult(response, "remote:content_check", "remote.content_check.risk_level"), nil
	}
}

func (r remoteSafetyArbiter) ReportDecision(ctx context.Context, req api.DecisionRequest, response api.DecisionResponse) {
	reporter, ok := r.client.(remoteSafetyReporter)
	if !ok || reporter == nil || !r.client.Enabled() {
		return
	}
	if response.RiskLevel == "L0" || response.RiskLevel == "L1" {
		return
	}
	id := strings.TrimSpace(req.RequesterID)
	if id == "" {
		id = "anonymous"
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		content = strings.TrimSpace(strings.Join([]string{req.ToolName, req.TargetURI}, " "))
	}
	if content == "" {
		content = string(req.Stage)
	}
	_, _ = reporter.PushRecord(ctx, id, content, legacyRemoteRiskLevel(response.RiskLevel))
}

func remoteToolContent(req api.DecisionRequest) string {
	if strings.TrimSpace(req.Content) != "" {
		return req.Content
	}
	parts := []string{req.ToolName, req.TargetURI}
	return strings.TrimSpace(strings.Join(parts, " "))
}

var openclawInstallCommandPattern = regexp.MustCompile(`(?i)\bopenclaw\s+(?:plugins?\s+)?install\s+([^\s;&|]+)`)

func remoteSkillName(req api.DecisionRequest) string {
	for _, key := range []string{"skillName", "name", "skillId", "id"} {
		if value := stringToolArg(req.ToolArgs, key); value != "" {
			return value
		}
	}
	if command := stringToolArg(req.ToolArgs, "command"); command != "" {
		if match := openclawInstallCommandPattern.FindStringSubmatch(command); len(match) > 1 {
			return strings.TrimSpace(match[1])
		}
	}
	if target := strings.TrimSpace(req.TargetURI); target != "" {
		return target
	}
	return "unknown"
}

func remoteSkillHash(req api.DecisionRequest) string {
	for _, key := range []string{"skillHash", "hash", "currentHash"} {
		if value := stringToolArg(req.ToolArgs, key); value != "" {
			return value
		}
	}
	return ""
}

func stringToolArg(args map[string]any, key string) string {
	if len(args) == 0 {
		return ""
	}
	value, ok := args[key]
	if !ok {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}

func legacyRemoteRiskLevel(level api.RiskLevel) int {
	switch level {
	case "L4":
		return 4
	case "L3":
		return 3
	case "L2":
		return 2
	case "L1":
		return 1
	default:
		return 0
	}
}

func remoteContentResult(response remote.ContentCheckResponse, module string, ruleID string) api.ArbiterResult {
	level := response.Result.RiskLevel
	riskLevel, action, score := remoteRiskMapping(level)
	reason := remoteReason(level, response.Message)
	return api.ArbiterResult{
		Arbiter:        "remote_safety",
		RiskLevel:      riskLevel,
		Action:         action,
		Score:          score,
		MatchedModules: remoteModules(level, module),
		Evidence:       remoteEvidence(level, module, ruleID, riskLevel, score),
		ScoreBreakdown: remoteScoreBreakdown(level, ruleID, score, reason),
		Reason:         reason,
	}
}

func remoteToolResult(response remote.ToolCheckResponse) api.ArbiterResult {
	level := response.Result.RiskLevel
	riskLevel, action, score := remoteRiskMapping(level)
	reason := remoteReason(level, response.Message)
	const module = "remote:tool_check"
	const ruleID = "remote.tool_check.risk_level"
	return api.ArbiterResult{
		Arbiter:        "remote_safety",
		RiskLevel:      riskLevel,
		Action:         action,
		Score:          score,
		MatchedModules: remoteModules(level, module),
		Evidence:       remoteEvidence(level, module, ruleID, riskLevel, score),
		ScoreBreakdown: remoteScoreBreakdown(level, ruleID, score, reason),
		Reason:         reason,
	}
}

func remoteSkillResult(response remote.SkillCheckResponse) api.ArbiterResult {
	level := response.Result.RiskLevel
	riskLevel, action, score := remoteRiskMapping(level)
	reason := response.Result.Reason
	if strings.TrimSpace(reason) == "" {
		reason = response.Message
	}
	reason = remoteReason(level, reason)
	const module = "remote:skill_check"
	const ruleID = "remote.skill_check.risk_level"
	return api.ArbiterResult{
		Arbiter:        "remote_safety",
		RiskLevel:      riskLevel,
		Action:         action,
		Score:          score,
		MatchedModules: remoteModules(level, module),
		Evidence:       remoteEvidence(level, module, ruleID, riskLevel, score),
		ScoreBreakdown: remoteScoreBreakdown(level, ruleID, score, reason),
		Reason:         reason,
	}
}

func remoteUnavailableResult(reason string) api.ArbiterResult {
	if strings.TrimSpace(reason) == "" {
		reason = "remote safety unavailable"
	}
	if !strings.Contains(strings.ToLower(reason), "remote safety") {
		reason = "remote safety unavailable: " + reason
	}
	return api.ArbiterResult{
		Arbiter:        "remote_safety",
		RiskLevel:      "L0",
		Action:         "allow",
		Score:          0,
		MatchedModules: nil,
		Evidence:       nil,
		ScoreBreakdown: nil,
		Reason:         reason,
	}
}

func remoteRiskMapping(level int) (api.RiskLevel, api.DecisionAction, float64) {
	switch {
	case level >= 4:
		return "L4", "deny", 95
	case level == 3:
		return "L3", "require_approval", 70
	case level == 2:
		return "L2", "warn", 40
	case level == 1:
		return "L1", "log_only", 15
	default:
		return "L0", "allow", 0
	}
}

func remoteModules(level int, module string) []string {
	if level <= 0 {
		return nil
	}
	return []string{module}
}

func remoteEvidence(level int, module string, ruleID string, riskLevel api.RiskLevel, score float64) []api.EvidenceItem {
	if level <= 0 {
		return nil
	}
	return []api.EvidenceItem{{
		ID:         ruleID,
		Module:     module,
		Kind:       "remote_risk_level",
		Value:      fmt.Sprintf("%d", level),
		Severity:   severityForRisk(riskLevel),
		ScoreDelta: score,
		Source:     "remote",
	}}
}

func remoteScoreBreakdown(level int, ruleID string, score float64, reason string) []api.ScoreBreakdown {
	if level <= 0 {
		return nil
	}
	return []api.ScoreBreakdown{{
		RuleID: ruleID,
		Label:  "Remote safety risk level",
		Delta:  score,
		Reason: reason,
	}}
}

func remoteReason(level int, message string) string {
	if strings.TrimSpace(message) != "" {
		return fmt.Sprintf("remote safety returned risk_level=%d: %s", level, message)
	}
	return fmt.Sprintf("remote safety returned risk_level=%d", level)
}
