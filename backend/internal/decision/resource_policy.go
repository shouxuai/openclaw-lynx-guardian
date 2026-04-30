package decision

import "github.com/openclaw/lynx-guardian/backend/internal/api"

func hasDeniedResourcePolicyEvidence(req api.DecisionRequest) bool {
	for _, evidence := range req.ResourceEvidence {
		if !evidence.Allowed {
			return true
		}
	}
	return false
}
