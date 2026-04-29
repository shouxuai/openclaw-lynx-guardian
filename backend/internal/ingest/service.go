package ingest

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/openclaw/lynx-guardian/backend/internal/repo"
)

const schemaVersion = "lynx-server.ingest.v1"

type Service struct {
	repository *repo.IngestRepository
	now        func() int64
}

type BatchResult struct {
	OK             bool           `json:"ok"`
	SchemaVersion  string         `json:"schemaVersion"`
	BatchID        string         `json:"batchId"`
	AcceptedCount  int            `json:"acceptedCount"`
	PersistedCount int            `json:"persistedCount"`
	DuplicateCount int            `json:"duplicateCount"`
	RejectedCount  int            `json:"rejectedCount"`
	RejectedItems  []RejectedItem `json:"rejectedItems"`
	ServerTimeMs   int64          `json:"serverTimeMs"`
}

type RejectedItem struct {
	ItemIndex int    `json:"itemIndex"`
	Kind      string `json:"kind"`
	Code      string `json:"code"`
	Message   string `json:"message"`
}

type rawBatch struct {
	SchemaVersion string            `json:"schemaVersion"`
	Producer      rawProducer       `json:"producer"`
	SentAtMs      *int64            `json:"sentAtMs"`
	BatchID       string            `json:"batchId"`
	Items         []json.RawMessage `json:"items"`
}

type rawProducer struct {
	PluginID string `json:"pluginId"`
}

type rawItemBase struct {
	Kind         string          `json:"kind"`
	ItemID       string          `json:"itemId"`
	OccurredAtMs *int64          `json:"occurredAtMs"`
	Data         json.RawMessage `json:"data"`
}

type validItem struct {
	kind    string
	persist func(*sql.Tx, int64) (repo.PersistResult, error)
}

func NewService(repository *repo.IngestRepository) *Service {
	return &Service{
		repository: repository,
		now:        func() int64 { return time.Now().UnixMilli() },
	}
}

func (s *Service) ProcessBatch(payload []byte) (BatchResult, error) {
	return s.processBatch(payload, nil)
}

func (s *Service) ProcessBatchForKinds(payload []byte, allowedKinds ...string) (BatchResult, error) {
	kinds := make(map[string]struct{}, len(allowedKinds))
	for _, kind := range allowedKinds {
		kinds[kind] = struct{}{}
	}
	return s.processBatch(payload, kinds)
}

func (s *Service) processBatch(payload []byte, allowedKinds map[string]struct{}) (BatchResult, error) {
	var batch rawBatch
	if err := json.Unmarshal(payload, &batch); err != nil {
		return BatchResult{}, err
	}
	if batch.SchemaVersion != schemaVersion {
		return BatchResult{}, fmt.Errorf("invalid schemaVersion")
	}
	if batch.Producer.PluginID != "openclaw-lynx-guardian" {
		return BatchResult{}, fmt.Errorf("invalid producer.pluginId")
	}
	if batch.SentAtMs == nil {
		return BatchResult{}, fmt.Errorf("sentAtMs is required")
	}
	if strings.TrimSpace(batch.BatchID) == "" {
		return BatchResult{}, fmt.Errorf("batchId is required")
	}
	if batch.Items == nil {
		return BatchResult{}, fmt.Errorf("items is required")
	}

	validItems := make([]validItem, 0, len(batch.Items))
	rejected := make([]RejectedItem, 0)
	for index, raw := range batch.Items {
		item, err := s.parseItem(raw)
		if err != nil {
			rejected = append(rejected, RejectedItem{
				ItemIndex: index,
				Kind:      rejectedKind(raw),
				Code:      "invalid_item",
				Message:   err.Error(),
			})
			continue
		}
		if len(allowedKinds) > 0 {
			if _, ok := allowedKinds[item.kind]; !ok {
				rejected = append(rejected, RejectedItem{
					ItemIndex: index,
					Kind:      item.kind,
					Code:      "invalid_item_kind",
					Message:   fmt.Sprintf("kind %q is not accepted by this ingest endpoint", item.kind),
				})
				continue
			}
		}
		validItems = append(validItems, item)
	}

	persistedCount := 0
	duplicateCount := 0
	err := s.repository.WithTransaction(func(tx *sql.Tx) error {
		ingestedAtMs := s.now()
		for _, item := range validItems {
			result, err := item.persist(tx, ingestedAtMs)
			if err != nil {
				return err
			}
			switch result.Status {
			case "persisted":
				persistedCount++
			case "duplicate":
				duplicateCount++
			default:
				return fmt.Errorf("unknown persist status %q", result.Status)
			}
		}
		return nil
	})
	if err != nil {
		return BatchResult{}, err
	}

	return BatchResult{
		OK:             true,
		SchemaVersion:  schemaVersion,
		BatchID:        batch.BatchID,
		AcceptedCount:  len(validItems),
		PersistedCount: persistedCount,
		DuplicateCount: duplicateCount,
		RejectedCount:  len(rejected),
		RejectedItems:  rejected,
		ServerTimeMs:   s.now(),
	}, nil
}

func (s *Service) parseItem(raw json.RawMessage) (validItem, error) {
	var base rawItemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		return validItem{}, err
	}
	if strings.TrimSpace(base.ItemID) == "" {
		return validItem{}, fmt.Errorf("itemId is required")
	}
	if base.OccurredAtMs == nil {
		return validItem{}, fmt.Errorf("occurredAtMs is required")
	}
	if len(base.Data) == 0 {
		return validItem{}, fmt.Errorf("data is required")
	}

	switch base.Kind {
	case "sessionUpsert":
		item, err := parseSession(base)
		if err != nil {
			return validItem{}, err
		}
		return validItem{
			kind: base.Kind,
			persist: func(tx *sql.Tx, _ int64) (repo.PersistResult, error) {
				return s.repository.PersistSession(tx, item)
			},
		}, nil
	case "auditEvent":
		item, err := parseAuditEvent(base)
		if err != nil {
			return validItem{}, err
		}
		return validItem{
			kind: base.Kind,
			persist: func(tx *sql.Tx, ingestedAtMs int64) (repo.PersistResult, error) {
				return s.repository.PersistAuditEvent(tx, item, ingestedAtMs)
			},
		}, nil
	case "qaRecordUpsert":
		item, err := parseQARecord(base)
		if err != nil {
			return validItem{}, err
		}
		return validItem{
			kind: base.Kind,
			persist: func(tx *sql.Tx, ingestedAtMs int64) (repo.PersistResult, error) {
				return s.repository.PersistQARecord(tx, item, ingestedAtMs)
			},
		}, nil
	case "toolCallUpsert":
		item, err := parseToolCall(base)
		if err != nil {
			return validItem{}, err
		}
		return validItem{
			kind: base.Kind,
			persist: func(tx *sql.Tx, _ int64) (repo.PersistResult, error) {
				return s.repository.PersistToolCall(tx, item)
			},
		}, nil
	case "approvalUpsert":
		item, err := parseApproval(base)
		if err != nil {
			return validItem{}, err
		}
		return validItem{
			kind: base.Kind,
			persist: func(tx *sql.Tx, _ int64) (repo.PersistResult, error) {
				return s.repository.PersistApproval(tx, item)
			},
		}, nil
	case "lynxCheckUpsert":
		item, err := parseLynxCheck(base)
		if err != nil {
			return validItem{}, err
		}
		return validItem{
			kind: base.Kind,
			persist: func(tx *sql.Tx, _ int64) (repo.PersistResult, error) {
				return s.repository.PersistLynxCheck(tx, item)
			},
		}, nil
	case "tokenUsage":
		item, err := parseTokenUsage(base)
		if err != nil {
			return validItem{}, err
		}
		return validItem{
			kind: base.Kind,
			persist: func(tx *sql.Tx, ingestedAtMs int64) (repo.PersistResult, error) {
				return s.repository.PersistTokenUsage(tx, item, ingestedAtMs)
			},
		}, nil
	default:
		return validItem{}, fmt.Errorf("unsupported kind %q", base.Kind)
	}
}

func parseSession(base rawItemBase) (repo.SessionUpsertItem, error) {
	var data struct {
		SessionKey     string         `json:"sessionKey"`
		ChannelProfile *string        `json:"channelProfile"`
		ChannelID      *string        `json:"channelId"`
		RequesterID    *string        `json:"requesterId"`
		RequesterOuID  *string        `json:"requesterOuId"`
		AccountID      *string        `json:"accountId"`
		ConversationID *string        `json:"conversationId"`
		ThreadID       any            `json:"threadId"`
		IsGroup        *bool          `json:"isGroup"`
		FirstSeenAtMs  *int64         `json:"firstSeenAtMs"`
		LastSeenAtMs   *int64         `json:"lastSeenAtMs"`
		EndedAtMs      *int64         `json:"endedAtMs"`
		MetadataJSON   map[string]any `json:"metadataJson"`
	}
	if err := json.Unmarshal(base.Data, &data); err != nil {
		return repo.SessionUpsertItem{}, err
	}
	if err := requireString("sessionKey", data.SessionKey); err != nil {
		return repo.SessionUpsertItem{}, err
	}
	if data.FirstSeenAtMs == nil {
		return repo.SessionUpsertItem{}, fmt.Errorf("firstSeenAtMs is required")
	}
	if data.LastSeenAtMs == nil {
		return repo.SessionUpsertItem{}, fmt.Errorf("lastSeenAtMs is required")
	}
	threadID := optionalThreadID(data.ThreadID)
	return repo.SessionUpsertItem{
		IngestBase: repo.IngestBase{ItemID: base.ItemID, OccurredAtMs: *base.OccurredAtMs},
		Data: repo.SessionUpsertData{
			SessionKey:     data.SessionKey,
			ChannelProfile: cleanStringPtr(data.ChannelProfile),
			ChannelID:      cleanStringPtr(data.ChannelID),
			RequesterID:    cleanStringPtr(data.RequesterID),
			RequesterOuID:  cleanStringPtr(data.RequesterOuID),
			AccountID:      cleanStringPtr(data.AccountID),
			ConversationID: cleanStringPtr(data.ConversationID),
			ThreadID:       threadID,
			IsGroup:        data.IsGroup,
			FirstSeenAtMs:  *data.FirstSeenAtMs,
			LastSeenAtMs:   *data.LastSeenAtMs,
			EndedAtMs:      data.EndedAtMs,
			MetadataJSON:   data.MetadataJSON,
		},
	}, nil
}

func parseAuditEvent(base rawItemBase) (repo.AuditEventItem, error) {
	var data struct {
		EventID           string         `json:"eventId"`
		QARecordID        *string        `json:"qaRecordId"`
		SessionKey        *string        `json:"sessionKey"`
		RunID             *string        `json:"runId"`
		ToolCallID        *string        `json:"toolCallId"`
		ApprovalID        *string        `json:"approvalId"`
		RequestID         *string        `json:"requestId"`
		SourceKind        string         `json:"sourceKind"`
		HookName          string         `json:"hookName"`
		EventType         string         `json:"eventType"`
		Category          string         `json:"category"`
		SubCategory       *string        `json:"subCategory"`
		Direction         *string        `json:"direction"`
		ContentKind       *string        `json:"contentKind"`
		PrimaryModule     *string        `json:"primaryModule"`
		Modules           []string       `json:"modules"`
		RiskLevel         *string        `json:"riskLevel"`
		RiskScore         *int64         `json:"riskScore"`
		PolicyDecision    *string        `json:"policyDecision"`
		EnforcementAction string         `json:"enforcementAction"`
		Title             string         `json:"title"`
		Summary           *string        `json:"summary"`
		Recommendation    *string        `json:"recommendation"`
		ContentExcerpt    *string        `json:"contentExcerpt"`
		ContentHash       *string        `json:"contentHash"`
		PayloadJSON       map[string]any `json:"payloadJson"`
	}
	if err := json.Unmarshal(base.Data, &data); err != nil {
		return repo.AuditEventItem{}, err
	}
	required := map[string]string{
		"eventId":           data.EventID,
		"sourceKind":        data.SourceKind,
		"hookName":          data.HookName,
		"eventType":         data.EventType,
		"category":          data.Category,
		"enforcementAction": data.EnforcementAction,
		"title":             data.Title,
	}
	if err := requireStrings(required); err != nil {
		return repo.AuditEventItem{}, err
	}
	if !allowed(data.SourceKind, sourceKinds) {
		return repo.AuditEventItem{}, fmt.Errorf("invalid sourceKind")
	}
	if data.Direction != nil && !allowed(*data.Direction, directions) {
		return repo.AuditEventItem{}, fmt.Errorf("invalid direction")
	}
	if data.RiskLevel != nil && !allowed(*data.RiskLevel, riskLevels) {
		return repo.AuditEventItem{}, fmt.Errorf("invalid riskLevel")
	}
	if !allowed(data.EnforcementAction, enforcementActions) {
		return repo.AuditEventItem{}, fmt.Errorf("invalid enforcementAction")
	}
	return repo.AuditEventItem{
		IngestBase: repo.IngestBase{ItemID: base.ItemID, OccurredAtMs: *base.OccurredAtMs},
		Data: repo.AuditEventData{
			EventID:           data.EventID,
			QARecordID:        cleanStringPtr(data.QARecordID),
			SessionKey:        cleanStringPtr(data.SessionKey),
			RunID:             cleanStringPtr(data.RunID),
			ToolCallID:        cleanStringPtr(data.ToolCallID),
			ApprovalID:        cleanStringPtr(data.ApprovalID),
			RequestID:         cleanStringPtr(data.RequestID),
			SourceKind:        data.SourceKind,
			HookName:          data.HookName,
			EventType:         data.EventType,
			Category:          data.Category,
			SubCategory:       cleanStringPtr(data.SubCategory),
			Direction:         cleanStringPtr(data.Direction),
			ContentKind:       cleanStringPtr(data.ContentKind),
			PrimaryModule:     cleanStringPtr(data.PrimaryModule),
			Modules:           data.Modules,
			RiskLevel:         cleanStringPtr(data.RiskLevel),
			RiskScore:         data.RiskScore,
			PolicyDecision:    cleanStringPtr(data.PolicyDecision),
			EnforcementAction: data.EnforcementAction,
			Title:             data.Title,
			Summary:           cleanStringPtr(data.Summary),
			Recommendation:    cleanStringPtr(data.Recommendation),
			ContentExcerpt:    cleanStringPtr(data.ContentExcerpt),
			ContentHash:       cleanStringPtr(data.ContentHash),
			PayloadJSON:       data.PayloadJSON,
		},
	}, nil
}

func parseQARecord(base rawItemBase) (repo.QARecordUpsertItem, error) {
	var data struct {
		QARecordID         string         `json:"qaRecordId"`
		SessionKey         *string        `json:"sessionKey"`
		RunID              *string        `json:"runId"`
		AgentID            *string        `json:"agentId"`
		UserPromptExcerpt  *string        `json:"userPromptExcerpt"`
		UserPromptHash     *string        `json:"userPromptHash"`
		FinalAnswerExcerpt *string        `json:"finalAnswerExcerpt"`
		FinalAnswerHash    *string        `json:"finalAnswerHash"`
		Status             string         `json:"status"`
		RiskLevel          *string        `json:"riskLevel"`
		RiskScore          *int64         `json:"riskScore"`
		ToolCallCount      *int64         `json:"toolCallCount"`
		ApprovalCount      *int64         `json:"approvalCount"`
		DetectionCount     *int64         `json:"detectionCount"`
		TotalTokens        *int64         `json:"totalTokens"`
		StartedAtMs        *int64         `json:"startedAtMs"`
		CompletedAtMs      *int64         `json:"completedAtMs"`
		LinkOrigin         *string        `json:"linkOrigin"`
		PayloadJSON        map[string]any `json:"payloadJson"`
	}
	if err := json.Unmarshal(base.Data, &data); err != nil {
		return repo.QARecordUpsertItem{}, err
	}
	if err := requireStrings(map[string]string{
		"qaRecordId": data.QARecordID,
		"status":     data.Status,
	}); err != nil {
		return repo.QARecordUpsertItem{}, err
	}
	if data.StartedAtMs == nil {
		return repo.QARecordUpsertItem{}, fmt.Errorf("startedAtMs is required")
	}
	if data.RiskLevel != nil && !allowed(*data.RiskLevel, riskLevels) {
		return repo.QARecordUpsertItem{}, fmt.Errorf("invalid riskLevel")
	}
	linkOrigin := "legacy"
	if data.LinkOrigin != nil {
		switch *data.LinkOrigin {
		case "runtime", "inferred", "legacy":
			linkOrigin = *data.LinkOrigin
		default:
			return repo.QARecordUpsertItem{}, fmt.Errorf("invalid linkOrigin")
		}
	}
	return repo.QARecordUpsertItem{
		IngestBase: repo.IngestBase{ItemID: base.ItemID, OccurredAtMs: *base.OccurredAtMs},
		Data: repo.QARecordUpsertData{
			QARecordID:         data.QARecordID,
			SessionKey:         cleanStringPtr(data.SessionKey),
			RunID:              cleanStringPtr(data.RunID),
			AgentID:            cleanStringPtr(data.AgentID),
			UserPromptExcerpt:  cleanStringPtr(data.UserPromptExcerpt),
			UserPromptHash:     cleanStringPtr(data.UserPromptHash),
			FinalAnswerExcerpt: cleanStringPtr(data.FinalAnswerExcerpt),
			FinalAnswerHash:    cleanStringPtr(data.FinalAnswerHash),
			Status:             data.Status,
			RiskLevel:          cleanStringPtr(data.RiskLevel),
			RiskScore:          data.RiskScore,
			ToolCallCount:      int64OrZero(data.ToolCallCount),
			ApprovalCount:      int64OrZero(data.ApprovalCount),
			DetectionCount:     int64OrZero(data.DetectionCount),
			TotalTokens:        int64OrZero(data.TotalTokens),
			StartedAtMs:        *data.StartedAtMs,
			CompletedAtMs:      data.CompletedAtMs,
			LinkOrigin:         linkOrigin,
			PayloadJSON:        data.PayloadJSON,
		},
	}, nil
}

func parseToolCall(base rawItemBase) (repo.ToolCallUpsertItem, error) {
	var data struct {
		ToolCallID        string         `json:"toolCallId"`
		QARecordID        *string        `json:"qaRecordId"`
		SessionKey        *string        `json:"sessionKey"`
		RunID             *string        `json:"runId"`
		ApprovalID        *string        `json:"approvalId"`
		ToolName          string         `json:"toolName"`
		ParamSummary      *string        `json:"paramSummary"`
		ParamHash         *string        `json:"paramHash"`
		TriggeredModules  []string       `json:"triggeredModules"`
		RiskLevel         *string        `json:"riskLevel"`
		RiskScore         *int64         `json:"riskScore"`
		PolicyDecision    *string        `json:"policyDecision"`
		EnforcementAction string         `json:"enforcementAction"`
		StartedAtMs       *int64         `json:"startedAtMs"`
		FinishedAtMs      *int64         `json:"finishedAtMs"`
		DurationMs        *int64         `json:"durationMs"`
		ResultStatus      *string        `json:"resultStatus"`
		ResultExcerpt     *string        `json:"resultExcerpt"`
		ErrorText         *string        `json:"errorText"`
		MetadataJSON      map[string]any `json:"metadataJson"`
	}
	if err := json.Unmarshal(base.Data, &data); err != nil {
		return repo.ToolCallUpsertItem{}, err
	}
	if err := requireStrings(map[string]string{
		"toolCallId":        data.ToolCallID,
		"toolName":          data.ToolName,
		"enforcementAction": data.EnforcementAction,
	}); err != nil {
		return repo.ToolCallUpsertItem{}, err
	}
	if data.StartedAtMs == nil {
		return repo.ToolCallUpsertItem{}, fmt.Errorf("startedAtMs is required")
	}
	if data.RiskLevel != nil && !allowed(*data.RiskLevel, riskLevels) {
		return repo.ToolCallUpsertItem{}, fmt.Errorf("invalid riskLevel")
	}
	if !allowed(data.EnforcementAction, enforcementActions) {
		return repo.ToolCallUpsertItem{}, fmt.Errorf("invalid enforcementAction")
	}
	return repo.ToolCallUpsertItem{
		IngestBase: repo.IngestBase{ItemID: base.ItemID, OccurredAtMs: *base.OccurredAtMs},
		Data: repo.ToolCallUpsertData{
			ToolCallID:        data.ToolCallID,
			QARecordID:        cleanStringPtr(data.QARecordID),
			SessionKey:        cleanStringPtr(data.SessionKey),
			RunID:             cleanStringPtr(data.RunID),
			ApprovalID:        cleanStringPtr(data.ApprovalID),
			ToolName:          data.ToolName,
			ParamSummary:      cleanStringPtr(data.ParamSummary),
			ParamHash:         cleanStringPtr(data.ParamHash),
			TriggeredModules:  data.TriggeredModules,
			RiskLevel:         cleanStringPtr(data.RiskLevel),
			RiskScore:         data.RiskScore,
			PolicyDecision:    cleanStringPtr(data.PolicyDecision),
			EnforcementAction: data.EnforcementAction,
			StartedAtMs:       *data.StartedAtMs,
			FinishedAtMs:      data.FinishedAtMs,
			DurationMs:        data.DurationMs,
			ResultStatus:      cleanStringPtr(data.ResultStatus),
			ResultExcerpt:     cleanStringPtr(data.ResultExcerpt),
			ErrorText:         cleanStringPtr(data.ErrorText),
			MetadataJSON:      data.MetadataJSON,
		},
	}, nil
}

func parseApproval(base rawItemBase) (repo.ApprovalUpsertItem, error) {
	var data struct {
		ApprovalID             string         `json:"approvalId"`
		QARecordID             *string        `json:"qaRecordId"`
		PendingID              *string        `json:"pendingId"`
		SessionKey             *string        `json:"sessionKey"`
		RunID                  *string        `json:"runId"`
		Transport              *string        `json:"transport"`
		ChannelProfile         *string        `json:"channelProfile"`
		ChannelID              *string        `json:"channelId"`
		AccountID              *string        `json:"accountId"`
		ConversationID         *string        `json:"conversationId"`
		RequesterOuID          *string        `json:"requesterOuId"`
		ApproverOuIDs          []string       `json:"approverOuIds"`
		ResolvedApproverOuID   *string        `json:"resolvedApproverOuId"`
		RequestFingerprintHash *string        `json:"requestFingerprintHash"`
		Module                 string         `json:"module"`
		RiskLevel              string         `json:"riskLevel"`
		ToolName               *string        `json:"toolName"`
		ScopeType              string         `json:"scopeType"`
		RequestedAtMs          *int64         `json:"requestedAtMs"`
		ExpiresAtMs            *int64         `json:"expiresAtMs"`
		ResolvedAtMs           *int64         `json:"resolvedAtMs"`
		Resolution             *string        `json:"resolution"`
		PromptExcerpt          *string        `json:"promptExcerpt"`
		AuditSummaryJSON       map[string]any `json:"auditSummaryJson"`
		MetadataJSON           map[string]any `json:"metadataJson"`
	}
	if err := json.Unmarshal(base.Data, &data); err != nil {
		return repo.ApprovalUpsertItem{}, err
	}
	if err := requireStrings(map[string]string{
		"approvalId": data.ApprovalID,
		"module":     data.Module,
		"riskLevel":  data.RiskLevel,
		"scopeType":  data.ScopeType,
	}); err != nil {
		return repo.ApprovalUpsertItem{}, err
	}
	if data.RequestedAtMs == nil {
		return repo.ApprovalUpsertItem{}, fmt.Errorf("requestedAtMs is required")
	}
	if data.ExpiresAtMs == nil {
		return repo.ApprovalUpsertItem{}, fmt.Errorf("expiresAtMs is required")
	}
	if !allowed(data.RiskLevel, riskLevels) {
		return repo.ApprovalUpsertItem{}, fmt.Errorf("invalid riskLevel")
	}
	if !allowed(data.ScopeType, scopeTypes) {
		return repo.ApprovalUpsertItem{}, fmt.Errorf("invalid scopeType")
	}
	return repo.ApprovalUpsertItem{
		IngestBase: repo.IngestBase{ItemID: base.ItemID, OccurredAtMs: *base.OccurredAtMs},
		Data: repo.ApprovalUpsertData{
			ApprovalID:             data.ApprovalID,
			QARecordID:             cleanStringPtr(data.QARecordID),
			PendingID:              cleanStringPtr(data.PendingID),
			SessionKey:             cleanStringPtr(data.SessionKey),
			RunID:                  cleanStringPtr(data.RunID),
			Transport:              cleanStringPtr(data.Transport),
			ChannelProfile:         cleanStringPtr(data.ChannelProfile),
			ChannelID:              cleanStringPtr(data.ChannelID),
			AccountID:              cleanStringPtr(data.AccountID),
			ConversationID:         cleanStringPtr(data.ConversationID),
			RequesterOuID:          cleanStringPtr(data.RequesterOuID),
			ApproverOuIDs:          data.ApproverOuIDs,
			ResolvedApproverOuID:   cleanStringPtr(data.ResolvedApproverOuID),
			RequestFingerprintHash: cleanStringPtr(data.RequestFingerprintHash),
			Module:                 data.Module,
			RiskLevel:              data.RiskLevel,
			ToolName:               cleanStringPtr(data.ToolName),
			ScopeType:              data.ScopeType,
			RequestedAtMs:          *data.RequestedAtMs,
			ExpiresAtMs:            *data.ExpiresAtMs,
			ResolvedAtMs:           data.ResolvedAtMs,
			Resolution:             cleanStringPtr(data.Resolution),
			PromptExcerpt:          cleanStringPtr(data.PromptExcerpt),
			AuditSummaryJSON:       data.AuditSummaryJSON,
			MetadataJSON:           data.MetadataJSON,
		},
	}, nil
}

func parseLynxCheck(base rawItemBase) (repo.LynxCheckUpsertItem, error) {
	var data struct {
		RequestID            string           `json:"requestId"`
		QARecordID           *string          `json:"qaRecordId"`
		Source               string           `json:"source"`
		Trigger              string           `json:"trigger"`
		PreferredTargetKind  string           `json:"preferredTargetKind"`
		SessionKey           *string          `json:"sessionKey"`
		TargetKey            *string          `json:"targetKey"`
		ChannelID            *string          `json:"channelId"`
		MessageProvider      *string          `json:"messageProvider"`
		Status               string           `json:"status"`
		SendAttempted        *bool            `json:"sendAttempted"`
		SendSucceeded        *bool            `json:"sendSucceeded"`
		Transport            *string          `json:"transport"`
		ReportPath           *string          `json:"reportPath"`
		ReportMarkdown       *string          `json:"reportMarkdown"`
		ErrorMessage         *string          `json:"errorMessage"`
		DeliveryAttemptsJSON []map[string]any `json:"deliveryAttemptsJson"`
		CreatedAtMs          *int64           `json:"createdAtMs"`
		CompletedAtMs        *int64           `json:"completedAtMs"`
	}
	if err := json.Unmarshal(base.Data, &data); err != nil {
		return repo.LynxCheckUpsertItem{}, err
	}
	if err := requireStrings(map[string]string{
		"requestId":           data.RequestID,
		"source":              data.Source,
		"trigger":             data.Trigger,
		"preferredTargetKind": data.PreferredTargetKind,
		"status":              data.Status,
	}); err != nil {
		return repo.LynxCheckUpsertItem{}, err
	}
	if data.CreatedAtMs == nil {
		return repo.LynxCheckUpsertItem{}, fmt.Errorf("createdAtMs is required")
	}
	if !allowed(data.Source, lynxCheckSources) {
		return repo.LynxCheckUpsertItem{}, fmt.Errorf("invalid source")
	}
	if !allowed(data.Trigger, lynxCheckTriggers) {
		return repo.LynxCheckUpsertItem{}, fmt.Errorf("invalid trigger")
	}
	if !allowed(data.PreferredTargetKind, lynxCheckTargetKinds) {
		return repo.LynxCheckUpsertItem{}, fmt.Errorf("invalid preferredTargetKind")
	}
	if !allowed(data.Status, lynxCheckStatuses) {
		return repo.LynxCheckUpsertItem{}, fmt.Errorf("invalid status")
	}
	return repo.LynxCheckUpsertItem{
		IngestBase: repo.IngestBase{ItemID: base.ItemID, OccurredAtMs: *base.OccurredAtMs},
		Data: repo.LynxCheckUpsertData{
			RequestID:            data.RequestID,
			QARecordID:           cleanStringPtr(data.QARecordID),
			Source:               data.Source,
			Trigger:              data.Trigger,
			PreferredTargetKind:  data.PreferredTargetKind,
			SessionKey:           cleanStringPtr(data.SessionKey),
			TargetKey:            cleanStringPtr(data.TargetKey),
			ChannelID:            cleanStringPtr(data.ChannelID),
			MessageProvider:      cleanStringPtr(data.MessageProvider),
			Status:               data.Status,
			SendAttempted:        data.SendAttempted,
			SendSucceeded:        data.SendSucceeded,
			Transport:            cleanStringPtr(data.Transport),
			ReportPath:           cleanStringPtr(data.ReportPath),
			ReportMarkdown:       preserveStringPtr(data.ReportMarkdown),
			ErrorMessage:         cleanStringPtr(data.ErrorMessage),
			DeliveryAttemptsJSON: data.DeliveryAttemptsJSON,
			CreatedAtMs:          *data.CreatedAtMs,
			CompletedAtMs:        data.CompletedAtMs,
		},
	}, nil
}

func parseTokenUsage(base rawItemBase) (repo.TokenUsageItem, error) {
	var data struct {
		UsageEventID       string         `json:"usageEventId"`
		QARecordID         *string        `json:"qaRecordId"`
		SessionKey         *string        `json:"sessionKey"`
		RunID              *string        `json:"runId"`
		AgentID            *string        `json:"agentId"`
		Provider           string         `json:"provider"`
		Model              string         `json:"model"`
		SourceType         *string        `json:"sourceType"`
		InputTokens        *int64         `json:"inputTokens"`
		OutputTokens       *int64         `json:"outputTokens"`
		CacheReadTokens    *int64         `json:"cacheReadTokens"`
		CacheWriteTokens   *int64         `json:"cacheWriteTokens"`
		TotalTokens        *int64         `json:"totalTokens"`
		AssistantTextCount *int64         `json:"assistantTextCount"`
		IsEstimated        *bool          `json:"isEstimated"`
		PayloadJSON        map[string]any `json:"payloadJson"`
	}
	if err := json.Unmarshal(base.Data, &data); err != nil {
		return repo.TokenUsageItem{}, err
	}
	if err := requireStrings(map[string]string{
		"usageEventId": data.UsageEventID,
		"provider":     data.Provider,
		"model":        data.Model,
	}); err != nil {
		return repo.TokenUsageItem{}, err
	}
	if data.TotalTokens == nil {
		return repo.TokenUsageItem{}, fmt.Errorf("totalTokens is required")
	}
	return repo.TokenUsageItem{
		IngestBase: repo.IngestBase{ItemID: base.ItemID, OccurredAtMs: *base.OccurredAtMs},
		Data: repo.TokenUsageData{
			UsageEventID:       data.UsageEventID,
			QARecordID:         cleanStringPtr(data.QARecordID),
			SessionKey:         cleanStringPtr(data.SessionKey),
			RunID:              cleanStringPtr(data.RunID),
			AgentID:            cleanStringPtr(data.AgentID),
			Provider:           data.Provider,
			Model:              data.Model,
			SourceType:         cleanStringPtr(data.SourceType),
			InputTokens:        data.InputTokens,
			OutputTokens:       data.OutputTokens,
			CacheReadTokens:    data.CacheReadTokens,
			CacheWriteTokens:   data.CacheWriteTokens,
			TotalTokens:        *data.TotalTokens,
			AssistantTextCount: data.AssistantTextCount,
			IsEstimated:        data.IsEstimated,
			PayloadJSON:        data.PayloadJSON,
		},
	}, nil
}

func rejectedKind(raw json.RawMessage) string {
	var probe struct {
		Kind string `json:"kind"`
	}
	_ = json.Unmarshal(raw, &probe)
	if allowed(probe.Kind, itemKinds) {
		return probe.Kind
	}
	return "auditEvent"
}

func requireString(name, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", name)
	}
	return nil
}

func requireStrings(values map[string]string) error {
	for name, value := range values {
		if err := requireString(name, value); err != nil {
			return err
		}
	}
	return nil
}

func cleanStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func preserveStringPtr(value *string) *string {
	if value == nil || *value == "" {
		return nil
	}
	return value
}

func int64OrZero(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func optionalThreadID(value any) *string {
	switch v := value.(type) {
	case nil:
		return nil
	case string:
		return cleanStringPtr(&v)
	case float64:
		if math.Trunc(v) == v {
			s := fmt.Sprintf("%.0f", v)
			return &s
		}
		s := fmt.Sprintf("%v", v)
		return &s
	default:
		s := fmt.Sprintf("%v", v)
		return cleanStringPtr(&s)
	}
}

func allowed(value string, values map[string]struct{}) bool {
	_, ok := values[value]
	return ok
}

var itemKinds = map[string]struct{}{
	"sessionUpsert":   {},
	"auditEvent":      {},
	"toolCallUpsert":  {},
	"approvalUpsert":  {},
	"lynxCheckUpsert": {},
	"tokenUsage":      {},
	"qaRecordUpsert":  {},
}

var riskLevels = map[string]struct{}{
	"L0": {},
	"L1": {},
	"L2": {},
	"L3": {},
	"L4": {},
}

var enforcementActions = map[string]struct{}{
	"allow":           {},
	"warn":            {},
	"block":           {},
	"redact":          {},
	"requireApproval": {},
	"logOnly":         {},
}

var sourceKinds = map[string]struct{}{
	"plugin_hook": {},
	"system_task": {},
	"sidecar":     {},
}

var directions = map[string]struct{}{
	"input":    {},
	"output":   {},
	"internal": {},
}

var scopeTypes = map[string]struct{}{
	"singleTool": {},
	"workflow":   {},
	"timeWindow": {},
}

var lynxCheckSources = map[string]struct{}{
	"manual":    {},
	"scheduled": {},
}

var lynxCheckTriggers = map[string]struct{}{
	"lynx_command":         {},
	"scheduled_lynx_check": {},
}

var lynxCheckTargetKinds = map[string]struct{}{
	"current": {},
	"recent":  {},
}

var lynxCheckStatuses = map[string]struct{}{
	"pending":     {},
	"running":     {},
	"completed":   {},
	"failed":      {},
	"not_started": {},
}
