import { z } from "zod";

import {
  APPROVAL_SCOPE_TYPES,
  ENFORCEMENT_ACTIONS,
  INGEST_DIRECTIONS,
  INGEST_ITEM_KINDS,
  INGEST_SOURCE_KINDS,
  LOCAL_CONSOLE_INGEST_SCHEMA_VERSION,
  LYNX_CHECK_SOURCES,
  LYNX_CHECK_STATUSES,
  LYNX_CHECK_TARGET_KINDS,
  LYNX_CHECK_TRIGGERS,
  RISK_LEVELS,
  type IngestItemKind,
} from "../../../shared/src/enums.js";
import type {
  ApprovalUpsertItem,
  AuditEventItem,
  IngestBatchRequestV1,
  IngestBatchResponseV1,
  IngestItemV1,
  LynxCheckUpsertItem,
  SessionUpsertItem,
  TokenUsageItem,
  ToolCallUpsertItem,
} from "../../../shared/src/ingest.js";
import { IngestRepository } from "../repositories/ingest-repository.js";

const literalTuple = <T extends readonly [string, ...string[]]>(values: T) => values;

const riskLevelSchema = z.enum(literalTuple(RISK_LEVELS));
const enforcementActionSchema = z.enum(literalTuple(ENFORCEMENT_ACTIONS));
const sourceKindSchema = z.enum(literalTuple(INGEST_SOURCE_KINDS));
const directionSchema = z.enum(literalTuple(INGEST_DIRECTIONS));
const scopeTypeSchema = z.enum(literalTuple(APPROVAL_SCOPE_TYPES));
const lynxCheckSourceSchema = z.enum(literalTuple(LYNX_CHECK_SOURCES));
const lynxCheckTriggerSchema = z.enum(literalTuple(LYNX_CHECK_TRIGGERS));
const lynxCheckTargetKindSchema = z.enum(literalTuple(LYNX_CHECK_TARGET_KINDS));
const lynxCheckStatusSchema = z.enum(literalTuple(LYNX_CHECK_STATUSES));

const itemBaseSchema = z.object({
  itemId: z.string().min(1),
  occurredAtMs: z.number().int(),
});

const sessionUpsertSchema = itemBaseSchema.extend({
  kind: z.literal("sessionUpsert"),
  data: z.object({
    sessionKey: z.string().min(1),
    channelProfile: z.string().optional(),
    channelId: z.string().optional(),
    requesterId: z.string().optional(),
    requesterOuId: z.string().optional(),
    accountId: z.string().optional(),
    conversationId: z.string().optional(),
    threadId: z.union([z.string(), z.number().int()]).optional(),
    isGroup: z.boolean().optional(),
    firstSeenAtMs: z.number().int(),
    lastSeenAtMs: z.number().int(),
    endedAtMs: z.number().int().optional(),
    metadataJson: z.record(z.unknown()).optional(),
  }),
});

const auditEventSchema = itemBaseSchema.extend({
  kind: z.literal("auditEvent"),
  data: z.object({
    eventId: z.string().min(1),
    sessionKey: z.string().optional(),
    runId: z.string().optional(),
    toolCallId: z.string().optional(),
    approvalId: z.string().optional(),
    requestId: z.string().optional(),
    sourceKind: sourceKindSchema,
    hookName: z.string().min(1),
    eventType: z.string().min(1),
    category: z.string().min(1),
    subCategory: z.string().optional(),
    direction: directionSchema.optional(),
    contentKind: z.string().optional(),
    primaryModule: z.string().optional(),
    modules: z.array(z.string()).optional(),
    riskLevel: riskLevelSchema.optional(),
    riskScore: z.number().int().optional(),
    policyDecision: z.string().optional(),
    enforcementAction: enforcementActionSchema,
    title: z.string().min(1),
    summary: z.string().optional(),
    recommendation: z.string().optional(),
    contentExcerpt: z.string().optional(),
    contentHash: z.string().optional(),
    payloadJson: z.record(z.unknown()).optional(),
  }),
});

const toolCallSchema = itemBaseSchema.extend({
  kind: z.literal("toolCallUpsert"),
  data: z.object({
    toolCallId: z.string().min(1),
    sessionKey: z.string().optional(),
    runId: z.string().optional(),
    approvalId: z.string().optional(),
    toolName: z.string().min(1),
    paramSummary: z.string().optional(),
    paramHash: z.string().optional(),
    triggeredModules: z.array(z.string()).optional(),
    riskLevel: riskLevelSchema.optional(),
    riskScore: z.number().int().optional(),
    policyDecision: z.string().optional(),
    enforcementAction: enforcementActionSchema,
    startedAtMs: z.number().int(),
    finishedAtMs: z.number().int().optional(),
    durationMs: z.number().int().optional(),
    resultStatus: z.string().optional(),
    resultExcerpt: z.string().optional(),
    errorText: z.string().optional(),
    metadataJson: z.record(z.unknown()).optional(),
  }),
});

const approvalSchema = itemBaseSchema.extend({
  kind: z.literal("approvalUpsert"),
  data: z.object({
    approvalId: z.string().min(1),
    pendingId: z.string().optional(),
    sessionKey: z.string().optional(),
    runId: z.string().optional(),
    transport: z.string().optional(),
    channelProfile: z.string().optional(),
    channelId: z.string().optional(),
    accountId: z.string().optional(),
    conversationId: z.string().optional(),
    requesterOuId: z.string().optional(),
    approverOuIds: z.array(z.string()).optional(),
    resolvedApproverOuId: z.string().optional(),
    requestFingerprintHash: z.string().optional(),
    module: z.string().min(1),
    riskLevel: riskLevelSchema,
    toolName: z.string().optional(),
    scopeType: scopeTypeSchema,
    requestedAtMs: z.number().int(),
    expiresAtMs: z.number().int(),
    resolvedAtMs: z.number().int().optional(),
    resolution: z.string().optional(),
    promptExcerpt: z.string().optional(),
    auditSummaryJson: z.record(z.unknown()).optional(),
    metadataJson: z.record(z.unknown()).optional(),
  }),
});

const lynxCheckSchema = itemBaseSchema.extend({
  kind: z.literal("lynxCheckUpsert"),
  data: z.object({
    requestId: z.string().min(1),
    source: lynxCheckSourceSchema,
    trigger: lynxCheckTriggerSchema,
    preferredTargetKind: lynxCheckTargetKindSchema,
    sessionKey: z.string().optional(),
    targetKey: z.string().optional(),
    channelId: z.string().optional(),
    messageProvider: z.string().optional(),
    status: lynxCheckStatusSchema,
    sendAttempted: z.boolean().optional(),
    sendSucceeded: z.boolean().optional(),
    transport: z.string().optional(),
    reportPath: z.string().optional(),
    errorMessage: z.string().optional(),
    deliveryAttemptsJson: z.array(z.record(z.unknown())).optional(),
    createdAtMs: z.number().int(),
    completedAtMs: z.number().int().optional(),
  }),
});

const tokenUsageSchema = itemBaseSchema.extend({
  kind: z.literal("tokenUsage"),
  data: z.object({
    usageEventId: z.string().min(1),
    sessionKey: z.string().optional(),
    runId: z.string().optional(),
    agentId: z.string().optional(),
    provider: z.string().min(1),
    model: z.string().min(1),
    inputTokens: z.number().int().optional(),
    outputTokens: z.number().int().optional(),
    cacheReadTokens: z.number().int().optional(),
    cacheWriteTokens: z.number().int().optional(),
    totalTokens: z.number().int(),
    assistantTextCount: z.number().int().optional(),
    isEstimated: z.boolean().optional(),
    payloadJson: z.record(z.unknown()).optional(),
  }),
});

const ingestItemSchema = z.discriminatedUnion("kind", [
  sessionUpsertSchema,
  auditEventSchema,
  toolCallSchema,
  approvalSchema,
  lynxCheckSchema,
  tokenUsageSchema,
]);

const ingestBatchSchema = z.object({
  schemaVersion: z.literal(LOCAL_CONSOLE_INGEST_SCHEMA_VERSION),
  producer: z.object({
    pluginId: z.literal("openclaw-lynx-guardian"),
    pluginVersion: z.string().optional(),
    instanceId: z.string().optional(),
    host: z.string().optional(),
  }),
  sentAtMs: z.number().int(),
  batchId: z.string().min(1),
  items: z.array(z.unknown()),
});

function toRejectedKind(value: unknown): IngestItemKind {
  return INGEST_ITEM_KINDS.find((candidate) => candidate === value) ?? "auditEvent";
}

export class IngestService {
  constructor(
    private readonly repository: IngestRepository,
    private readonly now: () => number = () => Date.now(),
  ) {}

  processBatch(payload: unknown): IngestBatchResponseV1 {
    const parsedBatch = ingestBatchSchema.parse(payload) as IngestBatchRequestV1;
    const validItems: IngestItemV1[] = [];
    const rejectedItems: IngestBatchResponseV1["rejectedItems"] = [];

    parsedBatch.items.forEach((rawItem, itemIndex) => {
      const result = ingestItemSchema.safeParse(rawItem);
      if (!result.success) {
        rejectedItems.push({
          itemIndex,
          kind: toRejectedKind((rawItem as { kind?: unknown })?.kind),
          code: "invalid_item",
          message: result.error.issues.map((issue) => issue.message).join("; "),
        });
        return;
      }

      validItems.push(result.data as IngestItemV1);
    });

    let persistedCount = 0;
    let duplicateCount = 0;

    this.repository.withTransaction(() => {
      const ingestedAtMs = this.now();
      for (const item of validItems) {
        const result = this.persistItem(item, ingestedAtMs);
        if (result.status === "persisted") {
          persistedCount += 1;
        } else {
          duplicateCount += 1;
        }
      }
    });

    return {
      ok: true,
      schemaVersion: LOCAL_CONSOLE_INGEST_SCHEMA_VERSION,
      batchId: parsedBatch.batchId,
      acceptedCount: validItems.length,
      persistedCount,
      duplicateCount,
      rejectedCount: rejectedItems.length,
      rejectedItems,
      serverTimeMs: this.now(),
    };
  }

  private persistItem(item: IngestItemV1, ingestedAtMs: number) {
    switch (item.kind) {
      case "sessionUpsert":
        return this.repository.persistSession(item as SessionUpsertItem);
      case "auditEvent":
        return this.repository.persistAuditEvent(item as AuditEventItem, ingestedAtMs);
      case "toolCallUpsert":
        return this.repository.persistToolCall(item as ToolCallUpsertItem);
      case "approvalUpsert":
        return this.repository.persistApproval(item as ApprovalUpsertItem);
      case "lynxCheckUpsert":
        return this.repository.persistLynxCheck(item as LynxCheckUpsertItem);
      case "tokenUsage":
        return this.repository.persistTokenUsage(item as TokenUsageItem, ingestedAtMs);
    }
  }
}
