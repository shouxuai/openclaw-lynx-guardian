import type {
  ApprovalScopeType,
  EnforcementAction,
  IngestDirection,
  IngestItemKind,
  IngestSourceKind,
  LynxCheckPreferredTargetKind,
  LynxCheckSource,
  LynxCheckStatus,
  LynxCheckTrigger,
  RiskLevel,
} from "./enums.js";
import { LOCAL_CONSOLE_INGEST_SCHEMA_VERSION } from "./enums.js";

export type LocalConsoleIngestSchemaVersion = typeof LOCAL_CONSOLE_INGEST_SCHEMA_VERSION;

export interface IngestProducerV1 {
  pluginId: "openclaw-lynx-guardian";
  pluginVersion?: string;
  instanceId?: string;
  host?: string;
}

export interface IngestRejectedItemV1 {
  itemIndex: number;
  kind: IngestItemKind;
  code: string;
  message: string;
}

export interface IngestBatchRequestV1 {
  schemaVersion: LocalConsoleIngestSchemaVersion;
  producer: IngestProducerV1;
  sentAtMs: number;
  batchId: string;
  items: IngestItemV1[];
}

export interface IngestBatchResponseV1 {
  ok: boolean;
  schemaVersion: LocalConsoleIngestSchemaVersion;
  batchId: string;
  acceptedCount: number;
  persistedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  rejectedItems: IngestRejectedItemV1[];
  serverTimeMs: number;
}

export interface IngestItemBase {
  kind: IngestItemKind;
  itemId: string;
  occurredAtMs: number;
}

export interface SessionUpsertData {
  sessionKey: string;
  channelProfile?: string;
  channelId?: string;
  requesterId?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  isGroup?: boolean;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  endedAtMs?: number;
  metadataJson?: Record<string, unknown>;
}

export interface SessionUpsertItem extends IngestItemBase {
  kind: "sessionUpsert";
  data: SessionUpsertData;
}

export interface AuditEventData {
  eventId: string;
  sessionKey?: string;
  runId?: string;
  toolCallId?: string;
  approvalId?: string;
  requestId?: string;
  sourceKind: IngestSourceKind;
  hookName: string;
  eventType: string;
  category: string;
  subCategory?: string;
  direction?: IngestDirection;
  contentKind?: string;
  primaryModule?: string;
  modules?: string[];
  riskLevel?: RiskLevel;
  riskScore?: number;
  policyDecision?: string;
  enforcementAction: EnforcementAction;
  title: string;
  summary?: string;
  recommendation?: string;
  contentExcerpt?: string;
  contentHash?: string;
  payloadJson?: Record<string, unknown>;
}

export interface AuditEventItem extends IngestItemBase {
  kind: "auditEvent";
  data: AuditEventData;
}

export interface ToolCallUpsertData {
  toolCallId: string;
  sessionKey?: string;
  runId?: string;
  approvalId?: string;
  toolName: string;
  paramSummary?: string;
  paramHash?: string;
  triggeredModules?: string[];
  riskLevel?: RiskLevel;
  riskScore?: number;
  policyDecision?: string;
  enforcementAction: EnforcementAction;
  startedAtMs: number;
  finishedAtMs?: number;
  durationMs?: number;
  resultStatus?: string;
  resultExcerpt?: string;
  errorText?: string;
  metadataJson?: Record<string, unknown>;
}

export interface ToolCallUpsertItem extends IngestItemBase {
  kind: "toolCallUpsert";
  data: ToolCallUpsertData;
}

export interface ApprovalUpsertData {
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
  auditSummaryJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
}

export interface ApprovalUpsertItem extends IngestItemBase {
  kind: "approvalUpsert";
  data: ApprovalUpsertData;
}

export interface LynxCheckUpsertData {
  requestId: string;
  source: LynxCheckSource;
  trigger: LynxCheckTrigger;
  preferredTargetKind: LynxCheckPreferredTargetKind;
  sessionKey?: string;
  targetKey?: string;
  channelId?: string;
  messageProvider?: string;
  status: LynxCheckStatus;
  sendAttempted?: boolean;
  sendSucceeded?: boolean;
  transport?: string;
  reportPath?: string;
  errorMessage?: string;
  deliveryAttemptsJson?: Array<Record<string, unknown>>;
  createdAtMs: number;
  completedAtMs?: number;
}

export interface LynxCheckUpsertItem extends IngestItemBase {
  kind: "lynxCheckUpsert";
  data: LynxCheckUpsertData;
}

export interface TokenUsageData {
  usageEventId: string;
  sessionKey?: string;
  runId?: string;
  agentId?: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  assistantTextCount?: number;
  isEstimated?: boolean;
  payloadJson?: Record<string, unknown>;
}

export interface TokenUsageItem extends IngestItemBase {
  kind: "tokenUsage";
  data: TokenUsageData;
}

export type IngestItemV1 =
  | SessionUpsertItem
  | AuditEventItem
  | ToolCallUpsertItem
  | ApprovalUpsertItem
  | LynxCheckUpsertItem
  | TokenUsageItem;
