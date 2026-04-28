package decision

import (
	"regexp"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

var cnResidentIDPattern = regexp.MustCompile(`\b[1-9]\d{5}(18|19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b`)

var outputEvidenceRules = []evidenceRule{
	{
		ID:            "output.private_key_leak",
		Module:        "secret_leak",
		Kind:          "private_key",
		Source:        "output",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "output contains private key material",
		AnyTerms:      []string{"-----begin", "private key"},
		HardRiskLevel: "L4",
		HardAction:    "deny",
	},
	{
		ID:            "output.api_key_leak",
		Module:        "secret_leak",
		Kind:          "api_key",
		Source:        "output",
		Severity:      "critical",
		ScoreDelta:    85,
		Reason:        "output contains API key material",
		AnyTerms:      []string{"api_key", "api key", "bearer ", "sk-"},
		HardRiskLevel: "L4",
		HardAction:    "deny",
	},
	{
		ID:            "output.cn_resident_id_leak",
		Module:        "pii_leak",
		Kind:          "resident_id",
		Source:        "output",
		Severity:      "critical",
		ScoreDelta:    85,
		Reason:        "output contains Chinese resident ID number",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, text string) bool {
			return cnResidentIDPattern.MatchString(req.Content) ||
				(cnResidentIDPattern.MatchString(text) && containsAny(text, "住址", "地址"))
		},
	},
	{
		ID:            "output.system_prompt_raw_leak",
		Module:        "prompt_protection",
		Kind:          "system_prompt_raw",
		Source:        "output",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "output contains raw protected prompt text",
		AnyTerms:      []string{"system prompt", "developer instruction", "系统提示词", "开发者指令", "安全规则原文"},
		HardRiskLevel: "L4",
		HardAction:    "deny",
	},
}
