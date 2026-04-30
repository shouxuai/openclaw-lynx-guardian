package policy

import (
	"fmt"
	"sort"
	"strings"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

func BuildProviderSafetyWithPolicy(req api.DecisionRequest, overview api.PolicyOverview) map[string]any {
	out := map[string]any{}
	for key, value := range req.ProviderSafety {
		out[key] = value
	}
	out["policyRules"] = overview.Rules
	out["policyVersion"] = overview.CurrentVersion
	return out
}

func BuildResourceEvidence(req api.DecisionRequest, overview api.PolicyOverview) []api.ResourcePolicyEvidence {
	ops := classifyResourceOperations(req)
	if len(ops) == 0 {
		return nil
	}
	text := strings.ToLower(req.Content + " " + req.TargetURI + " " + flattenToolArgs(req.ToolArgs))
	evidence := make([]api.ResourcePolicyEvidence, 0)
	for _, resource := range overview.ProtectedResources {
		if !resource.Enabled || resource.Path == "" {
			continue
		}
		if !strings.Contains(text, strings.ToLower(resource.Path)) {
			continue
		}
		for _, op := range ops {
			allowed := resourceOperationAllowed(resource.Preset, op)
			evidence = append(evidence, api.ResourcePolicyEvidence{
				EvidenceID:    fmt.Sprintf("resource-%s-%s", resource.ResourceID, op),
				ResourceID:    resource.ResourceID,
				MatchedPath:   resource.Path,
				RealPath:      resource.RealPath,
				Preset:        resource.Preset,
				Operation:     op,
				Allowed:       allowed,
				Reason:        resourcePolicyReason(resource.Preset, op, allowed),
				PolicyVersion: overview.CurrentVersion,
			})
		}
	}
	return evidence
}

func resourceOperationAllowed(preset string, operation string) bool {
	switch preset {
	case "deny_all":
		return false
	case "read_only", "no_modify":
		return operation == "read" || operation == "list" || operation == "search"
	case "no_delete":
		return operation != "delete"
	default:
		return true
	}
}

func resourcePolicyReason(preset string, operation string, allowed bool) string {
	if allowed {
		return preset + " permits " + operation
	}
	return preset + " forbids " + operation
}

func classifyResourceOperations(req api.DecisionRequest) []string {
	text := strings.ToLower(req.ToolName + " " + req.Content + " " + req.TargetURI + " " + flattenToolArgs(req.ToolArgs))
	ops := map[string]bool{}
	add := func(op string) { ops[op] = true }
	if containsAny(text, "read", "open", "view", "cat", "type", "get-content", "gc", "head", "tail") {
		add("read")
	}
	if containsAny(text, "ls", "dir", "get-childitem", "gci") {
		add("list")
	}
	if containsAny(text, "rg", "grep", "findstr", "select-string", "find") {
		add("search")
	}
	if containsAny(text, "write", "edit", "apply_patch", "set-content", "add-content", "out-file", "tee", ">") {
		add("write")
	}
	if containsAny(text, "new-item", "mkdir", "touch") {
		add("create")
	}
	if containsAny(text, "mv", "move", "rename", "move-item", "rename-item", "ren") {
		add("rename")
	}
	if containsAny(text, "chmod", "icacls", "set-acl") {
		add("chmod")
	}
	if containsAny(text, "rm", "del", "remove-item", "rmdir", "rd", "unlink") {
		add("delete")
	}
	return sortedKeys(ops)
}

func containsAny(text string, terms ...string) bool {
	for _, term := range terms {
		if strings.Contains(text, term) {
			return true
		}
	}
	return false
}

func sortedKeys(values map[string]bool) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func flattenToolArgs(args map[string]any) string {
	if len(args) == 0 {
		return ""
	}
	keys := make([]string, 0, len(args))
	for key := range args {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(args))
	for _, key := range keys {
		parts = append(parts, key, flattenToolArgValue(args[key]))
	}
	return strings.Join(parts, " ")
}

func flattenToolArgValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			parts = append(parts, flattenToolArgValue(item))
		}
		return strings.Join(parts, " ")
	case map[string]any:
		return flattenToolArgs(typed)
	default:
		return fmt.Sprint(typed)
	}
}
