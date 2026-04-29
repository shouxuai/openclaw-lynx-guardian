package decision

import (
	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

var inputEvidenceRules = []evidenceRule{
	{
		ID:            "input.system_prompt_extraction_terms",
		Module:        "prompt_protection",
		Kind:          "protected_prompt",
		Source:        "input",
		Severity:      "critical",
		ScoreDelta:    80,
		Reason:        "input asks for system prompt text",
		AnyTerms:      []string{"system prompt", "系统提示", "系统提示词"},
		HardRiskLevel: "L4",
		HardAction:    "deny",
	},
	{
		ID:            "input.developer_instruction_extraction_terms",
		Module:        "prompt_protection",
		Kind:          "developer_instruction",
		Source:        "input",
		Severity:      "critical",
		ScoreDelta:    80,
		Reason:        "input asks for developer instructions",
		AnyTerms:      []string{"developer instruction", "开发者指令"},
		HardRiskLevel: "L4",
		HardAction:    "deny",
	},
	{
		ID:            "input.security_rule_raw_print_terms",
		Module:        "prompt_protection",
		Kind:          "security_rule",
		Source:        "input",
		Severity:      "critical",
		ScoreDelta:    80,
		Reason:        "input asks to print raw safety rules",
		AnyTerms:      []string{"安全规则原文", "raw safety rules", "security rules raw"},
		HardRiskLevel: "L4",
		HardAction:    "deny",
	},
	{
		ID:            "input.concealed_execution_high_confidence",
		Module:        "concealed_execution",
		Kind:          "encoded_execute_evasion",
		Source:        "input",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "input combines encoded payload, execution sink, and detector evasion",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(_ api.DecisionRequest, text string) bool {
			return detectConcealedIntentGo(text).ScoreDelta >= 4
		},
	},
	{
		ID:            "input.evasive_cn_high_confidence",
		Module:        "evasive_intent_cn",
		Kind:          "high_confidence_combo",
		Source:        "input",
		Severity:      "critical",
		ScoreDelta:    80,
		Reason:        "input combines high-confidence Chinese evasive intent families",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(_ api.DecisionRequest, text string) bool {
			result := detectChineseEvasiveIntentGo(text)
			return result.Detected && result.ScoreDelta >= 3
		},
	},
	{
		ID:         "input.evasive_cn_combo",
		Module:     "evasive_intent_cn",
		Kind:       "family_combo",
		Source:     "input",
		Severity:   "warn",
		ScoreDelta: 10,
		Reason:     "input combines Chinese evasive intent families",
		Matcher: func(_ api.DecisionRequest, text string) bool {
			result := detectChineseEvasiveIntentGo(text)
			return result.Detected && result.ScoreDelta >= 2
		},
	},
	{
		ID:         "input.evasive_cn_low_signal",
		Module:     "evasive_intent_cn",
		Kind:       "low_signal",
		Source:     "input",
		Severity:   "info",
		ScoreDelta: 10,
		Reason:     "input contains low-signal Chinese security or wildcard discussion",
		Matcher: func(_ api.DecisionRequest, text string) bool {
			result := detectChineseEvasiveIntentGo(text)
			return result.Detected && result.ScoreDelta == 1
		},
	},
	{
		ID:         "input.approval_bypass_cn_pinyin",
		Module:     "approval_bypass",
		Kind:       "bypass_terms",
		Source:     "input",
		Severity:   "warn",
		ScoreDelta: 65,
		Reason:     "input asks to bypass approval or confirmation",
		AnyTerms:   []string{"绕过审批", "跳过授权", "免确认", "不要授权", "别弹", "queren", "shouquan", "shenpi"},
	},
	{
		ID:         "input.approval_bypass_terms",
		Module:     "approval_bypass",
		Kind:       "bypass_terms",
		Source:     "input",
		Severity:   "warn",
		ScoreDelta: 65,
		Reason:     "input asks to bypass approval or confirmation",
		AnyTerms: []string{
			"skip confirmation",
			"skip authorization",
			"skip approval",
			"bypass approval",
			"bypass authorization",
			"without approval",
			"without authorization",
			"do not ask for approval",
			"don't ask for approval",
		},
	},
	{
		ID:         "input.hidden_execution_chain",
		Module:     "hidden_execution",
		Kind:       "obfuscation_chain",
		Source:     "input",
		Severity:   "warn",
		ScoreDelta: 70,
		Reason:     "input combines obfuscation with detector or policy evasion",
		Matcher: func(_ api.DecisionRequest, text string) bool {
			return containsAny(text, "base64", "unicode", "拆分命令", "split command") &&
				containsAny(text, "绕过", "规避", "fengkong", "风控", "detector", "检测")
		},
	},
	{
		ID:         "input.warn_signal",
		Module:     "risk_hint",
		Kind:       "warn_without_block",
		Source:     "input",
		Severity:   "warn",
		ScoreDelta: 40,
		Reason:     "input explicitly requests warning/audit without blocking",
		AnyTerms:   []string{"告警记录", "风险提示", "warn", "warning"},
	},
}
