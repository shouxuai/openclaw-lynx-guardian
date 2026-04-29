package repo

import (
	"database/sql"
	"fmt"
	"time"
)

type PersistResult struct {
	Status string
}

type IngestBase struct {
	ItemID       string
	OccurredAtMs int64
}

type SessionUpsertData struct {
	SessionKey     string
	ChannelProfile *string
	ChannelID      *string
	RequesterID    *string
	RequesterOuID  *string
	AccountID      *string
	ConversationID *string
	ThreadID       *string
	IsGroup        *bool
	FirstSeenAtMs  int64
	LastSeenAtMs   int64
	EndedAtMs      *int64
	MetadataJSON   map[string]any
}

type SessionUpsertItem struct {
	IngestBase
	Data SessionUpsertData
}

type AuditEventData struct {
	EventID           string
	QARecordID        *string
	SessionKey        *string
	RunID             *string
	ToolCallID        *string
	ApprovalID        *string
	RequestID         *string
	SourceKind        string
	HookName          string
	EventType         string
	Category          string
	SubCategory       *string
	Direction         *string
	ContentKind       *string
	PrimaryModule     *string
	Modules           []string
	RiskLevel         *string
	RiskScore         *int64
	PolicyDecision    *string
	EnforcementAction string
	Title             string
	Summary           *string
	Recommendation    *string
	ContentExcerpt    *string
	ContentHash       *string
	PayloadJSON       map[string]any
}

type AuditEventItem struct {
	IngestBase
	Data AuditEventData
}

type ToolCallUpsertData struct {
	ToolCallID        string
	QARecordID        *string
	SessionKey        *string
	RunID             *string
	ApprovalID        *string
	ToolName          string
	ParamSummary      *string
	ParamHash         *string
	TriggeredModules  []string
	RiskLevel         *string
	RiskScore         *int64
	PolicyDecision    *string
	EnforcementAction string
	StartedAtMs       int64
	FinishedAtMs      *int64
	DurationMs        *int64
	ResultStatus      *string
	ResultExcerpt     *string
	ErrorText         *string
	MetadataJSON      map[string]any
}

type ToolCallUpsertItem struct {
	IngestBase
	Data ToolCallUpsertData
}

type ApprovalUpsertData struct {
	ApprovalID             string
	QARecordID             *string
	PendingID              *string
	SessionKey             *string
	RunID                  *string
	Transport              *string
	ChannelProfile         *string
	ChannelID              *string
	AccountID              *string
	ConversationID         *string
	RequesterOuID          *string
	ApproverOuIDs          []string
	ResolvedApproverOuID   *string
	RequestFingerprintHash *string
	Module                 string
	RiskLevel              string
	ToolName               *string
	ScopeType              string
	RequestedAtMs          int64
	ExpiresAtMs            int64
	ResolvedAtMs           *int64
	Resolution             *string
	PromptExcerpt          *string
	AuditSummaryJSON       map[string]any
	MetadataJSON           map[string]any
}

type ApprovalUpsertItem struct {
	IngestBase
	Data ApprovalUpsertData
}

type LynxCheckUpsertData struct {
	RequestID            string
	QARecordID           *string
	Source               string
	Trigger              string
	PreferredTargetKind  string
	SessionKey           *string
	TargetKey            *string
	ChannelID            *string
	MessageProvider      *string
	Status               string
	SendAttempted        *bool
	SendSucceeded        *bool
	Transport            *string
	ReportPath           *string
	ReportMarkdown       *string
	ErrorMessage         *string
	DeliveryAttemptsJSON []map[string]any
	CreatedAtMs          int64
	CompletedAtMs        *int64
}

type LynxCheckUpsertItem struct {
	IngestBase
	Data LynxCheckUpsertData
}

type TokenUsageData struct {
	UsageEventID       string
	QARecordID         *string
	SessionKey         *string
	RunID              *string
	AgentID            *string
	Provider           string
	Model              string
	SourceType         *string
	InputTokens        *int64
	OutputTokens       *int64
	CacheReadTokens    *int64
	CacheWriteTokens   *int64
	TotalTokens        int64
	AssistantTextCount *int64
	IsEstimated        *bool
	PayloadJSON        map[string]any
}

type TokenUsageItem struct {
	IngestBase
	Data TokenUsageData
}

type QARecordUpsertData struct {
	QARecordID         string
	SessionKey         *string
	RunID              *string
	AgentID            *string
	UserPromptExcerpt  *string
	UserPromptHash     *string
	FinalAnswerExcerpt *string
	FinalAnswerHash    *string
	Status             string
	RiskLevel          *string
	RiskScore          *int64
	ToolCallCount      int64
	ApprovalCount      int64
	DetectionCount     int64
	TotalTokens        int64
	StartedAtMs        int64
	CompletedAtMs      *int64
	LinkOrigin         string
	PayloadJSON        map[string]any
}

type QARecordUpsertItem struct {
	IngestBase
	Data QARecordUpsertData
}

func (r *IngestRepository) WithTransaction(callback func(*sql.Tx) error) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	if err := callback(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (r *IngestRepository) PersistSession(exec sqlExecer, item SessionUpsertItem) (PersistResult, error) {
	result, err := exec.Exec(
		`
		INSERT INTO sessions (
			session_key, channel_profile, channel_id, requester_id, requester_ou_id,
			account_id, conversation_id, thread_id, is_group, first_seen_at, last_seen_at,
			ended_at, metadata_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(session_key) DO UPDATE SET
			channel_profile = COALESCE(sessions.channel_profile, excluded.channel_profile),
			channel_id = COALESCE(sessions.channel_id, excluded.channel_id),
			requester_id = COALESCE(sessions.requester_id, excluded.requester_id),
			requester_ou_id = COALESCE(sessions.requester_ou_id, excluded.requester_ou_id),
			account_id = COALESCE(sessions.account_id, excluded.account_id),
			conversation_id = COALESCE(sessions.conversation_id, excluded.conversation_id),
			thread_id = COALESCE(sessions.thread_id, excluded.thread_id),
			is_group = CASE WHEN sessions.is_group = 1 OR excluded.is_group = 1 THEN 1 ELSE 0 END,
			first_seen_at = MIN(sessions.first_seen_at, excluded.first_seen_at),
			last_seen_at = MAX(sessions.last_seen_at, excluded.last_seen_at),
			ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
			metadata_json = COALESCE(sessions.metadata_json, excluded.metadata_json)
		`,
		item.Data.SessionKey,
		item.Data.ChannelProfile,
		item.Data.ChannelID,
		item.Data.RequesterID,
		item.Data.RequesterOuID,
		item.Data.AccountID,
		item.Data.ConversationID,
		item.Data.ThreadID,
		toBoolInt(item.Data.IsGroup),
		item.Data.FirstSeenAtMs,
		item.Data.LastSeenAtMs,
		item.Data.EndedAtMs,
		toJSON(item.Data.MetadataJSON),
	)
	if err != nil {
		return PersistResult{}, err
	}
	return resultStatus(result)
}

func (r *IngestRepository) PersistQARecord(exec sqlExecer, item QARecordUpsertItem, ingestedAtMs int64) (PersistResult, error) {
	result, err := exec.Exec(
		`
		INSERT INTO qa_records (
			qa_record_id, session_key, run_id, agent_id, user_prompt_excerpt,
			user_prompt_hash, final_answer_excerpt, final_answer_hash, status,
			risk_level, risk_score, tool_call_count, approval_count, detection_count,
			total_tokens, started_at, completed_at, ingested_at, payload_json, link_origin
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(qa_record_id) DO UPDATE SET
			session_key = COALESCE(qa_records.session_key, excluded.session_key),
			run_id = COALESCE(qa_records.run_id, excluded.run_id),
			agent_id = COALESCE(qa_records.agent_id, excluded.agent_id),
			user_prompt_excerpt = COALESCE(excluded.user_prompt_excerpt, qa_records.user_prompt_excerpt),
			user_prompt_hash = COALESCE(excluded.user_prompt_hash, qa_records.user_prompt_hash),
			final_answer_excerpt = COALESCE(excluded.final_answer_excerpt, qa_records.final_answer_excerpt),
			final_answer_hash = COALESCE(excluded.final_answer_hash, qa_records.final_answer_hash),
			status = COALESCE(excluded.status, qa_records.status),
			risk_level = COALESCE(excluded.risk_level, qa_records.risk_level),
			risk_score = COALESCE(excluded.risk_score, qa_records.risk_score),
			tool_call_count = MAX(qa_records.tool_call_count, excluded.tool_call_count),
			approval_count = MAX(qa_records.approval_count, excluded.approval_count),
			detection_count = MAX(qa_records.detection_count, excluded.detection_count),
			total_tokens = MAX(qa_records.total_tokens, excluded.total_tokens),
			started_at = MIN(qa_records.started_at, excluded.started_at),
			completed_at = COALESCE(excluded.completed_at, qa_records.completed_at),
			ingested_at = excluded.ingested_at,
			payload_json = COALESCE(excluded.payload_json, qa_records.payload_json),
			link_origin = COALESCE(excluded.link_origin, qa_records.link_origin)
		`,
		item.Data.QARecordID,
		item.Data.SessionKey,
		item.Data.RunID,
		item.Data.AgentID,
		item.Data.UserPromptExcerpt,
		item.Data.UserPromptHash,
		item.Data.FinalAnswerExcerpt,
		item.Data.FinalAnswerHash,
		item.Data.Status,
		item.Data.RiskLevel,
		item.Data.RiskScore,
		item.Data.ToolCallCount,
		item.Data.ApprovalCount,
		item.Data.DetectionCount,
		item.Data.TotalTokens,
		item.Data.StartedAtMs,
		item.Data.CompletedAtMs,
		ingestedAtMs,
		toJSON(item.Data.PayloadJSON),
		item.Data.LinkOrigin,
	)
	if err != nil {
		return PersistResult{}, err
	}
	return resultStatus(result)
}

func (r *IngestRepository) PersistAuditEvent(exec sqlExecer, item AuditEventItem, ingestedAtMs int64) (PersistResult, error) {
	result, err := exec.Exec(
		`
		INSERT OR IGNORE INTO audit_events (
			event_id, qa_record_id, session_key, run_id, tool_call_id, approval_id, request_id,
			source_kind, hook_name, event_type, category, sub_category, direction,
			content_kind, primary_module, modules_json, risk_level, risk_score,
			policy_decision, enforcement_action, title, summary, recommendation,
			content_excerpt, content_hash, occurred_at, ingested_at, payload_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
		item.Data.EventID,
		item.Data.QARecordID,
		item.Data.SessionKey,
		item.Data.RunID,
		item.Data.ToolCallID,
		item.Data.ApprovalID,
		item.Data.RequestID,
		item.Data.SourceKind,
		item.Data.HookName,
		item.Data.EventType,
		item.Data.Category,
		item.Data.SubCategory,
		item.Data.Direction,
		item.Data.ContentKind,
		item.Data.PrimaryModule,
		toJSON(item.Data.Modules),
		item.Data.RiskLevel,
		item.Data.RiskScore,
		item.Data.PolicyDecision,
		toDBEnforcementAction(item.Data.EnforcementAction),
		item.Data.Title,
		item.Data.Summary,
		item.Data.Recommendation,
		item.Data.ContentExcerpt,
		item.Data.ContentHash,
		item.OccurredAtMs,
		ingestedAtMs,
		toJSON(item.Data.PayloadJSON),
	)
	if err != nil {
		return PersistResult{}, err
	}
	return resultStatus(result)
}

func (r *IngestRepository) PersistToolCall(exec sqlExecer, item ToolCallUpsertItem) (PersistResult, error) {
	result, err := exec.Exec(
		`
		INSERT INTO tool_calls (
			tool_call_id, qa_record_id, session_key, run_id, approval_id, tool_name, param_summary,
			param_hash, triggered_modules_json, risk_level, risk_score, policy_decision,
			enforcement_action, started_at, finished_at, duration_ms, result_status,
			result_excerpt, error_text, metadata_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(tool_call_id) DO UPDATE SET
			qa_record_id = COALESCE(tool_calls.qa_record_id, excluded.qa_record_id),
			session_key = COALESCE(tool_calls.session_key, excluded.session_key),
			run_id = COALESCE(tool_calls.run_id, excluded.run_id),
			approval_id = COALESCE(tool_calls.approval_id, excluded.approval_id),
			tool_name = COALESCE(tool_calls.tool_name, excluded.tool_name),
			param_summary = COALESCE(tool_calls.param_summary, excluded.param_summary),
			param_hash = COALESCE(tool_calls.param_hash, excluded.param_hash),
			triggered_modules_json = COALESCE(tool_calls.triggered_modules_json, excluded.triggered_modules_json),
			risk_level = COALESCE(tool_calls.risk_level, excluded.risk_level),
			risk_score = COALESCE(tool_calls.risk_score, excluded.risk_score),
			policy_decision = COALESCE(tool_calls.policy_decision, excluded.policy_decision),
			enforcement_action = CASE
				WHEN excluded.enforcement_action = 'allow'
					AND tool_calls.enforcement_action IN ('warn', 'block', 'redact', 'require_approval', 'log_only')
					THEN tool_calls.enforcement_action
				ELSE COALESCE(excluded.enforcement_action, tool_calls.enforcement_action)
			END,
			started_at = MIN(tool_calls.started_at, excluded.started_at),
			finished_at = COALESCE(excluded.finished_at, tool_calls.finished_at),
			duration_ms = COALESCE(excluded.duration_ms, tool_calls.duration_ms),
			result_status = COALESCE(excluded.result_status, tool_calls.result_status),
			result_excerpt = COALESCE(excluded.result_excerpt, tool_calls.result_excerpt),
			error_text = COALESCE(excluded.error_text, tool_calls.error_text),
			metadata_json = COALESCE(tool_calls.metadata_json, excluded.metadata_json)
		`,
		item.Data.ToolCallID,
		item.Data.QARecordID,
		item.Data.SessionKey,
		item.Data.RunID,
		item.Data.ApprovalID,
		item.Data.ToolName,
		item.Data.ParamSummary,
		item.Data.ParamHash,
		toJSON(item.Data.TriggeredModules),
		item.Data.RiskLevel,
		item.Data.RiskScore,
		item.Data.PolicyDecision,
		toDBEnforcementAction(item.Data.EnforcementAction),
		item.Data.StartedAtMs,
		item.Data.FinishedAtMs,
		item.Data.DurationMs,
		item.Data.ResultStatus,
		item.Data.ResultExcerpt,
		item.Data.ErrorText,
		toJSON(item.Data.MetadataJSON),
	)
	if err != nil {
		return PersistResult{}, err
	}
	return resultStatus(result)
}

func (r *IngestRepository) PersistApproval(exec sqlExecer, item ApprovalUpsertItem) (PersistResult, error) {
	result, err := exec.Exec(
		`
		INSERT INTO approvals (
			approval_id, qa_record_id, pending_id, session_key, run_id, transport, channel_profile,
			channel_id, account_id, conversation_id, requester_ou_id, approver_ou_ids_json,
			resolved_approver_ou_id, request_fingerprint_hash, module, risk_level, tool_name,
			scope_type, requested_at, expires_at, resolved_at, resolution, prompt_excerpt,
			audit_summary_json, metadata_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(approval_id) DO UPDATE SET
			qa_record_id = COALESCE(approvals.qa_record_id, excluded.qa_record_id),
			pending_id = COALESCE(approvals.pending_id, excluded.pending_id),
			session_key = COALESCE(approvals.session_key, excluded.session_key),
			run_id = COALESCE(approvals.run_id, excluded.run_id),
			transport = COALESCE(approvals.transport, excluded.transport),
			channel_profile = COALESCE(approvals.channel_profile, excluded.channel_profile),
			channel_id = COALESCE(approvals.channel_id, excluded.channel_id),
			account_id = COALESCE(approvals.account_id, excluded.account_id),
			conversation_id = COALESCE(approvals.conversation_id, excluded.conversation_id),
			requester_ou_id = COALESCE(approvals.requester_ou_id, excluded.requester_ou_id),
			approver_ou_ids_json = COALESCE(approvals.approver_ou_ids_json, excluded.approver_ou_ids_json),
			resolved_approver_ou_id = COALESCE(excluded.resolved_approver_ou_id, approvals.resolved_approver_ou_id),
			request_fingerprint_hash = COALESCE(approvals.request_fingerprint_hash, excluded.request_fingerprint_hash),
			module = COALESCE(approvals.module, excluded.module),
			risk_level = COALESCE(approvals.risk_level, excluded.risk_level),
			tool_name = COALESCE(approvals.tool_name, excluded.tool_name),
			scope_type = COALESCE(approvals.scope_type, excluded.scope_type),
			requested_at = MIN(approvals.requested_at, excluded.requested_at),
			expires_at = MAX(approvals.expires_at, excluded.expires_at),
			resolved_at = COALESCE(excluded.resolved_at, approvals.resolved_at),
			resolution = COALESCE(excluded.resolution, approvals.resolution),
			prompt_excerpt = COALESCE(excluded.prompt_excerpt, approvals.prompt_excerpt),
			audit_summary_json = COALESCE(approvals.audit_summary_json, excluded.audit_summary_json),
			metadata_json = COALESCE(approvals.metadata_json, excluded.metadata_json)
		`,
		item.Data.ApprovalID,
		item.Data.QARecordID,
		item.Data.PendingID,
		item.Data.SessionKey,
		item.Data.RunID,
		item.Data.Transport,
		item.Data.ChannelProfile,
		item.Data.ChannelID,
		item.Data.AccountID,
		item.Data.ConversationID,
		item.Data.RequesterOuID,
		toJSON(item.Data.ApproverOuIDs),
		item.Data.ResolvedApproverOuID,
		item.Data.RequestFingerprintHash,
		item.Data.Module,
		item.Data.RiskLevel,
		item.Data.ToolName,
		toDBApprovalScopeType(item.Data.ScopeType),
		item.Data.RequestedAtMs,
		item.Data.ExpiresAtMs,
		item.Data.ResolvedAtMs,
		item.Data.Resolution,
		item.Data.PromptExcerpt,
		toJSON(item.Data.AuditSummaryJSON),
		toJSON(item.Data.MetadataJSON),
	)
	if err != nil {
		return PersistResult{}, err
	}
	return resultStatus(result)
}

func (r *IngestRepository) PersistLynxCheck(exec sqlExecer, item LynxCheckUpsertItem) (PersistResult, error) {
	result, err := exec.Exec(
		`
		INSERT INTO lynx_checks (
			request_id, qa_record_id, source, trigger, preferred_target_kind, session_key, target_key,
			channel_id, message_provider, status, send_attempted, send_succeeded, transport,
			report_path, report_markdown, error_message, delivery_attempts_json, created_at, completed_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(request_id) DO UPDATE SET
			qa_record_id = COALESCE(lynx_checks.qa_record_id, excluded.qa_record_id),
			source = COALESCE(lynx_checks.source, excluded.source),
			trigger = COALESCE(lynx_checks.trigger, excluded.trigger),
			preferred_target_kind = COALESCE(lynx_checks.preferred_target_kind, excluded.preferred_target_kind),
			session_key = COALESCE(lynx_checks.session_key, excluded.session_key),
			target_key = COALESCE(lynx_checks.target_key, excluded.target_key),
			channel_id = COALESCE(lynx_checks.channel_id, excluded.channel_id),
			message_provider = COALESCE(lynx_checks.message_provider, excluded.message_provider),
			status = COALESCE(excluded.status, lynx_checks.status),
			send_attempted = MAX(lynx_checks.send_attempted, excluded.send_attempted),
			send_succeeded = MAX(lynx_checks.send_succeeded, excluded.send_succeeded),
			transport = COALESCE(excluded.transport, lynx_checks.transport),
			report_path = COALESCE(excluded.report_path, lynx_checks.report_path),
			report_markdown = COALESCE(excluded.report_markdown, lynx_checks.report_markdown),
			error_message = COALESCE(excluded.error_message, lynx_checks.error_message),
			delivery_attempts_json = COALESCE(excluded.delivery_attempts_json, lynx_checks.delivery_attempts_json),
			created_at = MIN(lynx_checks.created_at, excluded.created_at),
			completed_at = COALESCE(excluded.completed_at, lynx_checks.completed_at)
		`,
		item.Data.RequestID,
		item.Data.QARecordID,
		item.Data.Source,
		item.Data.Trigger,
		item.Data.PreferredTargetKind,
		item.Data.SessionKey,
		item.Data.TargetKey,
		item.Data.ChannelID,
		item.Data.MessageProvider,
		item.Data.Status,
		toBoolInt(item.Data.SendAttempted),
		toBoolInt(item.Data.SendSucceeded),
		item.Data.Transport,
		item.Data.ReportPath,
		item.Data.ReportMarkdown,
		item.Data.ErrorMessage,
		toJSON(item.Data.DeliveryAttemptsJSON),
		item.Data.CreatedAtMs,
		item.Data.CompletedAtMs,
	)
	if err != nil {
		return PersistResult{}, err
	}
	if err := r.persistLynxCheckTaskCompatibility(exec, item); err != nil {
		return PersistResult{}, err
	}
	return resultStatus(result)
}

func (r *IngestRepository) persistLynxCheckTaskCompatibility(exec sqlExecer, item LynxCheckUpsertItem) error {
	createdAt := unixMillisRFC3339(item.Data.CreatedAtMs)
	updatedAt := createdAt
	var completedAt any
	if item.Data.CompletedAtMs != nil {
		updatedAt = unixMillisRFC3339(*item.Data.CompletedAtMs)
		completedAt = updatedAt
	}
	deliveryChannel := firstNonEmpty(optionalString(item.Data.Transport), optionalString(item.Data.MessageProvider))
	deliveryStatus := legacyDeliveryStatus(item.Data.SendAttempted, item.Data.SendSucceeded)
	taskStatus := legacyLynxCheckTaskStatus(item.Data.Status)
	var deliveredAt any
	if item.Data.SendSucceeded != nil && *item.Data.SendSucceeded {
		if item.Data.CompletedAtMs != nil {
			deliveredAt = unixMillisRFC3339(*item.Data.CompletedAtMs)
		} else {
			deliveredAt = updatedAt
		}
	}

	_, err := exec.Exec(
		`
		INSERT INTO lynx_check_tasks (
			id, request_id, trigger, source, requester_id, session_key, target_key,
			status, facts_json, evidence_bundle_json, report_skeleton, report_markdown,
			delivery_channel, delivery_target, delivery_status, delivery_error, created_at, updated_at,
			delivered_at, completed_at
		)
		VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, '{}', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(request_id) DO UPDATE SET
			trigger = COALESCE(NULLIF(excluded.trigger, ''), lynx_check_tasks.trigger),
			source = COALESCE(NULLIF(excluded.source, ''), lynx_check_tasks.source),
			session_key = COALESCE(NULLIF(excluded.session_key, ''), lynx_check_tasks.session_key),
			target_key = COALESCE(NULLIF(excluded.target_key, ''), lynx_check_tasks.target_key),
			status = CASE
				WHEN lynx_check_tasks.status IN ('completed', 'failed', 'cancelled')
					THEN lynx_check_tasks.status
				WHEN excluded.status = 'created' AND lynx_check_tasks.status <> ''
					THEN lynx_check_tasks.status
				WHEN excluded.status = 'collecting'
					AND lynx_check_tasks.status IN ('analyzing', 'report_skeleton_ready', 'awaiting_llm_report', 'delivering')
					THEN lynx_check_tasks.status
				ELSE COALESCE(NULLIF(excluded.status, ''), lynx_check_tasks.status)
			END,
			facts_json = COALESCE(NULLIF(excluded.facts_json, '{}'), lynx_check_tasks.facts_json),
			report_markdown = COALESCE(NULLIF(excluded.report_markdown, ''), lynx_check_tasks.report_markdown),
			delivery_channel = COALESCE(NULLIF(excluded.delivery_channel, ''), lynx_check_tasks.delivery_channel),
			delivery_target = COALESCE(NULLIF(excluded.delivery_target, ''), lynx_check_tasks.delivery_target),
			delivery_status = COALESCE(NULLIF(excluded.delivery_status, ''), lynx_check_tasks.delivery_status),
			delivery_error = COALESCE(NULLIF(excluded.delivery_error, ''), lynx_check_tasks.delivery_error),
			updated_at = excluded.updated_at,
			delivered_at = COALESCE(excluded.delivered_at, lynx_check_tasks.delivered_at),
			completed_at = COALESCE(excluded.completed_at, lynx_check_tasks.completed_at)`,
		item.Data.RequestID,
		item.Data.RequestID,
		item.Data.Trigger,
		item.Data.Source,
		optionalString(item.Data.SessionKey),
		optionalString(item.Data.TargetKey),
		taskStatus,
		toJSON(map[string]any{
			"preferredTargetKind": item.Data.PreferredTargetKind,
			"channelId":           optionalString(item.Data.ChannelID),
			"messageProvider":     optionalString(item.Data.MessageProvider),
			"reportPath":          optionalString(item.Data.ReportPath),
		}),
		optionalString(item.Data.ReportMarkdown),
		deliveryChannel,
		optionalString(item.Data.TargetKey),
		deliveryStatus,
		optionalString(item.Data.ErrorMessage),
		createdAt,
		updatedAt,
		deliveredAt,
		completedAt,
	)
	return err
}

func (r *IngestRepository) PersistTokenUsage(exec sqlExecer, item TokenUsageItem, ingestedAtMs int64) (PersistResult, error) {
	result, err := exec.Exec(
		`
		INSERT OR IGNORE INTO token_usage (
			usage_event_id, qa_record_id, session_key, run_id, agent_id, provider, model,
			source_type, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
			total_tokens, assistant_text_count, is_estimated, occurred_at, ingested_at,
			payload_json
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
		item.Data.UsageEventID,
		item.Data.QARecordID,
		item.Data.SessionKey,
		item.Data.RunID,
		item.Data.AgentID,
		item.Data.Provider,
		item.Data.Model,
		normalizeTokenSourceType(item.Data.SourceType, item.Data.IsEstimated),
		zeroIfNil(item.Data.InputTokens),
		zeroIfNil(item.Data.OutputTokens),
		zeroIfNil(item.Data.CacheReadTokens),
		zeroIfNil(item.Data.CacheWriteTokens),
		item.Data.TotalTokens,
		zeroIfNil(item.Data.AssistantTextCount),
		toBoolInt(item.Data.IsEstimated),
		item.OccurredAtMs,
		ingestedAtMs,
		toJSON(item.Data.PayloadJSON),
	)
	if err != nil {
		return PersistResult{}, err
	}
	return resultStatus(result)
}

func normalizeTokenSourceType(sourceType *string, isEstimated *bool) string {
	if sourceType != nil {
		switch *sourceType {
		case "actual", "estimated", "unavailable":
			return *sourceType
		}
	}
	if isEstimated != nil && *isEstimated {
		return "estimated"
	}
	return "actual"
}

func unixMillisRFC3339(value int64) string {
	return time.UnixMilli(value).UTC().Format(time.RFC3339Nano)
}

func optionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func legacyLynxCheckTaskStatus(status string) string {
	switch status {
	case "pending":
		return "created"
	case "running":
		return "collecting"
	case "completed", "failed":
		return status
	default:
		return ""
	}
}

func legacyDeliveryStatus(sendAttempted *bool, sendSucceeded *bool) string {
	if sendSucceeded != nil && *sendSucceeded {
		return "sent"
	}
	if sendAttempted != nil && *sendAttempted {
		return "attempted"
	}
	return ""
}

func zeroIfNil(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func expectPersistedKind(result PersistResult) error {
	if result.Status != "persisted" && result.Status != "duplicate" {
		return fmt.Errorf("unknown persist status %q", result.Status)
	}
	return nil
}
