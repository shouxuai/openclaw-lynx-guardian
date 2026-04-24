import { afterEach, describe, expect, it } from "vitest";

import { createQueryFixture, createTestApp, ingestBatch } from "./test-helpers.js";

describe("query routes for audit events", () => {
  const cleanupApps: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    while (cleanupApps.length > 0) {
      const harness = cleanupApps.pop();
      if (harness) {
        await harness.close();
      }
    }
  });

  it("lists and loads audit events with cursor pagination and camelCase DTO fields", async () => {
    const harness = await createTestApp("lynx-console-query-events-");
    cleanupApps.push(harness);
    const { app } = harness;
    const fixture = createQueryFixture();

    const seedResponse = await ingestBatch(app, fixture.batch);
    expect(seedResponse.statusCode).toBe(200);
    expect(seedResponse.json()).toEqual(
      expect.objectContaining({
        persistedCount: fixture.batch.items.length,
      }),
    );

    const listResponse = await app.inject({
      method: "GET",
      url: "/lynx/events?limit=1",
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toEqual({
      items: [
        expect.objectContaining({
          eventId: fixture.ids.eventApproval,
          sessionKey: fixture.ids.sessionAlpha,
          toolCallId: fixture.ids.toolCallApproval,
          approvalId: fixture.ids.approval,
          hookName: "before_tool_call",
          riskLevel: "L3",
          enforcementAction: "requireApproval",
          contentExcerpt: "exec command requires approval",
          recommendation: "Review requester identity before approving exec.",
        }),
      ],
      nextCursor: expect.any(String),
    });

    const pageTwoResponse = await app.inject({
      method: "GET",
      url: `/lynx/events?limit=1&cursor=${encodeURIComponent(listResponse.json().nextCursor)}`,
    });

    expect(pageTwoResponse.statusCode).toBe(200);
    expect(pageTwoResponse.json().items).toEqual([
      expect.objectContaining({
        eventId: fixture.ids.eventBeta,
      }),
    ]);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/lynx/events/${fixture.ids.eventApproval}`,
    });

    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toEqual(
      expect.objectContaining({
        eventId: fixture.ids.eventApproval,
        enforcementAction: "requireApproval",
        modules: ["M2:protected_file_access"],
        payloadJson: {
          toolName: "exec",
        },
        ingestedAtMs: expect.any(Number),
      }),
    );
  });

  it("filters audit events with a keyword query across event content and identifiers", async () => {
    const harness = await createTestApp("lynx-console-query-events-search-");
    cleanupApps.push(harness);
    const { app } = harness;
    const fixture = createQueryFixture();

    const seedResponse = await ingestBatch(app, fixture.batch);
    expect(seedResponse.statusCode).toBe(200);

    const contentResponse = await app.inject({
      method: "GET",
      url: "/lynx/events?limit=5&q=exec",
    });

    expect(contentResponse.statusCode).toBe(200);
    expect(contentResponse.json().items).toEqual([
      expect.objectContaining({
        eventId: fixture.ids.eventApproval,
        title: "Tool call evaluated",
      }),
    ]);

    const idResponse = await app.inject({
      method: "GET",
      url: `/lynx/events?limit=5&q=${fixture.ids.eventBeta}`,
    });

    expect(idResponse.statusCode).toBe(200);
    expect(idResponse.json().items).toEqual([
      expect.objectContaining({
        eventId: fixture.ids.eventBeta,
      }),
    ]);
  });
});
