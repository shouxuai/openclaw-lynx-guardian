import type Database from "better-sqlite3";

import type {
  ApprovalUpsertItem,
  AuditEventItem,
  LynxCheckUpsertItem,
  SessionUpsertItem,
  TokenUsageItem,
  ToolCallUpsertItem,
} from "../../../shared/src/ingest.js";
import { toDbApprovalScopeType, toDbEnforcementAction } from "./sql-mappers.js";

export interface PersistResult {
  status: "persisted" | "duplicate";
}

function toJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function toBooleanInteger(value: boolean | undefined): number {
  return value ? 1 : 0;
}

export class IngestRepository {
  constructor(private readonly database: Database.Database) {}

  withTransaction<T>(callback: () => T): T {
    const transaction = this.database.transaction(callback);
    return transaction();
  }

  persistSession(item: SessionUpsertItem): PersistResult {
    const result = this.database
      .prepare(
        `
        INSERT INTO sessions (
          session_key,
          channel_profile,
          channel_id,
          requester_id,
          requester_ou_id,
          account_id,
          conversation_id,
          thread_id,
          is_group,
          first_seen_at,
          last_seen_at,
          ended_at,
          metadata_json
        ) VALUES (
          @sessionKey,
          @channelProfile,
          @channelId,
          @requesterId,
          @requesterOuId,
          @accountId,
          @conversationId,
          @threadId,
          @isGroup,
          @firstSeenAt,
          @lastSeenAt,
          @endedAt,
          @metadataJson
        )
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
      )
      .run({
        sessionKey: item.data.sessionKey,
        channelProfile: item.data.channelProfile ?? null,
        channelId: item.data.channelId ?? null,
        requesterId: item.data.requesterId ?? null,
        requesterOuId: item.data.requesterOuId ?? null,
        accountId: item.data.accountId ?? null,
        conversationId: item.data.conversationId ?? null,
        threadId: item.data.threadId == null ? null : String(item.data.threadId),
        isGroup: toBooleanInteger(item.data.isGroup),
        firstSeenAt: item.data.firstSeenAtMs,
        lastSeenAt: item.data.lastSeenAtMs,
        endedAt: item.data.endedAtMs ?? null,
        metadataJson: toJson(item.data.metadataJson),
      });

    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }

  persistAuditEvent(item: AuditEventItem, ingestedAtMs: number): PersistResult {
    const result = this.database
      .prepare(
        `
        INSERT OR IGNORE INTO audit_events (
          event_id,
          session_key,
          run_id,
          tool_call_id,
          approval_id,
          request_id,
          source_kind,
          hook_name,
          event_type,
          category,
          sub_category,
          direction,
          content_kind,
          primary_module,
          modules_json,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          title,
          summary,
          recommendation,
          content_excerpt,
          content_hash,
          occurred_at,
          ingested_at,
          payload_json
        ) VALUES (
          @eventId,
          @sessionKey,
          @runId,
          @toolCallId,
          @approvalId,
          @requestId,
          @sourceKind,
          @hookName,
          @eventType,
          @category,
          @subCategory,
          @direction,
          @contentKind,
          @primaryModule,
          @modulesJson,
          @riskLevel,
          @riskScore,
          @policyDecision,
          @enforcementAction,
          @title,
          @summary,
          @recommendation,
          @contentExcerpt,
          @contentHash,
          @occurredAt,
          @ingestedAt,
          @payloadJson
        )
        `,
      )
      .run({
        eventId: item.data.eventId,
        sessionKey: item.data.sessionKey ?? null,
        runId: item.data.runId ?? null,
        toolCallId: item.data.toolCallId ?? null,
        approvalId: item.data.approvalId ?? null,
        requestId: item.data.requestId ?? null,
        sourceKind: item.data.sourceKind,
        hookName: item.data.hookName,
        eventType: item.data.eventType,
        category: item.data.category,
        subCategory: item.data.subCategory ?? null,
        direction: item.data.direction ?? null,
        contentKind: item.data.contentKind ?? null,
        primaryModule: item.data.primaryModule ?? null,
        modulesJson: toJson(item.data.modules),
        riskLevel: item.data.riskLevel ?? null,
        riskScore: item.data.riskScore ?? null,
        policyDecision: item.data.policyDecision ?? null,
        enforcementAction: toDbEnforcementAction(item.data.enforcementAction),
        title: item.data.title,
        summary: item.data.summary ?? null,
        recommendation: item.data.recommendation ?? null,
        contentExcerpt: item.data.contentExcerpt ?? null,
        contentHash: item.data.contentHash ?? null,
        occurredAt: item.occurredAtMs,
        ingestedAt: ingestedAtMs,
        payloadJson: toJson(item.data.payloadJson),
      });

    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }

  persistToolCall(item: ToolCallUpsertItem): PersistResult {
    const result = this.database
      .prepare(
        `
        INSERT INTO tool_calls (
          tool_call_id,
          session_key,
          run_id,
          approval_id,
          tool_name,
          param_summary,
          param_hash,
          triggered_modules_json,
          risk_level,
          risk_score,
          policy_decision,
          enforcement_action,
          started_at,
          finished_at,
          duration_ms,
          result_status,
          result_excerpt,
          error_text,
          metadata_json
        ) VALUES (
          @toolCallId,
          @sessionKey,
          @runId,
          @approvalId,
          @toolName,
          @paramSummary,
          @paramHash,
          @triggeredModulesJson,
          @riskLevel,
          @riskScore,
          @policyDecision,
          @enforcementAction,
          @startedAt,
          @finishedAt,
          @durationMs,
          @resultStatus,
          @resultExcerpt,
          @errorText,
          @metadataJson
        )
        ON CONFLICT(tool_call_id) DO UPDATE SET
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
          enforcement_action = COALESCE(excluded.enforcement_action, tool_calls.enforcement_action),
          started_at = MIN(tool_calls.started_at, excluded.started_at),
          finished_at = COALESCE(excluded.finished_at, tool_calls.finished_at),
          duration_ms = COALESCE(excluded.duration_ms, tool_calls.duration_ms),
          result_status = COALESCE(excluded.result_status, tool_calls.result_status),
          result_excerpt = COALESCE(excluded.result_excerpt, tool_calls.result_excerpt),
          error_text = COALESCE(excluded.error_text, tool_calls.error_text),
          metadata_json = COALESCE(tool_calls.metadata_json, excluded.metadata_json)
        `,
      )
      .run({
        toolCallId: item.data.toolCallId,
        sessionKey: item.data.sessionKey ?? null,
        runId: item.data.runId ?? null,
        approvalId: item.data.approvalId ?? null,
        toolName: item.data.toolName,
        paramSummary: item.data.paramSummary ?? null,
        paramHash: item.data.paramHash ?? null,
        triggeredModulesJson: toJson(item.data.triggeredModules),
        riskLevel: item.data.riskLevel ?? null,
        riskScore: item.data.riskScore ?? null,
        policyDecision: item.data.policyDecision ?? null,
        enforcementAction: toDbEnforcementAction(item.data.enforcementAction),
        startedAt: item.data.startedAtMs,
        finishedAt: item.data.finishedAtMs ?? null,
        durationMs: item.data.durationMs ?? null,
        resultStatus: item.data.resultStatus ?? null,
        resultExcerpt: item.data.resultExcerpt ?? null,
        errorText: item.data.errorText ?? null,
        metadataJson: toJson(item.data.metadataJson),
      });

    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }

  persistApproval(item: ApprovalUpsertItem): PersistResult {
    const result = this.database
      .prepare(
        `
        INSERT INTO approvals (
          approval_id,
          pending_id,
          session_key,
          run_id,
          transport,
          channel_profile,
          channel_id,
          account_id,
          conversation_id,
          requester_ou_id,
          approver_ou_ids_json,
          resolved_approver_ou_id,
          request_fingerprint_hash,
          module,
          risk_level,
          tool_name,
          scope_type,
          requested_at,
          expires_at,
          resolved_at,
          resolution,
          prompt_excerpt,
          audit_summary_json,
          metadata_json
        ) VALUES (
          @approvalId,
          @pendingId,
          @sessionKey,
          @runId,
          @transport,
          @channelProfile,
          @channelId,
          @accountId,
          @conversationId,
          @requesterOuId,
          @approverOuIdsJson,
          @resolvedApproverOuId,
          @requestFingerprintHash,
          @module,
          @riskLevel,
          @toolName,
          @scopeType,
          @requestedAt,
          @expiresAt,
          @resolvedAt,
          @resolution,
          @promptExcerpt,
          @auditSummaryJson,
          @metadataJson
        )
        ON CONFLICT(approval_id) DO UPDATE SET
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
      )
      .run({
        approvalId: item.data.approvalId,
        pendingId: item.data.pendingId ?? null,
        sessionKey: item.data.sessionKey ?? null,
        runId: item.data.runId ?? null,
        transport: item.data.transport ?? null,
        channelProfile: item.data.channelProfile ?? null,
        channelId: item.data.channelId ?? null,
        accountId: item.data.accountId ?? null,
        conversationId: item.data.conversationId ?? null,
        requesterOuId: item.data.requesterOuId ?? null,
        approverOuIdsJson: toJson(item.data.approverOuIds),
        resolvedApproverOuId: item.data.resolvedApproverOuId ?? null,
        requestFingerprintHash: item.data.requestFingerprintHash ?? null,
        module: item.data.module,
        riskLevel: item.data.riskLevel,
        toolName: item.data.toolName ?? null,
        scopeType: toDbApprovalScopeType(item.data.scopeType),
        requestedAt: item.data.requestedAtMs,
        expiresAt: item.data.expiresAtMs,
        resolvedAt: item.data.resolvedAtMs ?? null,
        resolution: item.data.resolution ?? null,
        promptExcerpt: item.data.promptExcerpt ?? null,
        auditSummaryJson: toJson(item.data.auditSummaryJson),
        metadataJson: toJson(item.data.metadataJson),
      });

    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }

  persistLynxCheck(item: LynxCheckUpsertItem): PersistResult {
    const result = this.database
      .prepare(
        `
        INSERT INTO lynx_checks (
          request_id,
          source,
          trigger,
          preferred_target_kind,
          session_key,
          target_key,
          channel_id,
          message_provider,
          status,
          send_attempted,
          send_succeeded,
          transport,
          report_path,
          error_message,
          delivery_attempts_json,
          created_at,
          completed_at
        ) VALUES (
          @requestId,
          @source,
          @trigger,
          @preferredTargetKind,
          @sessionKey,
          @targetKey,
          @channelId,
          @messageProvider,
          @status,
          @sendAttempted,
          @sendSucceeded,
          @transport,
          @reportPath,
          @errorMessage,
          @deliveryAttemptsJson,
          @createdAt,
          @completedAt
        )
        ON CONFLICT(request_id) DO UPDATE SET
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
          error_message = COALESCE(excluded.error_message, lynx_checks.error_message),
          delivery_attempts_json = COALESCE(excluded.delivery_attempts_json, lynx_checks.delivery_attempts_json),
          created_at = MIN(lynx_checks.created_at, excluded.created_at),
          completed_at = COALESCE(excluded.completed_at, lynx_checks.completed_at)
        `,
      )
      .run({
        requestId: item.data.requestId,
        source: item.data.source,
        trigger: item.data.trigger,
        preferredTargetKind: item.data.preferredTargetKind,
        sessionKey: item.data.sessionKey ?? null,
        targetKey: item.data.targetKey ?? null,
        channelId: item.data.channelId ?? null,
        messageProvider: item.data.messageProvider ?? null,
        status: item.data.status,
        sendAttempted: toBooleanInteger(item.data.sendAttempted),
        sendSucceeded: toBooleanInteger(item.data.sendSucceeded),
        transport: item.data.transport ?? null,
        reportPath: item.data.reportPath ?? null,
        errorMessage: item.data.errorMessage ?? null,
        deliveryAttemptsJson: toJson(item.data.deliveryAttemptsJson),
        createdAt: item.data.createdAtMs,
        completedAt: item.data.completedAtMs ?? null,
      });

    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }

  persistTokenUsage(item: TokenUsageItem, ingestedAtMs: number): PersistResult {
    const result = this.database
      .prepare(
        `
        INSERT OR IGNORE INTO token_usage (
          usage_event_id,
          session_key,
          run_id,
          agent_id,
          provider,
          model,
          input_tokens,
          output_tokens,
          cache_read_tokens,
          cache_write_tokens,
          total_tokens,
          assistant_text_count,
          is_estimated,
          occurred_at,
          ingested_at,
          payload_json
        ) VALUES (
          @usageEventId,
          @sessionKey,
          @runId,
          @agentId,
          @provider,
          @model,
          @inputTokens,
          @outputTokens,
          @cacheReadTokens,
          @cacheWriteTokens,
          @totalTokens,
          @assistantTextCount,
          @isEstimated,
          @occurredAt,
          @ingestedAt,
          @payloadJson
        )
        `,
      )
      .run({
        usageEventId: item.data.usageEventId,
        sessionKey: item.data.sessionKey ?? null,
        runId: item.data.runId ?? null,
        agentId: item.data.agentId ?? null,
        provider: item.data.provider,
        model: item.data.model,
        inputTokens: item.data.inputTokens ?? 0,
        outputTokens: item.data.outputTokens ?? 0,
        cacheReadTokens: item.data.cacheReadTokens ?? 0,
        cacheWriteTokens: item.data.cacheWriteTokens ?? 0,
        totalTokens: item.data.totalTokens,
        assistantTextCount: item.data.assistantTextCount ?? 0,
        isEstimated: toBooleanInteger(item.data.isEstimated),
        occurredAt: item.occurredAtMs,
        ingestedAt: ingestedAtMs,
        payloadJson: toJson(item.data.payloadJson),
      });

    return { status: result.changes > 0 ? "persisted" : "duplicate" };
  }
}
