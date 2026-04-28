package grants

import (
	"context"
	"fmt"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

type Service struct {
	repository *repo.GrantRepository
	clock      func() time.Time
}

func NewService(repository *repo.GrantRepository) *Service {
	return &Service{
		repository: repository,
		clock:      time.Now,
	}
}

func (s *Service) CreateAllowCurrentChain(ctx context.Context, input api.ApprovalResolveRequest) (api.Grant, error) {
	now := s.clock().UTC()
	expiresAt := input.ExpiresAt
	if expiresAt == "" {
		expiresAt = now.Add(30 * time.Minute).Format(time.RFC3339Nano)
	}
	scope := copyScope(input.ResourceScope)
	scope["grantType"] = "allow-current-chain"
	scope["approvedRiskLevel"] = input.RiskLevel
	scope["targetKind"] = input.TargetKind
	scope["targetHash"] = input.TargetHash
	scope["toolName"] = input.ToolName

	grant := api.Grant{
		GrantID:        fmt.Sprintf("grant-%s", nonEmpty(input.ApprovalID, fmt.Sprintf("%d", now.UnixNano()))),
		ApprovalID:     input.ApprovalID,
		ChainID:        input.ChainID,
		SessionKey:     input.SessionKey,
		ChannelProfile: input.ChannelProfile,
		ChannelID:      input.ChannelID,
		ConversationID: input.ConversationID,
		RequesterID:    input.RequesterID,
		RequesterOuID:  input.RequesterOuID,
		ApproverID:     input.ApproverID,
		ApproverOuID:   input.ApproverOuID,
		RiskFamily:     input.RiskFamily,
		ToolName:       input.ToolName,
		TargetKind:     input.TargetKind,
		TargetHash:     input.TargetHash,
		ResourceScope:  scope,
		CreatedAt:      now.Format(time.RFC3339Nano),
		ExpiresAt:      expiresAt,
	}
	if err := s.repository.Insert(ctx, grant); err != nil {
		return api.Grant{}, err
	}
	return grant, nil
}

func (s *Service) Check(ctx context.Context, input api.GrantCheckRequest) (api.GrantCheckResult, error) {
	if input.RiskLevel == "L4" {
		return api.GrantCheckResult{Allowed: false, Reason: "new_l4"}, nil
	}

	now := s.clock().UTC().Format(time.RFC3339Nano)
	grant, err := s.repository.FindActiveByChain(ctx, input.ChainID, now)
	if err != nil {
		return api.GrantCheckResult{}, err
	}
	if grant == nil {
		latest, err := s.repository.FindLatestByChain(ctx, input.ChainID)
		if err != nil {
			return api.GrantCheckResult{}, err
		}
		if latest != nil && latest.RevokedAt != "" {
			return api.GrantCheckResult{Allowed: false, GrantID: latest.GrantID, Reason: "revoked", Revoked: true, RevokedReason: latest.RevokedReason}, nil
		}
		return api.GrantCheckResult{Allowed: false, Reason: "no_active_grant"}, nil
	}

	if reason := validateGrant(*grant, input); reason != "" {
		if err := s.repository.Revoke(ctx, grant.GrantID, reason, now); err != nil {
			return api.GrantCheckResult{}, err
		}
		return api.GrantCheckResult{Allowed: false, GrantID: grant.GrantID, Reason: reason, Revoked: true, RevokedReason: reason}, nil
	}

	return api.GrantCheckResult{Allowed: true, GrantID: grant.GrantID}, nil
}

func (s *Service) Revoke(ctx context.Context, input api.RevokeGrantRequest) error {
	reason := nonEmpty(input.Reason, "revoked")
	now := s.clock().UTC().Format(time.RFC3339Nano)
	if input.GrantID != "" {
		return s.repository.Revoke(ctx, input.GrantID, reason, now)
	}
	return s.repository.RevokeActiveByChain(ctx, input.ChainID, reason, now)
}

func (s *Service) RevokeActiveByChain(ctx context.Context, chainID string, reason string) error {
	return s.repository.RevokeActiveByChain(ctx, chainID, reason, s.clock().UTC().Format(time.RFC3339Nano))
}

func validateGrant(grant api.Grant, input api.GrantCheckRequest) string {
	if grant.SessionKey != input.SessionKey {
		return "session_mismatch"
	}
	if grant.ChannelProfile != input.ChannelProfile || grant.ChannelID != input.ChannelID || grant.ConversationID != input.ConversationID {
		return "channel_mismatch"
	}
	if grant.RequesterID != input.RequesterID || grant.RequesterOuID != input.RequesterOuID {
		return "actor_mismatch"
	}
	if grant.TargetKind != input.TargetKind || grant.TargetHash != input.TargetHash {
		return "target_changed"
	}
	if riskOrder(input.RiskLevel) > riskOrder(scopeString(grant.ResourceScope, "approvedRiskLevel")) {
		return "risk_escalation"
	}
	if escalatesOperation(scopeString(grant.ResourceScope, "operationKind"), input.OperationKind) {
		return "risk_escalation"
	}
	if grant.RiskFamily != input.RiskFamily {
		return "risk_escalation"
	}
	return ""
}

func riskOrder(value string) int {
	switch value {
	case "L4":
		return 4
	case "L3":
		return 3
	case "L2":
		return 2
	case "L1":
		return 1
	default:
		return 0
	}
}

func escalatesOperation(approved string, requested string) bool {
	if approved == "" {
		approved = "read"
	}
	if requested == "" {
		requested = approved
	}
	approvedRank := operationRank(approved)
	requestedRank := operationRank(requested)
	return requestedRank > approvedRank
}

func operationRank(value string) int {
	switch value {
	case "delete", "exfil":
		return 3
	case "write":
		return 2
	case "read":
		return 1
	default:
		return 1
	}
}

func scopeString(scope map[string]any, key string) string {
	value, _ := scope[key].(string)
	return value
}

func copyScope(input map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range input {
		out[key] = value
	}
	return out
}

func nonEmpty(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
