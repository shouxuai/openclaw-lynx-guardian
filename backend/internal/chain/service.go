package chain

import (
	"context"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/grants"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

type Service struct {
	repository *repo.ChainRepository
	grants     *grants.Service
	clock      func() time.Time
}

func NewService(repository *repo.ChainRepository, grantService *grants.Service) *Service {
	return &Service{
		repository: repository,
		grants:     grantService,
		clock:      time.Now,
	}
}

func (s *Service) Update(ctx context.Context, input api.ChainUpdateRequest) (api.ChainSummary, error) {
	now := s.clock().UTC().Format(time.RFC3339Nano)
	summary := api.ChainSummary{
		ChainID:    input.ChainID,
		SessionKey: input.SessionKey,
	}
	appendSignals(&summary, input)

	if err := s.repository.Upsert(ctx, input, summary, now); err != nil {
		return api.ChainSummary{}, err
	}
	if err := s.repository.AppendEvent(ctx, input, now); err != nil {
		return api.ChainSummary{}, err
	}
	if isLifecycleEnd(input.EventType) {
		if err := s.grants.RevokeActiveByChain(ctx, input.ChainID, input.EventType); err != nil {
			return api.ChainSummary{}, err
		}
	}
	return summary, nil
}

func appendSignals(summary *api.ChainSummary, input api.ChainUpdateRequest) {
	if input.RequesterID != "" || input.RequesterOuID != "" {
		summary.RecentIdentity = append(summary.RecentIdentity, nonEmpty(input.RequesterOuID, input.RequesterID))
	}
	if input.ToolName != "" {
		summary.RecentTools = append(summary.RecentTools, input.ToolName)
	}
	if input.Action == "deny" || input.RiskLevel == "L4" {
		summary.RecentDenials = append(summary.RecentDenials, input.Hook)
	}
	if input.Action == "require_approval" {
		summary.RecentApprovals = append(summary.RecentApprovals, input.Hook)
	}
}

func isLifecycleEnd(eventType string) bool {
	switch eventType {
	case "agent_end", "session_end", "subagent_ended", "chain_complete":
		return true
	default:
		return false
	}
}

func nonEmpty(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
