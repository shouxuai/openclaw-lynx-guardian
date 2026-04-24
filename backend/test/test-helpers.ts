import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import type { FastifyInstance } from "fastify";

import type { IngestBatchRequestV1, IngestItemV1 } from "../../shared/src/ingest.js";
import { LOCAL_CONSOLE_INGEST_SCHEMA_VERSION } from "../../shared/src/enums.js";
import { createLocalConsoleApp } from "../src/app.js";

export interface TestAppHarness {
  app: FastifyInstance;
  dataDir: string;
  close(): Promise<void>;
}

export interface QueryFixtureIds {
  sessionAlpha: string;
  sessionBeta: string;
  eventAllow: string;
  eventApproval: string;
  eventBeta: string;
  toolCallApproval: string;
  toolCallRead: string;
  approval: string;
  lynxCheck: string;
  tokenUsagePrimary: string;
  tokenUsageSecondary: string;
}

export interface QueryFixture {
  batch: IngestBatchRequestV1;
  ids: QueryFixtureIds;
  baseTimeMs: number;
}

export async function createTestApp(prefix: string): Promise<TestAppHarness> {
  const dataDir = mkdtempSync(join(tmpdir(), prefix));
  const app = await createLocalConsoleApp({
    dataDir,
    databasePath: join(dataDir, "lynx.db"),
    ingestToken: "test-token",
    host: "127.0.0.1",
    port: 31789,
  });

  return {
    app,
    dataDir,
    async close() {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function ingestBatch(
  app: FastifyInstance,
  payload: IngestBatchRequestV1,
) {
  return app.inject({
    method: "POST",
    url: "/lynx/internal/v1/ingest/batch",
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    payload,
  });
}

export function buildBatch(batchId: string, items: IngestItemV1[], sentAtMs = Date.now()): IngestBatchRequestV1 {
  return {
    schemaVersion: LOCAL_CONSOLE_INGEST_SCHEMA_VERSION,
    producer: {
      pluginId: "openclaw-lynx-guardian",
    },
    sentAtMs,
    batchId,
    items,
  };
}

export function createQueryFixture(baseTimeMs = 1_776_928_800_000): QueryFixture {
  const ids: QueryFixtureIds = {
    sessionAlpha: "session-alpha",
    sessionBeta: "session-beta",
    eventAllow: "event-allow",
    eventApproval: "event-approval",
    eventBeta: "event-beta",
    toolCallApproval: "tool-call-approval",
    toolCallRead: "tool-call-read",
    approval: "approval-alpha",
    lynxCheck: "lynx-check-alpha",
    tokenUsagePrimary: "usage-primary",
    tokenUsageSecondary: "usage-secondary",
  };

  return {
    baseTimeMs,
    ids,
    batch: buildBatch("fixture-batch", [
      {
        kind: "sessionUpsert",
        itemId: "session-alpha-upsert",
        occurredAtMs: baseTimeMs - 5_000,
        data: {
          sessionKey: ids.sessionAlpha,
          channelProfile: "feishu",
          channelId: "feishu",
          requesterId: "user-alpha",
          requesterOuId: "ou_alpha",
          accountId: "account-alpha",
          conversationId: "conv-alpha",
          threadId: "thread-alpha",
          isGroup: false,
          firstSeenAtMs: baseTimeMs - 5_000,
          lastSeenAtMs: baseTimeMs - 1_000,
          metadataJson: {
            source: "fixture",
          },
        },
      },
      {
        kind: "sessionUpsert",
        itemId: "session-beta-upsert",
        occurredAtMs: baseTimeMs - 4_000,
        data: {
          sessionKey: ids.sessionBeta,
          channelProfile: "feishu",
          channelId: "group-chat",
          requesterId: "user-beta",
          requesterOuId: "ou_beta",
          accountId: "account-beta",
          conversationId: "conv-beta",
          threadId: "thread-beta",
          isGroup: true,
          firstSeenAtMs: baseTimeMs - 4_000,
          lastSeenAtMs: baseTimeMs - 2_000,
        },
      },
      {
        kind: "auditEvent",
        itemId: "event-allow-item",
        occurredAtMs: baseTimeMs - 4_200,
        data: {
          eventId: ids.eventAllow,
          sessionKey: ids.sessionAlpha,
          runId: "run-alpha",
          sourceKind: "plugin_hook",
          hookName: "message_received",
          eventType: "input_guard",
          category: "input",
          direction: "input",
          enforcementAction: "allow",
          title: "Inbound message received",
          summary: "The input was allowed.",
        },
      },
      {
        kind: "auditEvent",
        itemId: "event-approval-item",
        occurredAtMs: baseTimeMs - 1_000,
        data: {
          eventId: ids.eventApproval,
          sessionKey: ids.sessionAlpha,
          runId: "run-alpha",
          toolCallId: ids.toolCallApproval,
          approvalId: ids.approval,
          sourceKind: "plugin_hook",
          hookName: "before_tool_call",
          eventType: "tool_call_evaluated",
          category: "tool",
          subCategory: "approval",
          direction: "internal",
          primaryModule: "M2:protected_file_access",
          modules: ["M2:protected_file_access"],
          riskLevel: "L3",
          riskScore: 8,
          policyDecision: "confirm",
          enforcementAction: "requireApproval",
          title: "Tool call evaluated",
          summary: "Approval is required before running exec.",
          recommendation: "Review requester identity before approving exec.",
          contentExcerpt: "exec command requires approval",
          payloadJson: {
            toolName: "exec",
          },
        },
      },
      {
        kind: "auditEvent",
        itemId: "event-beta-item",
        occurredAtMs: baseTimeMs - 2_000,
        data: {
          eventId: ids.eventBeta,
          sessionKey: ids.sessionBeta,
          runId: "run-beta",
          requestId: ids.lynxCheck,
          sourceKind: "plugin_hook",
          hookName: "before_agent_start",
          eventType: "agent_start_evaluated",
          category: "agent",
          direction: "input",
          riskLevel: "L2",
          riskScore: 6,
          policyDecision: "allow",
          enforcementAction: "warn",
          title: "Agent start evaluated",
          summary: "Managed lynx check started.",
        },
      },
      {
        kind: "toolCallUpsert",
        itemId: "tool-call-approval-item",
        occurredAtMs: baseTimeMs - 1_000,
        data: {
          toolCallId: ids.toolCallApproval,
          sessionKey: ids.sessionAlpha,
          runId: "run-alpha",
          approvalId: ids.approval,
          toolName: "exec",
          paramSummary: "command=git status",
          paramHash: "hash-exec",
          triggeredModules: ["M2:protected_file_access"],
          riskLevel: "L3",
          riskScore: 8,
          policyDecision: "confirm",
          enforcementAction: "requireApproval",
          startedAtMs: baseTimeMs - 1_000,
          finishedAtMs: baseTimeMs - 900,
          durationMs: 100,
          resultStatus: "approved",
          resultExcerpt: "git status",
          metadataJson: {
            phase: "before",
          },
        },
      },
      {
        kind: "toolCallUpsert",
        itemId: "tool-call-read-item",
        occurredAtMs: baseTimeMs - 2_500,
        data: {
          toolCallId: ids.toolCallRead,
          sessionKey: ids.sessionBeta,
          runId: "run-beta",
          toolName: "read",
          paramSummary: "path=/tmp/report.md",
          paramHash: "hash-read",
          triggeredModules: ["M1:normal_read"],
          riskLevel: "L1",
          riskScore: 2,
          policyDecision: "allow",
          enforcementAction: "allow",
          startedAtMs: baseTimeMs - 2_500,
          finishedAtMs: baseTimeMs - 2_350,
          durationMs: 150,
          resultStatus: "completed",
          resultExcerpt: "report body",
        },
      },
      {
        kind: "approvalUpsert",
        itemId: "approval-item",
        occurredAtMs: baseTimeMs - 1_100,
        data: {
          approvalId: ids.approval,
          pendingId: ids.approval,
          sessionKey: ids.sessionAlpha,
          runId: "run-alpha",
          transport: "local-chat",
          channelProfile: "feishu",
          channelId: "feishu",
          accountId: "account-alpha",
          conversationId: "conv-alpha",
          requesterOuId: "ou_alpha",
          approverOuIds: ["ou_owner"],
          resolvedApproverOuId: "ou_owner",
          requestFingerprintHash: "fingerprint-alpha",
          module: "M2:protected_file_access",
          riskLevel: "L3",
          toolName: "exec",
          scopeType: "singleTool",
          requestedAtMs: baseTimeMs - 1_100,
          expiresAtMs: baseTimeMs + 60_000,
          resolvedAtMs: baseTimeMs - 950,
          resolution: "allow-once",
          promptExcerpt: "Need approval before exec.",
          auditSummaryJson: {
            reason: "protected file access",
          },
          metadataJson: {
            source: "fixture",
          },
        },
      },
      {
        kind: "lynxCheckUpsert",
        itemId: "lynx-check-item",
        occurredAtMs: baseTimeMs - 1_800,
        data: {
          requestId: ids.lynxCheck,
          source: "manual",
          trigger: "lynx_command",
          preferredTargetKind: "current",
          sessionKey: ids.sessionBeta,
          targetKey: "feishu:group-chat:conv-beta",
          channelId: "group-chat",
          messageProvider: "feishu",
          status: "completed",
          sendAttempted: true,
          sendSucceeded: true,
          transport: "feishu",
          reportPath: "/tmp/report.md",
          createdAtMs: baseTimeMs - 2_000,
          completedAtMs: baseTimeMs - 1_800,
        },
      },
      {
        kind: "tokenUsage",
        itemId: "token-usage-primary-item",
        occurredAtMs: baseTimeMs - 800,
        data: {
          usageEventId: ids.tokenUsagePrimary,
          sessionKey: ids.sessionAlpha,
          runId: "run-alpha",
          agentId: "agent-main",
          provider: "openai",
          model: "openclaw/main",
          inputTokens: 200,
          outputTokens: 100,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
          totalTokens: 315,
          assistantTextCount: 1,
        },
      },
      {
        kind: "tokenUsage",
        itemId: "token-usage-secondary-item",
        occurredAtMs: baseTimeMs - 600,
        data: {
          usageEventId: ids.tokenUsageSecondary,
          sessionKey: ids.sessionBeta,
          runId: "run-beta",
          agentId: "agent-main",
          provider: "openai",
          model: "openclaw/default",
          inputTokens: 80,
          outputTokens: 40,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 120,
          assistantTextCount: 1,
          isEstimated: true,
        },
      },
    ], baseTimeMs),
  };
}
