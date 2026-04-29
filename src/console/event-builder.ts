import { createHash } from "crypto";

import type {
  ApprovalScopeType,
  EnforcementAction,
  IngestDirection,
  RiskLevel,
} from "../../shared/src/enums.js";
import type {
  ApprovalUpsertItem,
  AuditEventItem,
  IngestItemV1,
  LynxCheckUpsertItem,
  QaRecordUpsertItem,
  SessionUpsertItem,
  ToolCallUpsertItem,
} from "../../shared/src/ingest.js";
import { SensitiveDataBlocker } from "../local-guard/sensitive-patterns.js";

type JsonRecord = Record<string, unknown>;

const auditExcerptRedactor = new SensitiveDataBlocker();
const STORED_EXCERPT_MAX_CHARS = 1_024;
const RESULT_STATUS_MAX_CHARS = 64;

interface BaseHookInput {
  occurredAtMs?: number;
  qaRecordId?: string;
  sessionKey?: string;
  runId?: string;
  agentId?: string;
  approvalId?: string;
  requestId?: string;
  summary?: string;
  recommendation?: string;
  contentExcerpt?: string;
  contentKind?: string;
  direction?: IngestDirection;
  primaryModule?: string;
  modules?: string[];
  riskLevel?: RiskLevel;
  riskScore?: number;
  policyDecision?: string;
  enforcementAction?: EnforcementAction;
  payloadJson?: JsonRecord;
}

export interface SessionLifecycleInput extends BaseHookInput {
  channelProfile?: string;
  channelId?: string;
  requesterId?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  isGroup?: boolean;
  metadataJson?: JsonRecord;
}

export interface GatewayStartInput extends BaseHookInput {
  port?: number;
  autoStart?: boolean;
  backendHealthy?: boolean;
  startReason?: string;
}

export interface BeforeDispatchInput extends BaseHookInput {
  localApprovalReply?: boolean;
  specialRoute?: string;
}

export interface MessageReceivedInput extends BaseHookInput {
  content?: unknown;
}

export interface LynxCheckSnapshotInput {
  requestId: string;
  qaRecordId?: string;
  source: "manual" | "scheduled";
  trigger: "lynx_command" | "scheduled_lynx_check";
  preferredTargetKind: "current" | "recent";
  sessionKey?: string;
  targetKey?: string;
  channelId?: string;
  messageProvider?: string;
  status: "pending" | "running" | "completed" | "failed" | "not_started";
  sendAttempted?: boolean;
  sendSucceeded?: boolean;
  transport?: string;
  reportPath?: string;
  errorMessage?: string;
  deliveryAttemptsJson?: Array<Record<string, unknown>>;
  createdAtMs: number;
  completedAtMs?: number;
}

export interface BeforeAgentStartInput extends BaseHookInput {
  promptText?: string;
  lynxCheck?: LynxCheckSnapshotInput;
}

export interface AgentEndInput extends BaseHookInput {
  outputText?: string;
  lynxCheck?: LynxCheckSnapshotInput;
}

export interface MessageWriteInput extends BaseHookInput {
  messageRole?: string;
  messageChanged?: boolean;
  blocked?: boolean;
}

export interface ToolResultPersistInput extends BaseHookInput {
  toolCallId?: string;
  toolName?: string;
  blocked?: boolean;
}

export interface MessageSendingInput extends BaseHookInput {
  canceled?: boolean;
  targetKey?: string;
  toolCallId?: string;
  lynxCheck?: LynxCheckSnapshotInput;
}

export interface ApprovalSnapshotInput {
  approvalId: string;
  pendingId?: string;
  sessionKey?: string;
  runId?: string;
  transport?: string;
  channelProfile?: string;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  approverOuIds?: string[];
  resolvedApproverOuId?: string;
  requestFingerprintHash?: string;
  module: string;
  riskLevel: RiskLevel;
  toolName?: string;
  scopeType: ApprovalScopeType;
  requestedAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  resolution?: string;
  promptExcerpt?: string;
  auditSummaryJson?: JsonRecord;
  metadataJson?: JsonRecord;
}

export interface BeforeToolCallInput extends BaseHookInput {
  toolCallId?: string;
  toolName: string;
  params?: unknown;
  paramSummary?: string;
  triggeredModules?: string[];
  approval?: ApprovalSnapshotInput;
  metadataJson?: JsonRecord;
}

export interface AfterToolCallInput extends BaseHookInput {
  toolCallId?: string;
  toolName: string;
  params?: unknown;
  paramSummary?: string;
  triggeredModules?: string[];
  resultStatus?: string;
  resultExcerpt?: string;
  errorText?: string;
  durationMs?: number;
  finishedAtMs?: number;
  metadataJson?: JsonRecord;
}

export interface LocalConsoleEventBuilder {
  sessionStart(input: SessionLifecycleInput): IngestItemV1[];
  sessionEnd(input: SessionLifecycleInput): IngestItemV1[];
  gatewayStart(input: GatewayStartInput): IngestItemV1[];
  beforeDispatch(input: BeforeDispatchInput): IngestItemV1[];
  messageReceived(input: MessageReceivedInput): IngestItemV1[];
  beforeAgentStart(input: BeforeAgentStartInput): IngestItemV1[];
  agentEnd(input: AgentEndInput): IngestItemV1[];
  beforeMessageWrite(input: MessageWriteInput): IngestItemV1[];
  toolResultPersist(input: ToolResultPersistInput): IngestItemV1[];
  messageSending(input: MessageSendingInput): IngestItemV1[];
  beforeToolCall(input: BeforeToolCallInput): IngestItemV1[];
  afterToolCall(input: AfterToolCallInput): IngestItemV1[];
}

interface AuditSeed extends BaseHookInput {
  hookName: string;
  eventType: string;
  category: string;
  title: string;
  subCategory?: string;
  toolCallId?: string;
}

function normalizeOccurredAtMs(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : Date.now();
}

function truncateText(value: unknown, maxLength = STORED_EXCERPT_MAX_CHARS): string | undefined {
  const text = typeof value === "string"
    ? value.trim()
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
  if (!text) {
    return undefined;
  }
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function redactAuditExcerpt(value: unknown, maxLength = STORED_EXCERPT_MAX_CHARS): string | undefined {
  const text = typeof value === "string"
    ? value.trim()
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : "";
  if (!text) {
    return undefined;
  }

  const redaction = auditExcerptRedactor.redactSensitiveData(text, {
    includePersonalFinancial: true,
  });
  return truncateText(redaction.text, maxLength);
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const serialized = typeof value === "string" ? value : stableSerialize(value);
  if (!serialized) {
    return undefined;
  }
  return createHash("sha1").update(serialized).digest("hex");
}

function buildStableId(prefix: string, parts: Array<string | number | undefined>): string {
  const raw = parts
    .filter((part) => part !== undefined && part !== "")
    .map((part) => String(part))
    .join("|");
  const digest = createHash("sha1").update(raw || prefix).digest("hex").slice(0, 20);
  return `${prefix}:${digest}`;
}

export function resolveLocalConsoleQaRecordId(input: {
  qaRecordId?: string;
  runId?: string;
  sessionKey?: string;
}): string | undefined {
  const explicit = input.qaRecordId?.trim();
  if (explicit) {
    return explicit;
  }
  const runId = input.runId?.trim();
  if (!runId) {
    return undefined;
  }
  return buildStableId("qa", [input.sessionKey, runId]);
}

function cleanRecord<T extends JsonRecord>(value: T): T | undefined {
  const nextEntries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  if (nextEntries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(nextEntries) as T;
}

function resolveEnforcementAction(value: EnforcementAction | undefined, fallback: EnforcementAction = "allow"): EnforcementAction {
  return value ?? fallback;
}

function createAuditItem(input: AuditSeed): AuditEventItem {
  const occurredAtMs = normalizeOccurredAtMs(input.occurredAtMs);
  const qaRecordId = resolveLocalConsoleQaRecordId(input);
  const payloadJson = cleanRecord({
    ...(input.payloadJson ?? {}),
  });
  const contentExcerpt = redactAuditExcerpt(input.contentExcerpt, STORED_EXCERPT_MAX_CHARS);
  const eventId = buildStableId("audit", [
    input.hookName,
    input.sessionKey,
    input.runId,
    input.toolCallId,
    input.approvalId,
    input.requestId,
    input.eventType,
    occurredAtMs,
    input.summary,
    contentExcerpt,
  ]);

  return {
    kind: "auditEvent",
    itemId: eventId,
    occurredAtMs,
    data: {
      eventId,
      qaRecordId,
      sessionKey: input.sessionKey,
      runId: input.runId,
      toolCallId: input.toolCallId,
      approvalId: input.approvalId,
      requestId: input.requestId,
      sourceKind: "plugin_hook",
      hookName: input.hookName,
      eventType: input.eventType,
      category: input.category,
      subCategory: input.subCategory,
      direction: input.direction,
      contentKind: input.contentKind,
      primaryModule: input.primaryModule,
      modules: input.modules,
      riskLevel: input.riskLevel,
      riskScore: input.riskScore,
      policyDecision: input.policyDecision,
      enforcementAction: resolveEnforcementAction(input.enforcementAction),
      title: input.title,
      summary: truncateText(input.summary, STORED_EXCERPT_MAX_CHARS),
      recommendation: truncateText(input.recommendation, STORED_EXCERPT_MAX_CHARS),
      contentExcerpt,
      contentHash: hashValue(contentExcerpt),
      payloadJson,
    },
  };
}

interface QARecordSeed extends BaseHookInput {
  userPrompt?: unknown;
  finalAnswer?: unknown;
  status: "running" | "completed" | "blocked" | "failed";
  startedAtMs?: number;
  completedAtMs?: number;
  toolCallCount?: number;
  approvalCount?: number;
  detectionCount?: number;
  totalTokens?: number;
}

function createQARecordUpsert(input: QARecordSeed): QaRecordUpsertItem | null {
  const qaRecordId = resolveLocalConsoleQaRecordId(input);
  if (!qaRecordId) {
    return null;
  }

  const occurredAtMs = normalizeOccurredAtMs(input.occurredAtMs);
  const userPromptExcerpt = redactAuditExcerpt(input.userPrompt, STORED_EXCERPT_MAX_CHARS);
  const finalAnswerExcerpt = redactAuditExcerpt(input.finalAnswer, STORED_EXCERPT_MAX_CHARS);
  const itemId = buildStableId("qa-item", [
    qaRecordId,
    input.status,
    userPromptExcerpt ? "prompt" : undefined,
    finalAnswerExcerpt ? "answer" : undefined,
    occurredAtMs,
  ]);

  return {
    kind: "qaRecordUpsert",
    itemId,
    occurredAtMs,
    data: {
      qaRecordId,
      sessionKey: input.sessionKey,
      runId: input.runId,
      agentId: input.agentId,
      userPromptExcerpt,
      userPromptHash: hashValue(input.userPrompt),
      finalAnswerExcerpt,
      finalAnswerHash: hashValue(input.finalAnswer),
      status: input.status,
      riskLevel: input.riskLevel,
      riskScore: input.riskScore,
      toolCallCount: input.toolCallCount,
      approvalCount: input.approvalCount,
      detectionCount: input.detectionCount,
      totalTokens: input.totalTokens,
      startedAtMs: input.startedAtMs ?? occurredAtMs,
      completedAtMs: input.completedAtMs,
      linkOrigin: "runtime",
      payloadJson: cleanRecord({
        ...(input.payloadJson ?? {}),
      }),
    },
  };
}

function createSessionUpsert(input: SessionLifecycleInput, endedAtMs?: number): SessionUpsertItem | null {
  if (!input.sessionKey) {
    return null;
  }
  const occurredAtMs = normalizeOccurredAtMs(input.occurredAtMs);
  const itemId = buildStableId("session", [input.sessionKey, endedAtMs ? "end" : "start", occurredAtMs]);

  return {
    kind: "sessionUpsert",
    itemId,
    occurredAtMs,
    data: {
      sessionKey: input.sessionKey,
      channelProfile: input.channelProfile,
      channelId: input.channelId,
      requesterId: input.requesterId,
      requesterOuId: input.requesterOuId,
      accountId: input.accountId,
      conversationId: input.conversationId,
      threadId: input.threadId,
      isGroup: input.isGroup,
      firstSeenAtMs: occurredAtMs,
      lastSeenAtMs: occurredAtMs,
      endedAtMs,
      metadataJson: cleanRecord({
        ...(input.metadataJson ?? {}),
      }),
    },
  };
}

function createDerivedSessionUpsert(input: BaseHookInput): SessionUpsertItem | null {
  if (!input.sessionKey) {
    return null;
  }

  return createSessionUpsert({
    occurredAtMs: input.occurredAtMs,
    sessionKey: input.sessionKey,
  });
}

function createToolCallUpsert(input: BeforeToolCallInput | AfterToolCallInput, phase: "before" | "after"): ToolCallUpsertItem {
  const occurredAtMs = normalizeOccurredAtMs(input.occurredAtMs);
  const qaRecordId = resolveLocalConsoleQaRecordId(input);
  const toolCallId = input.toolCallId
    ?? buildStableId("tool-call", [
      input.runId,
      input.toolName,
      stableSerialize(input.params),
    ]);
  const itemId = buildStableId("tool-item", [toolCallId, phase, occurredAtMs]);

  return {
    kind: "toolCallUpsert",
    itemId,
    occurredAtMs,
    data: {
      toolCallId,
      qaRecordId,
      sessionKey: input.sessionKey,
      runId: input.runId,
      approvalId: input.approvalId,
      toolName: input.toolName,
      paramSummary: truncateText(input.paramSummary ?? stableSerialize(input.params), STORED_EXCERPT_MAX_CHARS),
      paramHash: hashValue(input.params),
      triggeredModules: input.triggeredModules ?? input.modules,
      riskLevel: input.riskLevel,
      riskScore: input.riskScore,
      policyDecision: input.policyDecision,
      enforcementAction: resolveEnforcementAction(input.enforcementAction),
      startedAtMs: phase === "before" ? occurredAtMs : normalizeOccurredAtMs((input as AfterToolCallInput).finishedAtMs ?? input.occurredAtMs),
      finishedAtMs: phase === "after" ? normalizeOccurredAtMs((input as AfterToolCallInput).finishedAtMs ?? input.occurredAtMs) : undefined,
      durationMs: phase === "after" ? (input as AfterToolCallInput).durationMs : undefined,
      resultStatus: phase === "after" ? truncateText((input as AfterToolCallInput).resultStatus, RESULT_STATUS_MAX_CHARS) : undefined,
      resultExcerpt: phase === "after" ? truncateText((input as AfterToolCallInput).resultExcerpt, STORED_EXCERPT_MAX_CHARS) : undefined,
      errorText: phase === "after" ? truncateText((input as AfterToolCallInput).errorText, STORED_EXCERPT_MAX_CHARS) : undefined,
      metadataJson: cleanRecord({
        ...(input.metadataJson ?? {}),
      }),
    },
  };
}

function createApprovalUpsert(input: ApprovalSnapshotInput, fallback: BaseHookInput): ApprovalUpsertItem {
  const occurredAtMs = normalizeOccurredAtMs(fallback.occurredAtMs ?? input.requestedAtMs);
  const qaRecordId = resolveLocalConsoleQaRecordId({
    qaRecordId: fallback.qaRecordId,
    runId: input.runId ?? fallback.runId,
    sessionKey: input.sessionKey ?? fallback.sessionKey,
  });
  const itemId = buildStableId("approval", [input.approvalId, occurredAtMs]);

  return {
    kind: "approvalUpsert",
    itemId,
    occurredAtMs,
    data: {
      approvalId: input.approvalId,
      qaRecordId,
      pendingId: input.pendingId,
      sessionKey: input.sessionKey ?? fallback.sessionKey,
      runId: input.runId ?? fallback.runId,
      transport: input.transport,
      channelProfile: input.channelProfile,
      channelId: input.channelId,
      accountId: input.accountId,
      conversationId: input.conversationId,
      requesterOuId: input.requesterOuId,
      approverOuIds: input.approverOuIds,
      resolvedApproverOuId: input.resolvedApproverOuId,
      requestFingerprintHash: input.requestFingerprintHash,
      module: input.module,
      riskLevel: input.riskLevel,
      toolName: input.toolName,
      scopeType: input.scopeType,
      requestedAtMs: input.requestedAtMs,
      expiresAtMs: input.expiresAtMs,
      resolvedAtMs: input.resolvedAtMs,
      resolution: input.resolution,
      promptExcerpt: redactAuditExcerpt(input.promptExcerpt, STORED_EXCERPT_MAX_CHARS),
      auditSummaryJson: cleanRecord({
        ...(input.auditSummaryJson ?? {}),
      }),
      metadataJson: cleanRecord({
        ...(input.metadataJson ?? {}),
      }),
    },
  };
}

function createLynxCheckUpsert(input: LynxCheckSnapshotInput, fallback?: BaseHookInput): LynxCheckUpsertItem {
  const occurredAtMs = normalizeOccurredAtMs(input.completedAtMs ?? input.createdAtMs);
  const qaRecordId = input.qaRecordId ?? (fallback ? resolveLocalConsoleQaRecordId(fallback) : undefined);
  const itemId = buildStableId("lynx-check", [input.requestId, input.status, occurredAtMs]);

  return {
    kind: "lynxCheckUpsert",
    itemId,
    occurredAtMs,
    data: {
      requestId: input.requestId,
      qaRecordId,
      source: input.source,
      trigger: input.trigger,
      preferredTargetKind: input.preferredTargetKind,
      sessionKey: input.sessionKey,
      targetKey: input.targetKey,
      channelId: input.channelId,
      messageProvider: input.messageProvider,
      status: input.status,
      sendAttempted: input.sendAttempted,
      sendSucceeded: input.sendSucceeded,
      transport: input.transport,
      reportPath: input.reportPath,
      errorMessage: truncateText(input.errorMessage, STORED_EXCERPT_MAX_CHARS),
      deliveryAttemptsJson: input.deliveryAttemptsJson,
      createdAtMs: input.createdAtMs,
      completedAtMs: input.completedAtMs,
    },
  };
}

export function createLocalConsoleEventBuilder(): LocalConsoleEventBuilder {
  return {
    sessionStart(input) {
      const items: IngestItemV1[] = [];
      const sessionItem = createSessionUpsert(input);
      if (sessionItem) {
        items.push(sessionItem);
      }
      items.push(createAuditItem({
        ...input,
        hookName: "session_start",
        eventType: "session_lifecycle",
        category: "session",
        subCategory: "start",
        direction: "internal",
        title: "Session started",
        summary: input.summary ?? "Session lifecycle start observed.",
      }));
      return items;
    },

    sessionEnd(input) {
      const occurredAtMs = normalizeOccurredAtMs(input.occurredAtMs);
      const items: IngestItemV1[] = [];
      const sessionItem = createSessionUpsert({
        ...input,
        occurredAtMs,
      }, occurredAtMs);
      if (sessionItem) {
        items.push(sessionItem);
      }
      items.push(createAuditItem({
        ...input,
        occurredAtMs,
        hookName: "session_end",
        eventType: "session_lifecycle",
        category: "session",
        subCategory: "end",
        direction: "internal",
        title: "Session ended",
        summary: input.summary ?? "Session lifecycle end observed.",
      }));
      return items;
    },

    gatewayStart(input) {
      return [
        createAuditItem({
          ...input,
          hookName: "gateway_start",
          eventType: "gateway_start",
          category: "system",
          subCategory: "startup",
          direction: "internal",
          title: "Gateway startup observed",
          summary: input.summary ?? "Gateway startup hook executed.",
          payloadJson: cleanRecord({
            ...(input.payloadJson ?? {}),
            port: input.port,
            autoStart: input.autoStart,
            backendHealthy: input.backendHealthy,
            startReason: input.startReason,
          }),
        }),
      ];
    },

    beforeDispatch(input) {
      const items: IngestItemV1[] = [];
      const sessionItem = createDerivedSessionUpsert(input);
      if (sessionItem) {
        items.push(sessionItem);
      }
      items.push(
        createAuditItem({
          ...input,
          hookName: "before_dispatch",
          eventType: "dispatch_route",
          category: "dispatch",
          subCategory: input.localApprovalReply ? "local_approval_reply" : input.specialRoute,
          direction: "internal",
          title: "Dispatch branch observed",
          summary: input.summary ?? "Selective before_dispatch branch recorded.",
          payloadJson: cleanRecord({
            ...(input.payloadJson ?? {}),
            localApprovalReply: input.localApprovalReply,
            specialRoute: input.specialRoute,
          }),
        }),
      );
      return items;
    },

    messageReceived(input) {
      const items: IngestItemV1[] = [];
      const sessionItem = createDerivedSessionUpsert(input);
      if (sessionItem) {
        items.push(sessionItem);
      }
      items.push(
        createAuditItem({
          ...input,
          hookName: "message_received",
          eventType: "input_guard",
          category: "input",
          direction: "input",
          title: "Inbound message received",
          summary: input.summary ?? "Inbound message evaluated by input guard.",
          contentExcerpt: input.contentExcerpt ?? (typeof input.content === "string" ? input.content : stableSerialize(input.content)),
        }),
      );
      return items;
    },

    beforeAgentStart(input) {
      const items: IngestItemV1[] = [];
      const sessionItem = createDerivedSessionUpsert(input);
      if (sessionItem) {
        items.push(sessionItem);
      }
      const qaRecordItem = createQARecordUpsert({
        ...input,
        userPrompt: input.promptText ?? input.contentExcerpt,
        status: input.enforcementAction === "block" ? "blocked" : "running",
      });
      if (qaRecordItem) {
        items.push(qaRecordItem);
      }
      items.push(
        createAuditItem({
          ...input,
          requestId: input.lynxCheck?.requestId ?? input.requestId,
          hookName: "before_agent_start",
          eventType: "agent_start_evaluated",
          category: "agent",
          subCategory: input.lynxCheck ? "managed_lynx_check" : undefined,
          direction: "input",
          title: "Agent start evaluated",
          summary: input.summary ?? "Agent start prompt evaluated before launch.",
          contentExcerpt: input.contentExcerpt ?? input.promptText,
        }),
      );
      if (input.lynxCheck) {
        items.push(createLynxCheckUpsert(input.lynxCheck, input));
      }
      return items;
    },

    agentEnd(input) {
      const items: IngestItemV1[] = [];
      const sessionItem = createDerivedSessionUpsert(input);
      if (sessionItem) {
        items.push(sessionItem);
      }
      const occurredAtMs = normalizeOccurredAtMs(input.occurredAtMs);
      const qaRecordItem = createQARecordUpsert({
        ...input,
        occurredAtMs,
        finalAnswer: input.outputText ?? input.contentExcerpt,
        status: input.enforcementAction === "block" ? "blocked" : "completed",
        completedAtMs: occurredAtMs,
      });
      if (qaRecordItem) {
        items.push(qaRecordItem);
      }
      items.push(
        createAuditItem({
          ...input,
          hookName: "agent_end",
          eventType: "agent_end",
          category: "agent",
          direction: "output",
          title: "Agent finished",
          summary: input.summary ?? "Agent end hook completed.",
          contentExcerpt: input.contentExcerpt ?? input.outputText,
        }),
      );
      if (input.lynxCheck) {
        items.push(createLynxCheckUpsert(input.lynxCheck, input));
      }
      return items;
    },

    beforeMessageWrite(input) {
      const items: IngestItemV1[] = [];
      const sessionItem = createDerivedSessionUpsert(input);
      if (sessionItem) {
        items.push(sessionItem);
      }
      items.push(
        createAuditItem({
          ...input,
          hookName: "before_message_write",
          eventType: "assistant_message_prepare",
          category: "output",
          subCategory: input.blocked ? "blocked" : input.messageChanged ? "mutated" : "pass_through",
          direction: "output",
          title: "Assistant message prepared",
          summary: input.summary ?? "Assistant message evaluated before persistence.",
          payloadJson: cleanRecord({
            ...(input.payloadJson ?? {}),
            messageRole: input.messageRole,
            messageChanged: input.messageChanged,
            blocked: input.blocked,
          }),
        }),
      );
      return items;
    },

    toolResultPersist(input) {
      const items: IngestItemV1[] = [];
      const sessionItem = createDerivedSessionUpsert(input);
      if (sessionItem) {
        items.push(sessionItem);
      }
      items.push(
        createAuditItem({
          ...input,
          toolCallId: input.toolCallId,
          hookName: "tool_result_persist",
          eventType: "tool_result_persist",
          category: "output",
          subCategory: input.blocked ? "blocked" : undefined,
          direction: "output",
          contentKind: "tool_result",
          title: "Tool result prepared for persistence",
          summary: input.summary ?? "Tool result evaluated before persistence.",
          payloadJson: cleanRecord({
            ...(input.payloadJson ?? {}),
            toolName: input.toolName,
            blocked: input.blocked,
          }),
        }),
      );
      return items;
    },

    messageSending(input) {
      const items: IngestItemV1[] = [];
      const sessionItem = createDerivedSessionUpsert(input);
      if (sessionItem) {
        items.push(sessionItem);
      }
      items.push(
        createAuditItem({
          ...input,
          toolCallId: input.toolCallId,
          requestId: input.lynxCheck?.requestId ?? input.requestId,
          hookName: "message_sending",
          eventType: "message_sending",
          category: "output",
          subCategory: input.lynxCheck ? "managed_lynx_check" : input.canceled ? "cancelled" : undefined,
          direction: "output",
          title: "Outbound message sending",
          summary: input.summary ?? "Outbound message evaluated before sending.",
          payloadJson: cleanRecord({
            ...(input.payloadJson ?? {}),
            canceled: input.canceled,
            targetKey: input.targetKey,
          }),
        }),
      );
      if (input.lynxCheck) {
        items.push(createLynxCheckUpsert(input.lynxCheck, input));
      }
      return items;
    },

    beforeToolCall(input) {
      const toolCallItem = createToolCallUpsert({
        ...input,
        approvalId: input.approval?.approvalId ?? input.approvalId,
      }, "before");
      const items: IngestItemV1[] = [];
      const sessionItem = createDerivedSessionUpsert(input);
      if (sessionItem) {
        items.push(sessionItem);
      }
      items.push(
        createAuditItem({
          ...input,
          toolCallId: toolCallItem.data.toolCallId,
          approvalId: input.approval?.approvalId ?? input.approvalId,
          primaryModule: input.primaryModule ?? input.approval?.module ?? input.triggeredModules?.[0] ?? input.modules?.[0],
          modules: input.triggeredModules ?? input.modules,
          hookName: "before_tool_call",
          eventType: "tool_call_evaluated",
          category: "tool",
          direction: "internal",
          title: "Tool call evaluated",
          summary: input.summary ?? "Tool call evaluated before execution.",
          payloadJson: cleanRecord({
            ...(input.payloadJson ?? {}),
            toolName: input.toolName,
            paramSummary: truncateText(input.paramSummary ?? stableSerialize(input.params), STORED_EXCERPT_MAX_CHARS),
          }),
        }),
      );
      items.push(toolCallItem);
      if (input.approval) {
        items.push(createApprovalUpsert(input.approval, input));
      }
      return items;
    },

    afterToolCall(input) {
      const toolCallItem = createToolCallUpsert(input, "after");
      const items: IngestItemV1[] = [];
      const sessionItem = createDerivedSessionUpsert(input);
      if (sessionItem) {
        items.push(sessionItem);
      }
      items.push(
        createAuditItem({
          ...input,
          toolCallId: toolCallItem.data.toolCallId,
          hookName: "after_tool_call",
          eventType: "tool_call_completed",
          category: "tool",
          direction: "internal",
          title: "Tool call completed",
          summary: input.summary ?? "Tool call completed.",
          payloadJson: cleanRecord({
            ...(input.payloadJson ?? {}),
            toolName: input.toolName,
            resultStatus: input.resultStatus,
          }),
        }),
      );
      items.push(toolCallItem);
      return items;
    },
  };
}
