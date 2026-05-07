import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPage } from "../../src/pages/DashboardPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function createRecentQaRecord(index: number) {
  return {
    qaRecordId: `qa-dashboard-${index}`,
    sessionKey: "session-dashboard",
    runId: `run-dashboard-${index}`,
    userPromptExcerpt: `检查当前工程状态 ${index}`,
    finalAnswerExcerpt: `已完成检查 ${index}`,
    status: index % 2 === 0 ? "failed" : "completed",
    riskLevel: index % 2 === 0 ? "L3" : "L2",
    riskScore: index + 2,
    toolCallCount: index,
    approvalCount: index % 2,
    detectionCount: 0,
    totalTokens: 200 + index,
    startedAtMs: 1_776_945_600_000 - index * 1_000,
  };
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

  it("renders risk distribution from user-visible security event counts", async () => {
    fetchMock.mockResolvedValue(createJsonResponse({
      totals: {
        eventCount: 24,
        toolCallCount: 8,
        approvalCount: 3,
        lynxCheckCount: 2,
        totalTokens: 4_200,
      },
      riskDistribution: [
        { riskLevel: "L0", count: 12 },
        { riskLevel: "L1", count: 3 },
        { riskLevel: "L2", count: 3 },
        { riskLevel: "L3", count: 4 },
        { riskLevel: "L4", count: 2 },
      ],
      enforcementDistribution: [
        { enforcementAction: "allow", count: 12 },
        { enforcementAction: "block", count: 2 },
      ],
      eventTrend: [
        { bucketStartMs: 1_776_942_000_000, value: 5 },
        { bucketStartMs: 1_776_945_600_000, value: 8 },
      ],
      tokenTrend: [],
      recentSecurityEvents: [],
      recentQaRecords: Array.from({ length: 5 }, (_, index) => createRecentQaRecord(index + 1)),
      recentToolCalls: [],
      recentApprovals: [],
    }));

    render(
      <MemoryRouter basename="/webview" initialEntries={["/webview/"]}>
        <DashboardPage />
      </MemoryRouter>,
    );

    await screen.findByText("检查当前工程状态 1");
    expect(screen.getByText("L0 指标")).toBeInTheDocument();
    expect(screen.getByText("L1 指标")).toBeInTheDocument();
    expect(screen.getByText("L2 指标")).toBeInTheDocument();
    expect(screen.getByText("L3 指标")).toBeInTheDocument();
    expect(screen.getByText("L4 指标")).toBeInTheDocument();
    expect(screen.getByText("总计")).toBeInTheDocument();
    expect(screen.queryByText("高危事件")).not.toBeInTheDocument();
    expect(screen.queryByText("L3 / L4 安全事件")).not.toBeInTheDocument();
    expect(screen.queryByText(/新版/)).not.toBeInTheDocument();
    expect(screen.queryByText("原始审计流水")).not.toBeInTheDocument();
    expect(screen.getByText("风险分布")).toBeInTheDocument();
    expect(screen.getByText("总事件")).toBeInTheDocument();
    expect(screen.getAllByText("24").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("L4 严重风险 占比 8.3%")).toBeInTheDocument();
    expect(screen.getByText("最近问答记录")).toBeInTheDocument();
    expect(screen.queryByText("最近安全事件")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看全部" })).toHaveAttribute("href", "/webview/qa-records");

    await waitFor(() => {
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/dashboard/overview");
    });
  });
});
