import type {
  ApprovalScopeType,
  EnforcementAction,
  LynxCheckPreferredTargetKind,
  LynxCheckSource,
  LynxCheckTrigger,
  RiskLevel,
  TokenTrendBucket,
} from "./enums.js";
import type { ResourcePolicyEvidence, ScriptPreflightEvidence } from "./decision.js";
import { LOCAL_CONSOLE_QUERY_API_VERSION } from "./enums.js";

export interface CursorPage<T> {
  items: T[];
  nextCursor?: string;
}

export interface PageResponse<T> {
  items: T[];
  total: number;
  pageNum: number;
  pageSize: number;
  totalPages: number;
}

export interface RiskBucketDto {
  riskLevel: RiskLevel;
  count: number;
}

export interface EnforcementBucketDto {
  enforcementAction: EnforcementAction;
  count: number;
}

export interface TimeSeriesPointDto {
  bucketStartMs: number;
  value: number;
}

export interface CommonListQuery {
  q?: string;
  fromMs?: number;
  toMs?: number;
  sessionKey?: string;
  runId?: string;
  riskLevel?: RiskLevel[];
  enforcementAction?: EnforcementAction[];
  pageNum?: number;
  pageSize?: number;
  limit?: number;
  cursor?: string;
}

export interface HealthDto {
  ok: boolean;
  serverTimeMs: number;
  schemaVersion: string;
}

export interface CapabilitiesDto {
  tokenUsageEnabled: boolean;
  gatewayAuthLogsEnabled: boolean;
  queryApiVersion: typeof LOCAL_CONSOLE_QUERY_API_VERSION;
}

export interface AuditEventListItemDto {
  eventId: string;
  qaRecordId?: string;
  sessionKey?: string;
  runId?: string;
  toolCallId?: string;
  approvalId?: string;
  requestId?: string;
  sourceKind: string;
  hookName: string;
  eventType: string;
  category: string;
  subCategory?: string;
  direction?: string;
  primaryModule?: string;
  riskLevel?: RiskLevel;
  riskScore?: number;
  policyDecision?: string;
  enforcementAction: EnforcementAction;
  title: string;
  summary?: string;
  recommendation?: string;
  contentExcerpt?: string;
  occurredAtMs: number;
}

export type AuditEventListResponse = PageResponse<AuditEventListItemDto>;

export interface AuditEventDetailDto extends AuditEventListItemDto {
  contentKind?: string;
  modules?: string[];
  recommendation?: string;
  contentHash?: string;
  ingestedAtMs: number;
  payloadJson?: Record<string, unknown>;
}

export type SecurityEventKind = "input" | "tool" | "output" | "install" | "process";

export type SecurityProcessKind =
  | "conversation"
  | "skill_install"
  | "plugin_install"
  | "lynx_check"
  | "approval"
  | "batch_operation"
  | "other";

export interface SecurityEventListItemDto {
  eventId: string;
  eventKind: SecurityEventKind;
  processKind: SecurityProcessKind;
  processId?: string;
  qaRecordId?: string;
  runId?: string;
  sessionKey?: string;
  toolCallId?: string;
  title: string;
  summary?: string;
  objectLabel?: string;
  contentExcerpt?: string;
  occurredAtMs: number;
  completedAtMs?: number;
  riskLevel: RiskLevel;
  riskScore?: number;
  policyDecision?: string;
  enforcementAction: EnforcementAction;
  rawAuditEventIds: string[];
  rawAuditCount: number;
  detailJson?: Record<string, unknown>;
}

export interface SecurityEventDetailDto extends SecurityEventListItemDto {
  rawAuditEvents: AuditEventListItemDto[];
}

export type SecurityEventListResponse = PageResponse<SecurityEventListItemDto>;

export interface SecurityEventSummaryDto {
  total: number;
  riskCounts: Partial<Record<RiskLevel, number>>;
  eventKindCounts: Partial<Record<SecurityEventKind, number>>;
  enforcementActionCounts: Partial<Record<EnforcementAction, number>>;
}

export interface ToolCallListItemDto {
  toolCallId: string;
  qaRecordId?: string;
  sessionKey?: string;
  runId?: string;
  approvalId?: string;
  toolName: string;
  riskLevel?: RiskLevel;
  riskScore?: number;
  policyDecision?: string;
  enforcementAction: EnforcementAction;
  startedAtMs: number;
  finishedAtMs?: number;
  durationMs?: number;
  resultStatus?: string;
  resultExcerpt?: string;
}

export type ToolCallListResponse = PageResponse<ToolCallListItemDto>;

export interface ScriptPreflightMetadataDto {
  policyVersion?: number;
  evidence?: ScriptPreflightEvidence[];
  [key: string]: unknown;
}

export interface DecisionReplayMetadataDto {
  policyVersion?: number;
  scriptEvidence?: ScriptPreflightEvidence[];
  resourceEvidence?: ResourcePolicyEvidence[];
  policyAuthority?: string;
  scriptEvidenceCount?: number;
  resourceEvidenceCount?: number;
  localFallbackUsed?: boolean;
  [key: string]: unknown;
}

export interface ToolCallDetailDto extends ToolCallListItemDto {
  paramSummary?: string;
  paramHash?: string;
  triggeredModules?: string[];
  errorText?: string;
  metadataJson?: Record<string, unknown> & {
    scriptPreflight?: ScriptPreflightMetadataDto;
  };
}

export interface ApprovalListItemDto {
  approvalId: string;
  qaRecordId?: string;
  pendingId?: string;
  sessionKey?: string;
  runId?: string;
  transport?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: RiskLevel;
  toolName?: string;
  scopeType: ApprovalScopeType;
  requestedAtMs: number;
  expiresAtMs: number;
  resolvedAtMs?: number;
  resolution?: string;
  promptExcerpt?: string;
}

export type ApprovalListResponse = PageResponse<ApprovalListItemDto>;

export interface ApprovalDetailDto extends ApprovalListItemDto {
  channelProfile?: string;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  approverOuIds?: string[];
  resolvedApproverOuId?: string;
  requestFingerprintHash?: string;
  auditSummaryJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
}

export interface LynxCheckListItemDto {
  requestId: string;
  qaRecordId?: string;
  source: LynxCheckSource;
  trigger: LynxCheckTrigger;
  preferredTargetKind: LynxCheckPreferredTargetKind;
  sessionKey?: string;
  targetKey?: string;
  channelId?: string;
  messageProvider?: string;
  status: string;
  sendAttempted: boolean;
  sendSucceeded: boolean;
  transport?: string;
  reportPath?: string;
  errorMessage?: string;
  createdAtMs: number;
  completedAtMs?: number;
}

export type LynxCheckListResponse = PageResponse<LynxCheckListItemDto>;

export interface LynxCheckDetailDto extends LynxCheckListItemDto {
  reportMarkdown?: string;
  deliveryAttemptsJson?: Array<Record<string, unknown>>;
}

export interface SessionListItemDto {
  sessionKey: string;
  channelProfile?: string;
  channelId?: string;
  requesterId?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  isGroup: boolean;
  firstSeenAtMs: number;
  lastSeenAtMs: number;
  endedAtMs?: number;
  eventCount?: number;
  highRiskEventCount?: number;
  toolCallCount?: number;
}

export type SessionListResponse = PageResponse<SessionListItemDto>;

export interface SessionDetailDto extends SessionListItemDto {
  metadataJson?: Record<string, unknown>;
  recentEvents: AuditEventListItemDto[];
  recentToolCalls: ToolCallListItemDto[];
  recentApprovals: ApprovalListItemDto[];
  tokenSummary?: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  };
}

export interface TokenUsageListItemDto {
  usageEventId: string;
  qaRecordId?: string;
  sessionKey?: string;
  runId?: string;
  agentId?: string;
  provider: string;
  model: string;
  sourceType: "actual" | "estimated" | "unavailable";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  assistantTextCount: number;
  isEstimated: boolean;
  occurredAtMs: number;
}

export type TokenUsageListResponse = PageResponse<TokenUsageListItemDto>;

export interface TokenSummaryDto {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  actualTokens?: number;
  estimatedTokens?: number;
  measurableTokens?: number;
  measurableInputTokens?: number;
  measurableOutputTokens?: number;
  measurableCacheReadTokens?: number;
  measurableCacheWriteTokens?: number;
  estimatedCount: number;
  unavailableCount: number;
  topModels: Array<{
    model: string;
    totalTokens: number;
  }>;
}

export interface TokenTrendPointDto {
  bucketStartMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TokenTrendDto {
  bucket: TokenTrendBucket;
  points: TokenTrendPointDto[];
}

export interface QaRecordListItemDto {
  qaRecordId: string;
  sessionKey?: string;
  runId?: string;
  agentId?: string;
  userPromptExcerpt?: string;
  finalAnswerExcerpt?: string;
  status: string;
  riskLevel?: RiskLevel;
  riskScore?: number;
  toolCallCount: number;
  approvalCount: number;
  detectionCount: number;
  totalTokens: number;
  startedAtMs: number;
  completedAtMs?: number;
  linkOrigin?: "runtime" | "inferred" | "legacy";
}

export type QaRecordListResponse = PageResponse<QaRecordListItemDto>;

export interface QaRecordSummaryDto {
  total: number;
  toolCallCount: number;
  approvalCount: number;
  detectionCount: number;
  totalTokens: number;
  riskCounts: Partial<Record<RiskLevel, number>>;
  statusCounts: Record<string, number>;
}

export type QaChainNodeType =
  | "userPrompt"
  | "agentStep"
  | "toolCall"
  | "terminal"
  | "approval"
  | "detection"
  | "auditEvent"
  | "tokenUsage"
  | "finalAnswer";

export interface QaChainNodeDto {
  nodeId: string;
  qaRecordId: string;
  type: QaChainNodeType;
  title: string;
  summary?: string;
  occurredAtMs: number;
  completedAtMs?: number;
  status?: string;
  riskLevel?: RiskLevel;
  detailRef?: { kind: string; id: string };
  detailJson?: Record<string, unknown>;
}

export interface QaChainEdgeDto {
  fromNodeId: string;
  toNodeId: string;
  label?: string;
}

export interface QaRecordDetailDto extends QaRecordListItemDto {
  displayChainNodes: SecurityEventListItemDto[];
  chainNodes: QaChainNodeDto[];
  chainEdges: QaChainEdgeDto[];
  relatedToolCalls: ToolCallListItemDto[];
  relatedApprovals: ApprovalListItemDto[];
  relatedEvents: AuditEventListItemDto[];
  relatedDetections: LynxCheckListItemDto[];
}

export interface DashboardOverviewDto {
  totals: {
    eventCount: number;
    toolCallCount: number;
    approvalCount: number;
    lynxCheckCount: number;
    totalTokens: number;
  };
  riskDistribution: RiskBucketDto[];
  enforcementDistribution: EnforcementBucketDto[];
  eventTrend: TimeSeriesPointDto[];
  tokenTrend: TimeSeriesPointDto[];
  recentSecurityEvents: SecurityEventListItemDto[];
  recentToolCalls: ToolCallListItemDto[];
  recentApprovals: ApprovalListItemDto[];
}
