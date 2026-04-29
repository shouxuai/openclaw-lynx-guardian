package chain

import (
	"context"
	"fmt"
	"strings"
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
	summary, err := s.repository.Get(ctx, input.ChainID)
	if err != nil {
		return api.ChainSummary{}, err
	}
	summary.ChainID = nonEmpty(input.ChainID, summary.ChainID)
	summary.SessionKey = nonEmpty(input.SessionKey, summary.SessionKey)
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
	if shouldClearActiveGrant(input) {
		summary.ActiveGrantID = ""
	}
	clearPendingApproval := shouldClearPendingApproval(input)
	if clearPendingApproval {
		summary.PendingApproval = ""
	}
	if input.RequesterID != "" || input.RequesterOuID != "" {
		summary.RecentIdentity = appendUniqueLimited(summary.RecentIdentity, nonEmpty(input.RequesterOuID, input.RequesterID))
	}
	if input.ToolName != "" {
		summary.RecentTools = appendUniqueLimited(summary.RecentTools, input.ToolName)
	}
	if input.Action == "deny" || input.RiskLevel == "L4" {
		summary.RecentDenials = appendUniqueLimited(summary.RecentDenials, nonEmpty(input.Hook, input.EventType))
	}
	if input.Action == "require_approval" {
		summary.RecentApprovals = appendUniqueLimited(summary.RecentApprovals, nonEmpty(input.Hook, input.EventType))
	}
	if isSensitiveTarget(input.TargetURI) {
		summary.RecentSensitive = appendUniqueLimited(summary.RecentSensitive, input.TargetURI)
	}
	for _, label := range stringSliceFromMetadata(input.Metadata, "taintReadLabels", "taintReads", "recentTaintReads") {
		summary.RecentTaintReads = appendUniqueLimited(summary.RecentTaintReads, label)
	}
	for _, label := range stringSliceFromMetadata(input.Metadata, "evasionSignals", "recentEvasions") {
		summary.RecentEvasions = appendUniqueLimited(summary.RecentEvasions, label)
	}
	if activeGrant := stringFromMetadata(input.Metadata, "activeGrantId", "activeGrantID", "grantId"); activeGrant != "" {
		summary.ActiveGrantID = truncateSignal(activeGrant)
		summary.PendingApproval = ""
		clearPendingApproval = true
	}
	if pendingApproval := pendingApprovalFromInput(input); pendingApproval != "" && !clearPendingApproval {
		summary.PendingApproval = truncateSignal(pendingApproval)
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

func shouldClearPendingApproval(input api.ChainUpdateRequest) bool {
	if isLifecycleEnd(input.EventType) {
		return true
	}
	switch input.EventType {
	case "approval_resolved", "grant_created", "grant_resolved", "grant_issued", "approval_granted", "approval_denied":
		return true
	}
	switch input.Action {
	case "allow", "deny", "block":
		return true
	}
	if stringFromMetadata(input.Metadata, "activeGrantId", "activeGrantID", "grantId") != "" {
		return true
	}
	for _, key := range []string{"approvalResolved", "grantCreated", "clearPendingApproval", "pendingApprovalResolved"} {
		value, ok := input.Metadata[key]
		if !ok {
			continue
		}
		if parsed, ok := value.(bool); ok && parsed {
			return true
		}
		text := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
		if text == "true" || text == "1" || text == "yes" {
			return true
		}
	}
	return false
}

func pendingApprovalFromInput(input api.ChainUpdateRequest) string {
	if input.Action != "require_approval" && !isPendingApprovalEvent(input.EventType) {
		return ""
	}
	return stringFromMetadata(input.Metadata, "pendingApproval", "pendingApprovalId", "approvalId")
}

func isPendingApprovalEvent(eventType string) bool {
	switch eventType {
	case "approval_requested", "pending_approval":
		return true
	default:
		return false
	}
}

func shouldClearActiveGrant(input api.ChainUpdateRequest) bool {
	if isLifecycleEnd(input.EventType) {
		return true
	}
	switch input.EventType {
	case "grant_revoked", "approval_revoked":
		return true
	default:
		return boolFromMetadata(input.Metadata, "grantRevoked", "activeGrantRevoked", "clearActiveGrant")
	}
}

func boolFromMetadata(metadata map[string]any, keys ...string) bool {
	for _, key := range keys {
		value, ok := metadata[key]
		if !ok {
			continue
		}
		if parsed, ok := value.(bool); ok && parsed {
			return true
		}
		switch strings.ToLower(strings.TrimSpace(fmt.Sprint(value))) {
		case "true", "1", "yes", "clear", "cleared":
			return true
		}
	}
	return false
}

func nonEmpty(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func appendUniqueLimited(values []string, next string) []string {
	next = truncateSignal(strings.TrimSpace(next))
	if next == "" {
		return values
	}
	for _, value := range values {
		if value == next {
			return values
		}
	}
	values = append(values, next)
	const maxSignals = 12
	if len(values) > maxSignals {
		return values[len(values)-maxSignals:]
	}
	return values
}

func truncateSignal(value string) string {
	const maxSignalRunes = 160
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= maxSignalRunes {
		return string(runes)
	}
	return string(runes[:maxSignalRunes-3]) + "..."
}

func isSensitiveTarget(value string) bool {
	lower := strings.ToLower(value)
	return strings.Contains(lower, ".env") ||
		strings.Contains(lower, "id_rsa") ||
		strings.Contains(lower, "token") ||
		strings.Contains(lower, "secret") ||
		strings.Contains(lower, "credential")
}

func stringFromMetadata(metadata map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := metadata[key]; ok {
			text := strings.TrimSpace(fmt.Sprint(value))
			if text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

func stringSliceFromMetadata(metadata map[string]any, keys ...string) []string {
	out := make([]string, 0)
	for _, key := range keys {
		value, ok := metadata[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case []string:
			out = append(out, typed...)
		case []any:
			for _, item := range typed {
				text := strings.TrimSpace(fmt.Sprint(item))
				if text != "" && text != "<nil>" {
					out = append(out, text)
				}
			}
		case string:
			if typed != "" {
				out = append(out, typed)
			}
		default:
			text := strings.TrimSpace(fmt.Sprint(value))
			if text != "" && text != "<nil>" {
				out = append(out, text)
			}
		}
	}
	return out
}
