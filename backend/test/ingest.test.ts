import { afterEach, describe, expect, it } from "vitest";

import type { IngestBatchRequestV1 } from "../../shared/src/ingest.js";
import { LOCAL_CONSOLE_INGEST_SCHEMA_VERSION } from "../../shared/src/enums.js";
import { createTestApp } from "./test-helpers.js";

describe("POST /lynx/internal/v1/ingest/batch", () => {
  const cleanupApps: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    while (cleanupApps.length > 0) {
      const harness = cleanupApps.pop();
      if (harness) {
        await harness.close();
      }
    }
  });

  it("persists valid items and counts duplicate events separately", async () => {
    const harness = await createTestApp("lynx-console-ingest-");
    cleanupApps.push(harness);
    const { app } = harness;

    const payload: IngestBatchRequestV1 = {
      schemaVersion: LOCAL_CONSOLE_INGEST_SCHEMA_VERSION,
      producer: {
        pluginId: "openclaw-lynx-guardian",
      },
      sentAtMs: 1_746_000_000_000,
      batchId: "batch-1",
      items: [
        {
          kind: "sessionUpsert",
          itemId: "item-1",
          occurredAtMs: 1_746_000_000_000,
          data: {
            sessionKey: "session-1",
            firstSeenAtMs: 1_746_000_000_000,
            lastSeenAtMs: 1_746_000_000_000,
          },
        },
        {
          kind: "auditEvent",
          itemId: "item-2",
          occurredAtMs: 1_746_000_000_100,
          data: {
            eventId: "event-1",
            sourceKind: "plugin_hook",
            hookName: "message_received",
            eventType: "input_guard",
            category: "input",
            enforcementAction: "allow",
            title: "Received input",
          },
        },
      ],
    };

    try {
      const firstResponse = await app.inject({
        method: "POST",
        url: "/lynx/internal/v1/ingest/batch",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        payload,
      });

      expect(firstResponse.statusCode).toBe(200);
      expect(firstResponse.json()).toEqual(
        expect.objectContaining({
          ok: true,
          acceptedCount: 2,
          persistedCount: 2,
          duplicateCount: 0,
          rejectedCount: 0,
        }),
      );

      const duplicateResponse = await app.inject({
        method: "POST",
        url: "/lynx/internal/v1/ingest/batch",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        payload: {
          ...payload,
          batchId: "batch-2",
          items: [payload.items[1]],
        },
      });

      expect(duplicateResponse.statusCode).toBe(200);
      expect(duplicateResponse.json()).toEqual(
        expect.objectContaining({
          acceptedCount: 1,
          persistedCount: 0,
          duplicateCount: 1,
          rejectedCount: 0,
        }),
      );
    } finally {
      await app.close();
    }
  });

  it("reports invalid items without rejecting the whole batch", async () => {
    const harness = await createTestApp("lynx-console-ingest-invalid-");
    cleanupApps.push(harness);
    const { app } = harness;

    try {
      const response = await app.inject({
        method: "POST",
        url: "/lynx/internal/v1/ingest/batch",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        payload: {
          schemaVersion: LOCAL_CONSOLE_INGEST_SCHEMA_VERSION,
          producer: {
            pluginId: "openclaw-lynx-guardian",
          },
          sentAtMs: 1_746_000_000_000,
          batchId: "batch-invalid",
          items: [
            {
              kind: "sessionUpsert",
              itemId: "item-valid",
              occurredAtMs: 1_746_000_000_000,
              data: {
                sessionKey: "session-valid",
                firstSeenAtMs: 1_746_000_000_000,
                lastSeenAtMs: 1_746_000_000_100,
              },
            },
            {
              kind: "auditEvent",
              itemId: "item-invalid",
              occurredAtMs: 1_746_000_000_000,
              data: {
                eventId: "event-invalid",
                sourceKind: "plugin_hook",
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        expect.objectContaining({
          acceptedCount: 1,
          persistedCount: 1,
          duplicateCount: 0,
          rejectedCount: 1,
          rejectedItems: [
            expect.objectContaining({
              itemIndex: 1,
              kind: "auditEvent",
              code: "invalid_item",
            }),
          ],
        }),
      );
    } finally {
      await app.close();
    }
  });

  it("persists requireApproval tool items instead of failing the batch", async () => {
    const harness = await createTestApp("lynx-console-ingest-require-approval-");
    cleanupApps.push(harness);
    const { app } = harness;

    try {
      const response = await app.inject({
        method: "POST",
        url: "/lynx/internal/v1/ingest/batch",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        payload: {
          schemaVersion: LOCAL_CONSOLE_INGEST_SCHEMA_VERSION,
          producer: {
            pluginId: "openclaw-lynx-guardian",
          },
          sentAtMs: 1_776_928_800_000,
          batchId: "batch-require-approval",
          items: [
            {
              kind: "auditEvent",
              itemId: "approval-audit-item",
              occurredAtMs: 1_776_928_800_000,
              data: {
                eventId: "approval-audit-event",
                sessionKey: "session-approval",
                runId: "run-approval",
                toolCallId: "tool-call-approval",
                approvalId: "approval-001",
                sourceKind: "plugin_hook",
                hookName: "before_tool_call",
                eventType: "tool_call_evaluated",
                category: "tool",
                riskLevel: "L3",
                riskScore: 8,
                policyDecision: "confirm",
                enforcementAction: "requireApproval",
                title: "Tool call evaluated",
              },
            },
            {
              kind: "toolCallUpsert",
              itemId: "approval-tool-item",
              occurredAtMs: 1_776_928_800_000,
              data: {
                toolCallId: "tool-call-approval",
                sessionKey: "session-approval",
                runId: "run-approval",
                approvalId: "approval-001",
                toolName: "exec",
                riskLevel: "L3",
                riskScore: 8,
                policyDecision: "confirm",
                enforcementAction: "requireApproval",
                startedAtMs: 1_776_928_800_000,
              },
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        expect.objectContaining({
          acceptedCount: 2,
          persistedCount: 2,
          duplicateCount: 0,
          rejectedCount: 0,
        }),
      );
    } finally {
      await app.close();
    }
  });
});
