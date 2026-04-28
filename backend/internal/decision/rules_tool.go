package decision

import "github.com/openclaw/lynx-guardian/backend/internal/api"

var toolEvidenceRules = []evidenceRule{
	{
		ID:            "tool.credential_path_read",
		Module:        "credential_access",
		Kind:          "credential_path",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "tool call targets credential or private key path",
		AnyTerms:      []string{"id_rsa", ".env", "private key", "api_key", "api key", "token", "credentials"},
		HardRiskLevel: "L4",
		HardAction:    "deny",
	},
	{
		ID:            "tool.plugin_integrity_mutation",
		Module:        "plugin_integrity",
		Kind:          "protected_plugin_mutation",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "tool call mutates protected plugin files",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(_ api.DecisionRequest, text string) bool {
			return containsAny(text, "openclaw-lynx-guardian", "lynx guardian", "插件") &&
				containsAny(text, "delete", "remove", "move", "disable", "删除", "移动", "篡改", "禁用")
		},
	},
	{
		ID:            "tool.config_disable_mutation",
		Module:        "config_integrity",
		Kind:          "disable_config_mutation",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "tool call attempts to disable plugin config",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(_ api.DecisionRequest, text string) bool {
			return containsAny(text, "openclaw.json", "config") &&
				containsAny(text, "disabled", "disable", "false", "禁用", "关闭")
		},
	},
	{
		ID:            "tool.sensitive_source_external_send",
		Module:        "exfiltration",
		Kind:          "sensitive_external_send",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "tool call combines sensitive source with external send target",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(_ api.DecisionRequest, text string) bool {
			return containsAny(text, ".env", "id_rsa", "secret", "token", "客户名单", "退款名单") &&
				containsAny(text, "http://", "https://", "外发", "发送", "upload", "post")
		},
	},
}
