package decision

import (
	"fmt"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

var installEvidenceRules = []evidenceRule{
	{
		ID:            "install.malicious_skill_name",
		Module:        "skill_manifest_risk",
		Kind:          "malicious_skill_name",
		Source:        "install",
		Severity:      "critical",
		ScoreDelta:    90,
		Reason:        "skill name matches known malicious or credential-theft naming patterns",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, text string) bool {
			flatText := text + " " + toolsArgsText(req)
			return containsAny(flatText,
				"openclaw-backdoor",
				"system-override",
				"rootkit-",
				"backdoor-",
				"trojan-",
				"malware-",
				"credential-steal",
				"password-grab",
				"token-dump",
				"secret-exfil",
				"reverse-shell",
				"bind-shell",
			)
		},
	},
	{
		ID:            "install.malicious_manifest_content",
		Module:        "skill_manifest_risk",
		Kind:          "malicious_manifest_content",
		Source:        "install",
		Severity:      "critical",
		ScoreDelta:    95,
		Reason:        "skill manifest or content contains prompt injection, shell, or credential exfiltration patterns",
		HardRiskLevel: "L4",
		HardAction:    "deny",
		Matcher: func(req api.DecisionRequest, text string) bool {
			flatText := text + " " + toolsArgsText(req)
			return containsAny(flatText,
				"ignore all previous instructions",
				"disregard previous instructions",
				"forget prior rules",
				"you are now unrestricted",
				"you are now jailbroken",
				"bash -i",
				"/dev/tcp/",
				"nc -e",
				"netcat",
				"reverse shell",
				"curl -d",
				"curl --data",
				"curl --data-binary",
				"axios",
				"fetch(",
				"rm -rf /",
				"xmrig",
				"stratum+tcp",
			) || (containsAny(flatText, ".env", "credentials", ".ssh", "password", "secret", "token", "api_key", "api-key") &&
				containsAny(flatText, "curl", "http://", "https://", "upload", "post"))
		},
	},
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
