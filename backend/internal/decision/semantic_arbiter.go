package decision

import (
	"context"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

type semanticArbiter struct{}

func (semanticArbiter) Name() string { return "semantic_intent" }

func (semanticArbiter) Evaluate(
	_ context.Context,
	req api.DecisionRequest,
	_ ChainSummary,
) (api.ArbiterResult, error) {
	text := requestText(req)
	switch {
	case asksSecurityEducationWithoutCode(text):
		return semanticResult("L1", "log_only", 10, "semantic.security_education", "security education request without code generation"), nil
	case asksForProtectedPrompt(text):
		return semanticResult("L4", "deny", 100, "semantic.protected_prompt_extraction", "request asks for protected prompt, developer instruction, or raw safety rules"), nil
	case asksToBypassApproval(text):
		return semanticResult("L3", "require_approval", 70, "semantic.approval_bypass", "request asks to bypass approval or confirmation"), nil
	case asksHiddenExecution(text):
		return semanticResult("L3", "require_approval", 70, "semantic.hidden_execution", "request asks to hide or obfuscate command execution"), nil
	case asksForMaliciousSilentCode(text):
		return semanticResult("L4", "deny", 95, "semantic.malicious_silent_code", "request asks for malicious code with silent collection or upload"), nil
	default:
		return semanticResult("L0", "allow", 0, "semantic.ordinary_business", "ordinary business request"), nil
	}
}

func asksForProtectedPrompt(text string) bool {
	return containsAny(text, "system prompt", "developer instruction", "系统提示", "系统提示词", "开发者指令", "安全规则原文") ||
		(containsAny(text, "管理员", "administrator", "admin") && containsAny(text, "prompt", "规则", "指令"))
}

func asksToBypassApproval(text string) bool {
	return containsAny(text,
		"绕过审批", "跳过授权", "免确认", "不要授权", "别弹", "queren", "shouquan", "shenpi",
		"skip confirmation", "skip authorization", "skip approval", "bypass approval", "bypass authorization",
		"without approval", "without authorization", "do not ask for approval", "don't ask for approval",
	)
}

func asksHiddenExecution(text string) bool {
	return containsAny(text, "base64", "unicode", "拆分命令", "split command") &&
		containsAny(text, "绕过", "规避", "fengkong", "风控", "detector", "检测")
}

func asksForMaliciousSilentCode(text string) bool {
	return containsAny(text, "键盘记录器", "keylogger") &&
		containsAny(text, "静默上传", "silent upload", "偷偷上传", "窃取", "steal")
}

func asksSecurityEducationWithoutCode(text string) bool {
	return containsAny(text, "检测特征", "防护", "识别", "解释") &&
		containsAny(text, "键盘记录器", "keylogger") &&
		containsAny(text, "不要生成代码", "不生成代码", "without code", "no code")
}

func semanticResult(
	riskLevel api.RiskLevel,
	action api.DecisionAction,
	score float64,
	ruleID string,
	reason string,
) api.ArbiterResult {
	return api.ArbiterResult{
		Arbiter:        "semantic_intent",
		RiskLevel:      riskLevel,
		Action:         action,
		Score:          score,
		MatchedModules: []string{moduleFromRuleID(ruleID)},
		Evidence: []api.EvidenceItem{{
			ID:         ruleID,
			Module:     moduleFromRuleID(ruleID),
			Kind:       "semantic_signal",
			Value:      ruleID,
			Severity:   severityForRisk(riskLevel),
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
