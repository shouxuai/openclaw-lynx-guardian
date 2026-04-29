import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TokensPage } from "../../src/pages/TokensPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function createPage(items: unknown[], pageNum = 1, pageSize = 20, total = items.length) {
  return {
    items,
    total,
    pageNum,
    pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

describe("TokensPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(1_777_420_800_000);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders token statistics in the approved reference structure", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/lynx/tokens/summary")) {
        return createJsonResponse({
        totalTokens: 1_322,
        inputTokens: 1_300,
        outputTokens: 22,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCount: 1,
        unavailableCount: 0,
        actualTokens: 0,
        estimatedTokens: 1_322,
        topModels: [{ model: "glm-5", totalTokens: 1_322 }],
        });
      }
      if (url.startsWith("/lynx/tokens/trend")) {
        return createJsonResponse({
        bucket: "hour",
        points: [{ bucketStartMs: 1_776_942_000_000, inputTokens: 1_300, outputTokens: 22, totalTokens: 1_322 }],
        });
      }
      if (url.includes("pageNum=2")) {
        return createJsonResponse(createPage([
        {
          usageEventId: "token-usage:2",
          sessionKey: "#LX-90821-BF",
          provider: "bailian",
          model: "glm-5",
          sourceType: "actual",
          inputTokens: 800,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 1_000,
          assistantTextCount: 1,
          isEstimated: false,
          occurredAtMs: 1_776_942_222_288,
        },
        ], 2, 20, 21));
      }
      return createJsonResponse(createPage([
        {
          usageEventId: "token-usage:1",
          sessionKey: "#LX-90821-AF",
          provider: "bailian",
          model: "glm-5",
          sourceType: "estimated",
          inputTokens: 1_300,
          outputTokens: 22,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 1_322,
          assistantTextCount: 1,
          isEstimated: true,
          occurredAtMs: 1_776_942_111_288,
        },
      ], 1, 20, 21));
    });

    const { container } = render(<TokensPage />);

    expect(screen.getByText("Token 统计报表")).toBeInTheDocument();
    expect(screen.getByText("当前范围消耗总数")).toBeInTheDocument();
    expect(await screen.findByText("可计量总量")).toBeInTheDocument();
    expect(screen.getByText("输入/输出比例")).toBeInTheDocument();
    expect(screen.getByText("最近 24 小时消耗趋势")).toBeInTheDocument();
    expect(screen.getByText("实时审计数据流")).toBeInTheDocument();
    expect(screen.getByLabelText("时间范围")).toHaveValue("last24h");
    for (const label of ["最近 1 小时", "最近 24 小时", "最近 7 天", "最近 30 天", "全部时间"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
    await screen.findByText("bailian / glm-5");
    expect(screen.getAllByText("1,322").length).toBeGreaterThan(0);
    expect(screen.getAllByText("估算").length).toBeGreaterThan(0);
    const trendLegend = container.querySelector(".trend-panel__legend");
    expect(trendLegend).toHaveTextContent("glm-5");
    expect(trendLegend).not.toHaveTextContent("GPT-4o");
    expect(trendLegend).not.toHaveTextContent("Claude 3.5");
    const trendChart = await screen.findByTestId("token-trend-chart");
    expect(trendChart.querySelectorAll("[data-testid^='token-trend-slot-']")).toHaveLength(7);
    expect(trendChart.querySelectorAll("[data-token-trend-slot='filled']")).toHaveLength(1);
    expect(within(trendChart).getByTestId("token-trend-y-axis")).toHaveTextContent("1,322");
    expect(within(trendChart).getByTestId("token-trend-y-axis")).toHaveTextContent("661");
    expect(within(trendChart).getByTestId("token-trend-y-axis")).toHaveTextContent("0");
    expect(trendChart.querySelectorAll(".token-trend-gridline")).toHaveLength(3);
    expect(within(trendChart).getByText("总计 1,322")).toBeInTheDocument();
    expect(within(trendChart).getByText("输入 1,300")).toBeInTheDocument();
    expect(within(trendChart).getByText("输出 22")).toBeInTheDocument();
    const totalBar = trendChart.querySelector("[data-total-tokens='1322']");
    expect(totalBar).not.toBeNull();
    expect(totalBar).toHaveClass("token-trend-bar");
    expect(trendChart.querySelector("[data-input-tokens='1300']")).not.toBeNull();
    expect(trendChart.querySelector("[data-output-tokens='22']")).not.toBeNull();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    const initialUrls = fetchMock.mock.calls.map((call) => call[0]);
    expect(initialUrls).toContain("/lynx/tokens/summary?fromMs=1777334400000&toMs=1777420800000");
    expect(initialUrls).toContain("/lynx/tokens/usage?fromMs=1777334400000&toMs=1777420800000&pageNum=1&pageSize=20");
    expect(initialUrls).toContain("/lynx/tokens/trend?bucket=hour&fromMs=1777334400000&toMs=1777420800000");

    fireEvent.click(screen.getByTitle(/Next Page|下一页/));

    await screen.findByText("#LX-90821-BF");
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain(
      "/lynx/tokens/usage?fromMs=1777334400000&toMs=1777420800000&pageNum=2&pageSize=20",
    );

    fireEvent.change(screen.getByLabelText("时间范围"), { target: { value: "last7d" } });

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => call[0]);
      expect(urls).toContain("/lynx/tokens/summary?fromMs=1776816000000&toMs=1777420800000");
      expect(urls).toContain("/lynx/tokens/usage?fromMs=1776816000000&toMs=1777420800000&pageNum=1&pageSize=20");
      expect(urls).toContain("/lynx/tokens/trend?bucket=day&fromMs=1776816000000&toMs=1777420800000");
      expect(urls).not.toContain("/lynx/tokens/usage?fromMs=1776816000000&toMs=1777420800000&pageNum=2&pageSize=20");
    });
  });

  it("keeps the trend panel in an empty state when trend points are unavailable", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/lynx/tokens/summary")) {
        return createJsonResponse({
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCount: 0,
        actualTokens: 0,
        estimatedTokens: 0,
        unavailableCount: 0,
        topModels: [],
        });
      }
      if (url.startsWith("/lynx/tokens/trend")) {
        return createJsonResponse({
        bucket: "hour",
        points: [],
        });
      }
      return createJsonResponse(createPage([]));
    });

    render(<TokensPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByText("暂无 Token 趋势点")).toBeInTheDocument();
    expect(screen.queryByTestId("token-trend-chart")).not.toBeInTheDocument();
    expect(screen.queryByText("10/21")).not.toBeInTheDocument();
    expect(screen.queryByText("10/22")).not.toBeInTheDocument();
  });

  it("shows estimated-only token usage as measurable data instead of an empty dashboard", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/lynx/tokens/summary")) {
        return createJsonResponse({
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        actualTokens: 0,
        estimatedTokens: 1_322,
        measurableTokens: 1_322,
        measurableInputTokens: 1_300,
        measurableOutputTokens: 22,
        estimatedCount: 1,
        unavailableCount: 0,
        topModels: [{ model: "glm-5", totalTokens: 1_322 }],
        });
      }
      if (url.startsWith("/lynx/tokens/trend")) {
        return createJsonResponse({
        bucket: "hour",
        points: [],
        });
      }
      return createJsonResponse(createPage([
        {
          usageEventId: "token-usage:estimated-only",
          sessionKey: "#LX-ESTIMATED",
          provider: "bailian",
          model: "glm-5",
          sourceType: "estimated",
          inputTokens: 1_300,
          outputTokens: 22,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 1_322,
          assistantTextCount: 1,
          isEstimated: true,
          occurredAtMs: 1_776_942_111_288,
        },
      ]));
    });

    const { container } = render(<TokensPage />);

    const totalCard = await screen.findByText("当前范围消耗总数");
    await screen.findByText("可计量总量");
    const totalSummaryCard = totalCard.closest(".summary-card");
    expect(totalSummaryCard).not.toBeNull();
    await waitFor(() => {
      expect(totalSummaryCard).toHaveTextContent("1,322");
      expect(totalSummaryCard).toHaveTextContent("实际未返回：模型未提供 usage");
      expect(totalSummaryCard).toHaveTextContent("估算 1,322");
      expect(totalSummaryCard).not.toHaveTextContent("实际 0");
    });

    const ratioCard = container.querySelector(".ratio-card");
    expect(ratioCard).not.toBeNull();
    expect(within(ratioCard as HTMLElement).getByText("98%")).toBeInTheDocument();
    expect(within(ratioCard as HTMLElement).getByText("2%")).toBeInTheDocument();
    expect(within(ratioCard as HTMLElement).getByText("59.09:1")).toBeInTheDocument();

    const trendLegend = container.querySelector(".trend-panel__legend");
    expect(trendLegend).toHaveTextContent("glm-5");
  });
});
