package decision

import "github.com/openclaw/lynx-guardian/backend/internal/api"

var actionPriority = map[api.DecisionAction]int{
	"allow":            0,
	"log_only":         1,
	"warn":             2,
	"redact":           3,
	"require_approval": 4,
	"block":            5,
	"deny":             6,
}

var riskPriority = map[api.RiskLevel]int{
	"L0": 0,
	"L1": 1,
	"L2": 2,
	"L3": 3,
	"L4": 4,
}

func stricterResult(left, right api.ArbiterResult) api.ArbiterResult {
	leftRisk := riskPriority[left.RiskLevel]
	rightRisk := riskPriority[right.RiskLevel]
	if rightRisk > leftRisk {
		return right
	}
	if rightRisk < leftRisk {
		return left
	}
	if actionPriority[right.Action] > actionPriority[left.Action] {
		return right
	}
	return left
}

func finalActionBlocks(action api.DecisionAction) bool {
	return action == "block" || action == "deny"
}

func requiresApproval(action api.DecisionAction) bool {
	return action == "require_approval"
}
