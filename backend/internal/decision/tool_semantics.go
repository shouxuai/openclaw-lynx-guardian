package decision

import "github.com/openclaw/lynx-guardian/backend/internal/api"

func evaluateToolSemantic(req api.DecisionRequest, chain ChainSummary) (api.ArbiterResult, bool) {
	if req.Stage != "tool_call" {
		return api.ArbiterResult{}, false
	}
	view := buildToolRequestView(req)
	switch {
	case hasAnyString(view.CommandFlags, "download_execute"):
		return semanticResult("L4", "deny", 100, "fetch_execute", "tool fetches remote code and executes it"), true
	case hasAnyString(view.PathKinds, "plugin_self", "openclaw_config") &&
		(hasAnyString(view.OperationFamilies, "write", "delete", "move", "chmod") || hasAnyString(view.CommandFlags, "config_disable")):
		return semanticResult("L4", "deny", 100, "self_protection_tamper", "tool mutates Lynx Guardian or OpenClaw safety configuration"), true
	case hasAnyString(view.SourceKinds, "secret") && hasAnyString(view.SinkKinds, "external_network"):
		return semanticResult("L4", "deny", 100, "secret_external_send", "tool sends secret or credential material to an external sink"), true
	case len(chain.RecentTaintReads) > 0 && hasAnyString(view.SinkKinds, "external_network"):
		return semanticResult("L4", "deny", 95, "tainted_external_send", "tool sends previously tainted data to an external sink"), true
	case hasAnyString(view.CommandFlags, "encoded_execution"):
		return semanticResult("L3", "require_approval", 75, "encoded_execution", "tool executes encoded or staged command content"), true
	case hasAnyString(view.CommandFlags, "recursive_delete") && hasAnyString(view.PathKinds, "plugin_self", "openclaw_config", "secret", "user_home", "system_path"):
		return semanticResult("L4", "deny", 95, "destructive_mutation", "tool performs destructive mutation on protected or sensitive paths"), true
	case view.ToolFamily == "shell" && hasAnyString(view.OperationFamilies, "execute") && hasAnyString(view.OperationFamilies, "network_fetch"):
		return semanticResult("L2", "warn", 45, "network_fetch", "tool fetches network content during command execution"), true
	default:
		return api.ArbiterResult{}, false
	}
}
