import { afterEach, describe, expect, it } from "vitest";

import { createQueryFixture, createTestApp, ingestBatch } from "./test-helpers.js";

describe("query routes for local console pages", () => {
  const cleanupApps: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    while (cleanupApps.length > 0) {
      const harness = cleanupApps.pop();
      if (harness) {
        await harness.close();
      }
    }
  });

  it("serves list and detail endpoints for tool calls, approvals, lynx checks, and sessions", async () => {
    const harness = await createTestApp("lynx-console-query-pages-");
    cleanupApps.push(harness);
    const { app } = harness;
    const fixture = createQueryFixture();

    const seedResponse = await ingestBatch(app, fixture.batch);
    expect(seedResponse.statusCode).toBe(200);

    const toolCallsResponse = await app.inject({
      method: "GET",
      url: "/lynx/tool-calls?limit=5&toolName=exec&approvalId=approval-alpha",
    });
    expect(toolCallsResponse.statusCode).toBe(200);
    expect(toolCallsResponse.json().items).toEqual([
      expect.objectContaining({
        toolCallId: fixture.ids.toolCallApproval,
        enforcementAction: "requireApproval",
        toolName: "exec",
      }),
    ]);

    const toolCallDetailResponse = await app.inject({
      method: "GET",
      url: `/lynx/tool-calls/${fixture.ids.toolCallApproval}`,
    });
    expect(toolCallDetailResponse.statusCode).toBe(200);
    expect(toolCallDetailResponse.json()).toEqual(
      expect.objectContaining({
        toolCallId: fixture.ids.toolCallApproval,
        triggeredModules: ["M2:protected_file_access"],
        metadataJson: {
          phase: "before",
        },
      }),
    );

    const approvalsResponse = await app.inject({
      method: "GET",
      url: "/lynx/approvals?limit=5&module=M2:protected_file_access&scopeType=singleTool&requesterOuId=ou_alpha",
    });
    expect(approvalsResponse.statusCode).toBe(200);
    expect(approvalsResponse.json().items).toEqual([
      expect.objectContaining({
        approvalId: fixture.ids.approval,
        scopeType: "singleTool",
        riskLevel: "L3",
      }),
    ]);

    const approvalDetailResponse = await app.inject({
      method: "GET",
      url: `/lynx/approvals/${fixture.ids.approval}`,
    });
    expect(approvalDetailResponse.statusCode).toBe(200);
    expect(approvalDetailResponse.json()).toEqual(
      expect.objectContaining({
        approvalId: fixture.ids.approval,
        approverOuIds: ["ou_owner"],
        metadataJson: {
          source: "fixture",
        },
      }),
    );

    const lynxChecksResponse = await app.inject({
      method: "GET",
      url: "/lynx/lynx-checks?limit=5&source=manual&trigger=lynx_command&status=completed&messageProvider=feishu",
    });
    expect(lynxChecksResponse.statusCode).toBe(200);
    expect(lynxChecksResponse.json().items).toEqual([
      expect.objectContaining({
        requestId: fixture.ids.lynxCheck,
        sendAttempted: true,
        sendSucceeded: true,
      }),
    ]);

    const lynxCheckDetailResponse = await app.inject({
      method: "GET",
      url: `/lynx/lynx-checks/${fixture.ids.lynxCheck}`,
    });
    expect(lynxCheckDetailResponse.statusCode).toBe(200);
    expect(lynxCheckDetailResponse.json()).toEqual(
      expect.objectContaining({
        requestId: fixture.ids.lynxCheck,
        preferredTargetKind: "current",
      }),
    );

    const sessionsResponse = await app.inject({
      method: "GET",
      url: "/lynx/sessions?limit=5&channelProfile=feishu&requesterOuId=ou_alpha&isGroup=false",
    });
    expect(sessionsResponse.statusCode).toBe(200);
    expect(sessionsResponse.json().items).toEqual([
      expect.objectContaining({
        sessionKey: fixture.ids.sessionAlpha,
        isGroup: false,
        eventCount: 2,
        toolCallCount: 1,
      }),
    ]);

    const sessionDetailResponse = await app.inject({
      method: "GET",
      url: `/lynx/sessions/${fixture.ids.sessionAlpha}`,
    });
    expect(sessionDetailResponse.statusCode).toBe(200);
    expect(sessionDetailResponse.json()).toEqual(
      expect.objectContaining({
        sessionKey: fixture.ids.sessionAlpha,
        recentEvents: expect.arrayContaining([
          expect.objectContaining({
            eventId: fixture.ids.eventApproval,
          }),
        ]),
        recentToolCalls: expect.arrayContaining([
          expect.objectContaining({
            toolCallId: fixture.ids.toolCallApproval,
          }),
        ]),
        recentApprovals: expect.arrayContaining([
          expect.objectContaining({
            approvalId: fixture.ids.approval,
          }),
        ]),
        tokenSummary: {
          totalTokens: 315,
          inputTokens: 200,
          outputTokens: 100,
        },
      }),
    );
  });

  it("serves dashboard and token endpoints from the same fixture data", async () => {
    const harness = await createTestApp("lynx-console-query-dashboard-");
    cleanupApps.push(harness);
    const { app } = harness;
    const fixture = createQueryFixture();

    const seedResponse = await ingestBatch(app, fixture.batch);
    expect(seedResponse.statusCode).toBe(200);

    const dashboardResponse = await app.inject({
      method: "GET",
      url: `/lynx/dashboard/overview?fromMs=${fixture.baseTimeMs - 10_000}&toMs=${fixture.baseTimeMs}`,
    });
    expect(dashboardResponse.statusCode).toBe(200);
    expect(dashboardResponse.json()).toEqual(
      expect.objectContaining({
        totals: {
          eventCount: 3,
          highRiskEventCount: 1,
          toolCallCount: 2,
          approvalCount: 1,
          lynxCheckCount: 1,
          totalTokens: 435,
        },
        recentHighRiskEvents: [
          expect.objectContaining({
            eventId: fixture.ids.eventApproval,
          }),
        ],
        recentToolCalls: expect.arrayContaining([
          expect.objectContaining({
            toolCallId: fixture.ids.toolCallApproval,
          }),
        ]),
        recentApprovals: expect.arrayContaining([
          expect.objectContaining({
            approvalId: fixture.ids.approval,
          }),
        ]),
      }),
    );

    const tokenUsageResponse = await app.inject({
      method: "GET",
      url: "/lynx/tokens/usage?limit=5&provider=openai&isEstimated=true",
    });
    expect(tokenUsageResponse.statusCode).toBe(200);
    expect(tokenUsageResponse.json().items).toEqual([
      expect.objectContaining({
        usageEventId: fixture.ids.tokenUsageSecondary,
        isEstimated: true,
      }),
    ]);

    const tokenSummaryResponse = await app.inject({
      method: "GET",
      url: "/lynx/tokens/summary?provider=openai",
    });
    expect(tokenSummaryResponse.statusCode).toBe(200);
    expect(tokenSummaryResponse.json()).toEqual({
      totalTokens: 435,
      inputTokens: 280,
      outputTokens: 140,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      estimatedCount: 1,
      topModels: [
        {
          model: "openclaw/main",
          totalTokens: 315,
        },
        {
          model: "openclaw/default",
          totalTokens: 120,
        },
      ],
    });

    const tokenTrendResponse = await app.inject({
      method: "GET",
      url: "/lynx/tokens/trend?bucket=hour&provider=openai",
    });
    expect(tokenTrendResponse.statusCode).toBe(200);
    expect(tokenTrendResponse.json()).toEqual({
      bucket: "hour",
      points: [
        {
          bucketStartMs: 1_776_927_600_000,
          inputTokens: 280,
          outputTokens: 140,
          totalTokens: 435,
        },
      ],
    });
  });
});
