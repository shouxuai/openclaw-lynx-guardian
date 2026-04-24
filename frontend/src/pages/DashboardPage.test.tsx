import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPage } from "./DashboardPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("DashboardPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the big-screen overview from backend data", async () => {
    fetchMock.mockResolvedValue(createJsonResponse({
      totals: {
        eventCount: 24,
        highRiskEventCount: 6,
        toolCallCount: 8,
        approvalCount: 3,
        lynxCheckCount: 2,
        totalTokens: 4_200,
      },
      riskDistribution: [
        { riskLevel: "L1", count: 8 },
        { riskLevel: "L2", count: 7 },
        { riskLevel: "L3", count: 6 },
        { riskLevel: "L4", count: 3 },
      ],
      enforcementDistribution: [
        { enforcementAction: "allow", count: 8 },
        { enforcementAction: "warn", count: 5 },
        { enforcementAction: "requireApproval", count: 3 },
      ],
      eventTrend: [
        { bucketStartMs: 1_776_942_000_000, value: 5 },
        { bucketStartMs: 1_776_945_600_000, value: 8 },
      ],
      tokenTrend: [
        { bucketStartMs: 1_776_942_000_000, value: 1_200 },
        { bucketStartMs: 1_776_945_600_000, value: 3_000 },
      ],
      recentHighRiskEvents: [
        {
          eventId: "evt-1",
          title: "高风险文件移动",
          summary: "命中了需要人工复核的路径变更规则。",
          riskLevel: "L4",
          enforcementAction: "requireApproval",
          occurredAtMs: 1_776_945_600_000,
        },
      ],
      recentToolCalls: [
        {
          toolCallId: "tool-1",
          toolName: "move_files",
          resultExcerpt: "等待所有者审批。",
          resultStatus: "paused",
        },
      ],
      recentApprovals: [
        {
          approvalId: "approval-1",
          promptExcerpt: "审批批量文件移动请求。",
          requesterOuId: "ou_123",
          module: "M3",
          resolution: "pending",
        },
      ],
    }));

    render(<DashboardPage />);

    await screen.findByText("高风险文件移动");
    expect(screen.getByText("趋势与动作")).toBeInTheDocument();
    expect(screen.getByText("基础态势")).toBeInTheDocument();
    expect(screen.getByText("最近高风险事件")).toBeInTheDocument();
    expect(screen.getByText("审批批量文件移动请求。")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/dashboard/overview");
    });
  });
});
