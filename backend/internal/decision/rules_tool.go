package decision

import "github.com/openclaw/lynx-guardian/backend/internal/api"

var toolEvidenceRules = []evidenceRule{
	{
		ID:            "tool.flow.secret_to_external",
		Module:        "exfiltration",
		Kind:          "secret_to_external_target",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    95,
		Reason:        "tool command reads sensitive content and sends it to an external target",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, _ string) bool {
			return toolRuleMatches(req, ChainSummary{}, func(view toolRequestView) bool {
				return hasAnyString(view.SourceKinds, "secret") && hasAnyString(view.SinkKinds, "external_network")
			})
		},
	},
	{
		ID:            "tool.command.download_execute",
		Module:        "remote_code_execution",
		Kind:          "download_execute",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    95,
		Reason:        "tool command downloads remote content and executes it",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, _ string) bool {
			return toolRuleMatches(req, ChainSummary{}, func(view toolRequestView) bool {
				return hasAnyString(view.CommandFlags, "download_execute")
			})
		},
	},
	{
		ID:            "tool.flow.taint_to_external",
		Module:        "exfiltration",
		Kind:          "tainted_external_send",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "tool command sends recently tainted content to an external target",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher:       func(api.DecisionRequest, string) bool { return false },
	},
	{
		ID:            "tool.taint_external_send",
		Module:        "exfiltration",
		Kind:          "taint_to_external_target",
		Source:        "chain",
		Severity:      "critical",
		ScoreDelta:    95,
		Reason:        "chain has recent sensitive taint and current tool sends data externally",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher:       func(api.DecisionRequest, string) bool { return false },
	},
	{
		ID:            "tool.secret_external_send",
		Module:        "exfiltration",
		Kind:          "secret_to_external_target",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    95,
		Reason:        "tool command reads sensitive content and sends it to an external target",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, text string) bool {
			structured := toolRuleMatches(req, ChainSummary{}, func(view toolRequestView) bool {
				return hasAnyString(view.SourceKinds, "secret") && hasAnyString(view.SinkKinds, "external_network")
			})
			return structured || legacySecretExternalSendMatches(req, text)
		},
	},
	{
		ID:            "tool.path.secret",
		Module:        "credential_access",
		Kind:          "credential_path",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "tool call targets credential, private key, or secret material",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, _ string) bool {
			return toolRuleMatches(req, ChainSummary{}, func(view toolRequestView) bool {
				return hasAnyString(view.SourceKinds, "secret") &&
					hasAnyString(view.OperationFamilies, "read", "write", "delete", "move", "chmod", "network_send")
			})
		},
	},
	{
		ID:            "tool.path.plugin_self",
		Module:        "plugin_integrity",
		Kind:          "protected_plugin_mutation",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    95,
		Reason:        "tool call mutates Lynx Guardian or OpenClaw safety configuration",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, _ string) bool {
			return toolRuleMatches(req, ChainSummary{}, func(view toolRequestView) bool {
				return hasAnyString(view.PathKinds, "plugin_self", "openclaw_config") &&
					(hasAnyString(view.OperationFamilies, "write", "delete", "move", "chmod") ||
						hasAnyString(view.CommandFlags, "config_disable"))
			})
		},
	},
	{
		ID:            "tool.op.recursive_delete",
		Module:        "destructive_mutation",
		Kind:          "recursive_delete",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    85,
		Reason:        "tool command recursively deletes sensitive or protected paths",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, _ string) bool {
			return toolRuleMatches(req, ChainSummary{}, func(view toolRequestView) bool {
				return hasAnyString(view.CommandFlags, "recursive_delete") &&
					hasAnyString(view.PathKinds, "plugin_self", "openclaw_config", "secret", "user_home", "system_path")
			})
		},
	},
	{
		ID:            "tool.op.permission_weakening",
		Module:        "permission_integrity",
		Kind:          "permission_weakening",
		Source:        "tool",
		Severity:      "critical",
		ScoreDelta:    80,
		Reason:        "tool command weakens file permissions on sensitive or protected paths",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, _ string) bool {
			return toolRuleMatches(req, ChainSummary{}, func(view toolRequestView) bool {
				return hasAnyString(view.CommandFlags, "permission_weakening") &&
					hasAnyString(view.PathKinds, "plugin_self", "openclaw_config", "secret", "user_home", "system_path")
			})
		},
	},
	{
		ID:         "tool.command.encoded_execution",
		Module:     "concealed_execution",
		Kind:       "encoded_execution",
		Source:     "tool",
		Severity:   "warn",
		ScoreDelta: 70,
		Reason:     "tool command executes encoded or staged command content",
		Matcher: func(req api.DecisionRequest, _ string) bool {
			return toolRuleMatches(req, ChainSummary{}, func(view toolRequestView) bool {
				return hasAnyString(view.CommandFlags, "encoded_execution")
			})
		},
	},
	{
		ID:         "tool.grant.scope_mismatch",
		Module:     "grant_scope",
		Kind:       "grant_scope_mismatch",
		Source:     "tool",
		Severity:   "warn",
		ScoreDelta: 65,
		Reason:     "tool request indicates an approval grant scope mismatch",
		Matcher: func(req api.DecisionRequest, text string) bool {
			return req.Stage == "tool_call" &&
				containsAny(text+" "+toolArgsFlatText(req.ToolArgs), "scope mismatch", "outside grant", "grant mismatch")
		},
	},
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

func legacySecretExternalSendMatches(req api.DecisionRequest, text string) bool {
	flatText := normalizeDecisionText(text + " " + toolArgsFlatText(req.ToolArgs))
	return containsAny(flatText, ".env", "id_rsa", "private key", "api key", "api_key", "token", "客户名单", "退款名单") &&
		containsAny(flatText, "http://", "https://", "curl", "wget", "post", "upload", "发送", "外发")
}
