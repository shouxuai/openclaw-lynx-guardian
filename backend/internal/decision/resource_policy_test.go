package decision

import (
	"testing"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
)

func TestHasDeniedResourcePolicyEvidence(t *testing.T) {
	req := api.DecisionRequest{
		ResourceEvidence: []api.ResourcePolicyEvidence{
			{Allowed: true},
			{Allowed: false},
		},
	}

	if !hasDeniedResourcePolicyEvidence(req) {
		t.Fatalf("expected denied resource evidence to match")
	}
}

func TestHasDeniedResourcePolicyEvidenceIgnoresAllowedOnly(t *testing.T) {
	req := api.DecisionRequest{
		ResourceEvidence: []api.ResourcePolicyEvidence{
			{Allowed: true},
		},
	}

	if hasDeniedResourcePolicyEvidence(req) {
		t.Fatalf("unexpected denied resource evidence match")
	}
}
