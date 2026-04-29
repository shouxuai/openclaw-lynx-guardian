package decision

import (
	"fmt"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

var installEvidenceRules = []evidenceRule{
	{
		ID:            "install.remote_plugin_tamper",
		Module:        "skill_supply_chain",
		Kind:          "remote_plugin_tamper",
		Source:        "install",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "install request combines remote source with Lynx Guardian plugin mutation",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, text string) bool {
			flatText := text + " " + toolsArgsText(req)
			return containsAny(flatText, "http://", "https://", "unknown", "remote", "远程") &&
				containsAny(flatText, "openclaw-lynx-guardian", "lynx guardian", "插件") &&
				containsAny(flatText, "modify", "modifies", "mutate", "delete", "disable", "tamper", "修改", "删除", "禁用")
		},
	},
	{
		ID:            "install.suspicious_skill_source",
		Module:        "skill_supply_chain",
		Kind:          "suspicious_install_source",
		Source:        "provider",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "skill install source matches suspicious supply-chain indicators",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, text string) bool {
			return containsAny(text, "raw.githubusercontent.com", "gist.github.com", "pastebin", "keylogger", "evil") ||
				containsAny(toolsArgsText(req), "raw.githubusercontent.com", "gist.github.com", "pastebin", "keylogger", "evil")
		},
	},
	{
		ID:         "install.untrusted_remote_source",
		Module:     "skill_supply_chain",
		Kind:       "untrusted_remote_source",
		Source:     "provider",
		Severity:   "warn",
		ScoreDelta: 45,
		Reason:     "skill install uses a remote source that is not known trusted",
		Matcher: func(req api.DecisionRequest, text string) bool {
			return containsAny(text, "http://", "https://", "git clone") ||
				containsAny(toolsArgsText(req), "http://", "https://", "git clone")
		},
	},
}

func toolsArgsText(req api.DecisionRequest) string {
	if len(req.ToolArgs) == 0 {
		return ""
	}
	parts := make([]string, 0, len(req.ToolArgs))
	for key, value := range req.ToolArgs {
		parts = append(parts, key, fmt.Sprint(value))
	}
	return normalizeDecisionText(strings.Join(parts, " "))
}
