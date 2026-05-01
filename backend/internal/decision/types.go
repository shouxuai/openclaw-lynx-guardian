package decision

import (
	"context"
	"encoding/json"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

type ChainSummary struct {
	api.ChainSummary
	TaintSummary map[string]any
	Raw          map[string]any
}

type Arbiter interface {
	Name() string
	Evaluate(ctx context.Context, req api.DecisionRequest, chain ChainSummary) (api.ArbiterResult, error)
}

type Service struct {
	repo            *repo.DecisionRepository
	semanticArbiter Arbiter
	evidenceArbiter Arbiter
	remoteArbiter   Arbiter
	clock           func() time.Time
}

type ServiceOptions struct {
	RemoteSafetyClient remoteSafetyClient
}

func NewService(repository *repo.DecisionRepository) *Service {
	return NewServiceWithOptions(repository, ServiceOptions{})
}

func NewServiceWithOptions(repository *repo.DecisionRepository, options ServiceOptions) *Service {
	return &Service{
		repo:            repository,
		semanticArbiter: semanticArbiter{},
		evidenceArbiter: evidenceArbiter{},
		remoteArbiter:   remoteSafetyArbiter{client: options.RemoteSafetyClient},
		clock:           time.Now,
	}
}

func ChainSummaryFromRequest(req api.DecisionRequest) ChainSummary {
	summary := ChainSummary{
		TaintSummary: req.TaintSummary,
		Raw:          req.ChainSummary,
	}
	if len(req.ChainSummary) == 0 {
		return summary
	}
	data, err := json.Marshal(req.ChainSummary)
	if err != nil {
		return summary
	}
	_ = json.Unmarshal(data, &summary.ChainSummary)
	return summary
}

func MergeChainSummaries(persisted ChainSummary, request ChainSummary) ChainSummary {
	merged := persisted
	merged.RecentIdentity = mergeStringSignals(merged.RecentIdentity, request.RecentIdentity)
	merged.RecentSensitive = mergeStringSignals(merged.RecentSensitive, request.RecentSensitive)
	merged.RecentDenials = mergeStringSignals(merged.RecentDenials, request.RecentDenials)
	merged.RecentApprovals = mergeStringSignals(merged.RecentApprovals, request.RecentApprovals)
	merged.RecentTools = mergeStringSignals(merged.RecentTools, request.RecentTools)
	merged.RecentTaintReads = mergeStringSignals(merged.RecentTaintReads, request.RecentTaintReads)
	merged.RecentEvasions = mergeStringSignals(merged.RecentEvasions, request.RecentEvasions)
	if request.ChainID != "" {
		merged.ChainID = request.ChainID
	}
	if request.SessionKey != "" {
		merged.SessionKey = request.SessionKey
	}
	if request.ActiveGrantID != "" {
		merged.ActiveGrantID = request.ActiveGrantID
	}
	if request.PendingApproval != "" {
		merged.PendingApproval = request.PendingApproval
	}
	merged.TaintSummary = mergeMaps(persisted.TaintSummary, request.TaintSummary)
	merged.Raw = request.Raw
	return merged
}

func mergeStringSignals(base []string, additions []string) []string {
	out := append([]string{}, base...)
	seen := map[string]struct{}{}
	for _, value := range out {
		if value != "" {
			seen[value] = struct{}{}
		}
	}
	for _, value := range additions {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	const maxSignals = 12
	if len(out) > maxSignals {
		return out[len(out)-maxSignals:]
	}
	return out
}

func mergeMaps(base map[string]any, additions map[string]any) map[string]any {
	if len(base) == 0 && len(additions) == 0 {
		return nil
	}
	out := map[string]any{}
	for key, value := range base {
		out[key] = value
	}
	for key, value := range additions {
		out[key] = value
	}
	return out
}
