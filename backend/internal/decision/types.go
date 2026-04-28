package decision

import (
	"context"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

type ChainSummary struct{}

type Arbiter interface {
	Name() string
	Evaluate(ctx context.Context, req api.DecisionRequest, chain ChainSummary) (api.ArbiterResult, error)
}

type Service struct {
	repo            *repo.DecisionRepository
	semanticArbiter Arbiter
	evidenceArbiter Arbiter
	clock           func() time.Time
}

func NewService(repository *repo.DecisionRepository) *Service {
	return &Service{
		repo:            repository,
		semanticArbiter: semanticArbiter{},
		evidenceArbiter: evidenceArbiter{},
		clock:           time.Now,
	}
}
