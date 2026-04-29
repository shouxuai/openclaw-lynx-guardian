package tasks

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/api"
	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

var ErrNotFound = errors.New("lynx check task not found")

const (
	LynxCheckCreated             = "created"
	LynxCheckQueued              = "queued"
	LynxCheckCollecting          = "collecting"
	LynxCheckAnalyzing           = "analyzing"
	LynxCheckReportSkeletonReady = "report_skeleton_ready"
	LynxCheckAwaitingLLMReport   = "awaiting_llm_report"
	LynxCheckDelivering          = "delivering"
	LynxCheckCompleted           = "completed"
	LynxCheckFailed              = "failed"
	LynxCheckCancelled           = "cancelled"
)

type LynxCheckService struct {
	repository *repo.LynxCheckTaskRepository
	clock      func() time.Time
}

func NewLynxCheckService(repository *repo.LynxCheckTaskRepository) *LynxCheckService {
	return &LynxCheckService{
		repository: repository,
		clock:      time.Now,
	}
}

func (s *LynxCheckService) Start(ctx context.Context, input api.LynxCheckTaskStartRequest) (api.LynxCheckTask, error) {
	now := s.clock().UTC().Format(time.RFC3339Nano)
	requestID := input.RequestID
	if requestID == "" {
		requestID = fmt.Sprintf("lynx-check-%d", s.clock().UTC().UnixNano())
	}
	trigger := normalizeTrigger(input.Trigger)
	task := api.LynxCheckTask{
		RequestID:           requestID,
		Trigger:             trigger,
		Source:              nonEmpty(input.Source, trigger),
		RequesterID:         input.RequesterID,
		SessionKey:          input.SessionKey,
		TargetKey:           input.TargetKey,
		PreferredTargetKind: preferredTargetKind(trigger, input.TargetKey),
		Status:              LynxCheckCreated,
		Facts:               cloneMap(input.Facts),
		EvidenceBundle:      cloneMap(input.EvidenceBundle),
		ReportSkeleton:      input.ReportSkeleton,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if err := s.repository.Upsert(ctx, task); err != nil {
		return api.LynxCheckTask{}, err
	}
	return s.repository.Get(ctx, requestID)
}

func (s *LynxCheckService) ApplyEvent(
	ctx context.Context,
	requestID string,
	input api.LynxCheckTaskEventRequest,
) (api.LynxCheckTask, error) {
	current, err := s.repository.Get(ctx, requestID)
	if err != nil {
		return api.LynxCheckTask{}, err
	}
	if current.RequestID == "" {
		return api.LynxCheckTask{}, ErrNotFound
	}

	nextStatus := normalizeStatus(nonEmpty(input.Status, input.EventType))
	if nextStatus == "" {
		nextStatus = current.Status
	}
	if isTerminal(current.Status) && nextStatus != current.Status {
		return current, nil
	}
	if !canTransition(current.Status, nextStatus) {
		return api.LynxCheckTask{}, fmt.Errorf("invalid lynx check transition %s -> %s", current.Status, nextStatus)
	}

	now := s.clock().UTC().Format(time.RFC3339Nano)
	current.Status = nextStatus
	current.UpdatedAt = now
	current.Facts = mergeMaps(current.Facts, input.Facts)
	current.EvidenceBundle = mergeMaps(current.EvidenceBundle, input.EvidenceBundle)
	if input.ReportSkeleton != "" {
		current.ReportSkeleton = input.ReportSkeleton
	}
	if input.DeliveryChannel != "" {
		current.DeliveryChannel = input.DeliveryChannel
	}
	if input.DeliveryTarget != "" {
		current.DeliveryTarget = input.DeliveryTarget
	}
	if input.DeliveryStatus != "" {
		current.DeliveryStatus = input.DeliveryStatus
	}
	if input.DeliveryError != "" {
		current.DeliveryError = input.DeliveryError
		current.ErrorMessage = input.DeliveryError
	}
	if input.ErrorMessage != "" {
		current.ErrorMessage = input.ErrorMessage
		current.DeliveryError = input.ErrorMessage
	}
	if nextStatus == LynxCheckDelivering && current.DeliveredAt == "" {
		current.DeliveredAt = now
	}
	if isTerminal(nextStatus) {
		current.CompletedAt = now
	}

	if err := s.repository.Upsert(ctx, current); err != nil {
		return api.LynxCheckTask{}, err
	}
	if len(input.Evidence) > 0 {
		if err := s.repository.AppendEvidence(ctx, requestID, input.Evidence, now); err != nil {
			return api.LynxCheckTask{}, err
		}
	}
	return s.repository.Get(ctx, requestID)
}

func normalizeTrigger(value string) string {
	switch value {
	case "scheduled", "scheduled_lynx_check":
		return "scheduled"
	default:
		return "manual"
	}
}

func normalizeStatus(value string) string {
	switch value {
	case LynxCheckCreated, LynxCheckQueued, LynxCheckCollecting, LynxCheckAnalyzing,
		LynxCheckReportSkeletonReady, LynxCheckAwaitingLLMReport, LynxCheckDelivering,
		LynxCheckCompleted, LynxCheckFailed, LynxCheckCancelled:
		return value
	case "running":
		return LynxCheckCollecting
	case "delivery":
		return LynxCheckDelivering
	case "complete":
		return LynxCheckCompleted
	case "fail":
		return LynxCheckFailed
	default:
		return ""
	}
}

func canTransition(from string, to string) bool {
	if from == to {
		return true
	}
	if isTerminal(from) {
		return false
	}
	switch from {
	case LynxCheckCreated:
		return allow(to, LynxCheckQueued, LynxCheckCollecting, LynxCheckAnalyzing, LynxCheckReportSkeletonReady, LynxCheckAwaitingLLMReport, LynxCheckDelivering, LynxCheckCompleted, LynxCheckFailed, LynxCheckCancelled)
	case LynxCheckQueued:
		return allow(to, LynxCheckCollecting, LynxCheckAnalyzing, LynxCheckFailed, LynxCheckCancelled)
	case LynxCheckCollecting:
		return allow(to, LynxCheckAnalyzing, LynxCheckReportSkeletonReady, LynxCheckAwaitingLLMReport, LynxCheckDelivering, LynxCheckCompleted, LynxCheckFailed, LynxCheckCancelled)
	case LynxCheckAnalyzing:
		return allow(to, LynxCheckReportSkeletonReady, LynxCheckAwaitingLLMReport, LynxCheckDelivering, LynxCheckCompleted, LynxCheckFailed, LynxCheckCancelled)
	case LynxCheckReportSkeletonReady:
		return allow(to, LynxCheckAwaitingLLMReport, LynxCheckDelivering, LynxCheckCompleted, LynxCheckFailed, LynxCheckCancelled)
	case LynxCheckAwaitingLLMReport:
		return allow(to, LynxCheckDelivering, LynxCheckCompleted, LynxCheckFailed, LynxCheckCancelled)
	case LynxCheckDelivering:
		return allow(to, LynxCheckCompleted, LynxCheckFailed, LynxCheckCancelled)
	default:
		return from == "" && to == LynxCheckCreated
	}
}

func allow(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func isTerminal(status string) bool {
	return status == LynxCheckCompleted || status == LynxCheckFailed || status == LynxCheckCancelled
}

func preferredTargetKind(trigger string, targetKey string) string {
	if targetKey == "recent" || trigger == "scheduled" {
		return "recent"
	}
	return "current"
}

func mergeMaps(base map[string]any, updates map[string]any) map[string]any {
	out := cloneMap(base)
	if out == nil {
		out = map[string]any{}
	}
	for key, value := range updates {
		out[key] = value
	}
	return out
}

func cloneMap(input map[string]any) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(input))
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
