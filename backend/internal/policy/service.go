package policy

import (
	"context"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

type Service struct {
	repository *repo.PolicyRepository
}

func NewService(repository *repo.PolicyRepository) *Service {
	return &Service{repository: repository}
}

func (s *Service) EnrichDecisionRequest(ctx context.Context, req api.DecisionRequest) (api.DecisionRequest, error) {
	if s == nil || s.repository == nil {
		return req, nil
	}
	overview, err := s.repository.Overview(ctx)
	if err != nil {
		return req, err
	}
	req.PolicyVersion = overview.CurrentVersion
	req.ProviderSafety = BuildProviderSafetyWithPolicy(req, overview)
	req.ResourceEvidence = append(req.ResourceEvidence, BuildResourceEvidence(req, overview)...)
	taintEvidence, err := s.repository.MatchingScriptTaintEvidence(ctx, req)
	if err != nil {
		return req, err
	}
	req.ScriptEvidence = append(req.ScriptEvidence, taintEvidence...)
	return req, nil
}

func (s *Service) InsertScriptFindings(ctx context.Context, decisionID string, req api.DecisionRequest) error {
	if s == nil || s.repository == nil {
		return nil
	}
	return s.repository.InsertScriptFindings(ctx, decisionID, req)
}
