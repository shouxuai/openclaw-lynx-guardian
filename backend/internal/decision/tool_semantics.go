package decision

import "github.com/openclaw/lynx-guardian/backend/internal/api"

func evaluateToolSemantic(req api.DecisionRequest, chain ChainSummary) (api.ArbiterResult, bool) {
	if req.Stage != "tool_call" {
		return api.ArbiterResult{}, false
	}
	view := buildToolRequestView(req)
	switch {
	case hasAnyString(view.CommandFlags, "download_execute"):
		return toolSemanticResult("L4", "deny", 100, "tool.semantic.fetch_execute", "fetch_execute", "tool fetches remote code and executes it"), true
	case hasAnyString(view.PathKinds, "plugin_self", "openclaw_config") &&
		(hasAnyString(view.OperationFamilies, "write", "delete", "move", "chmod") || hasAnyString(view.CommandFlags, "config_disable")):
		return toolSemanticResult("L4", "deny", 100, "tool.semantic.self_protection_tamper", "self_protection_tamper", "tool mutates Lynx Guardian or OpenClaw safety configuration"), true
	case hasAnyString(view.SourceKinds, "secret") && hasAnyString(view.SinkKinds, "external_network"):
		return toolSemanticResult("L4", "deny", 100, "tool.semantic.secret_external_send", "secret_external_send", "tool sends secret or credential material to an external sink"), true
	case len(chain.RecentTaintReads) > 0 && hasAnyString(view.SinkKinds, "external_network"):
		return toolSemanticResult("L4", "deny", 95, "tool.semantic.tainted_external_send", "tainted_external_send", "tool sends previously tainted data to an external sink"), true
	case hasAnyString(view.CommandFlags, "encoded_execution"):
		return toolSemanticResult("L3", "require_approval", 75, "tool.semantic.encoded_execution", "encoded_execution", "tool executes encoded or staged command content"), true
	case hasAnyString(view.CommandFlags, "recursive_delete") && hasAnyString(view.PathKinds, "plugin_self", "openclaw_config", "secret", "user_home", "system_path"):
		return toolSemanticResult("L4", "deny", 95, "tool.semantic.destructive_mutation", "destructive_mutation", "tool performs destructive mutation on protected or sensitive paths"), true
	case view.ToolFamily == "shell" && hasAnyString(view.OperationFamilies, "execute") && hasAnyString(view.OperationFamilies, "network_fetch"):
		return toolSemanticResult("L2", "warn", 45, "tool.semantic.network_fetch", "network_fetch", "tool fetches network content during command execution"), true
	default:
		return api.ArbiterResult{}, false
	}
}

func toolSemanticResult(
	riskLevel api.RiskLevel,
	action api.DecisionAction,
	score float64,
	ruleID string,
	module string,
	reason string,
) api.ArbiterResult {
	result := semanticResult(riskLevel, action, score, ruleID, reason)
	result.MatchedModules = []string{module}
	for index := range result.Evidence {
		result.Evidence[index].Module = module
	}
	return result
}
