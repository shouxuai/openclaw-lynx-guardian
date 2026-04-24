import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPage } from "./DashboardPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function createRecentEvent(index: number) {
  return {
    eventId: `EV-20241028-00${index}`,
    title: `权限提升尝试 ${index}`,
    summary: `立即封禁来源 IP 并重置相关账户凭证 ${index}`,
    riskLevel: index % 2 === 0 ? "L3" : "L4",
    enforcementAction: "requireApproval",
    occurredAtMs: 1_776_945_600_000 - index * 1_000,
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

  it("renders the approved security overview structure from backend data", async () => {
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
        { riskLevel: "L0", count: 2 },
        { riskLevel: "L1", count: 6 },
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
      recentHighRiskEvents: Array.from({ length: 5 }, (_, index) => createRecentEvent(index + 1)),
      recentToolCalls: [],
      recentApprovals: [],
    }));

    const { container } = render(
      <MemoryRouter basename="/webview" initialEntries={["/webview/"]}>
        <DashboardPage />
      </MemoryRouter>,
    );

    await screen.findByText("权限提升尝试 1");
    expect(screen.getByText("L0 指标")).toBeInTheDocument();
    expect(screen.getByText("L1 指标")).toBeInTheDocument();
    expect(screen.getByText("风险分布")).toBeInTheDocument();
    expect(screen.getByText("基础 (L0)")).toBeInTheDocument();
    expect(screen.getByText("关注 (L1)")).toBeInTheDocument();
    expect(screen.getByText("威胁等级分布")).toBeInTheDocument();
    expect(screen.getByLabelText("L4 严重系统漏洞 占比 12.5%")).toBeInTheDocument();
    expect(screen.getByLabelText("7 日趋势折线图")).toBeInTheDocument();
    expect(screen.getByText("7 日趋势")).toBeInTheDocument();
    const trendLabels = Array.from(container.querySelectorAll(".trend-line-chart__labels text")).map(
      (label) => label.textContent,
    );
    expect(trendLabels).toHaveLength(7);
    expect(new Set(trendLabels).size).toBe(7);
    expect(screen.getByText("最近安全事件")).toBeInTheDocument();
    expect(screen.getByText("立即封禁来源 IP 并重置相关账户凭证 1")).toBeInTheDocument();
    expect(container.querySelectorAll(".data-table tbody tr")).toHaveLength(5);
    expect(screen.getByRole("link", { name: "查看全部" })).toHaveAttribute("href", "/webview/events");

    const barLabels = Array.from(container.querySelectorAll(".risk-level-bar__meta"));
    expect(barLabels).toHaveLength(5);
    expect(barLabels.every((label) => label.childElementCount === 2)).toBe(true);
    expect(container.querySelector(".risk-level-bar__value")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/dashboard/overview");
    });
  });
});
