import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TokensPage } from "../../src/pages/TokensPage";

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
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

function createTokenSummary() {
  return {
    totalTokens: 2_170_856,
    inputTokens: 2_149_606,
    outputTokens: 21_250,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    actualTokens: 2_170_856,
    estimatedTokens: 0,
    measurableTokens: 2_170_856,
    measurableInputTokens: 2_149_606,
    measurableOutputTokens: 21_250,
    measurableCacheReadTokens: 0,
    measurableCacheWriteTokens: 0,
    estimatedCount: 1,
    unavailableCount: 0,
    originTotals: [{ sourceOrigin: "hook", totalTokens: 2_170_856, count: 40 }],
    topModels: [
      { model: "openclaw/main", totalTokens: 2_149_606 },
      { model: "gpt-5.4", totalTokens: 21_250 },
    ],
  };
}

function createTokenTrend() {
  return {
    bucket: "hour",
    points: [
      {
        bucketStartMs: 1_777_350_000_000,
        inputTokens: 12_000,
        outputTokens: 1_200,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 13_200,
      },
      {
        bucketStartMs: 1_777_360_800_000,
        inputTokens: 96_000,
        outputTokens: 3_800,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 99_800,
      },
      {
        bucketStartMs: 1_777_371_600_000,
        inputTokens: 32_000,
        outputTokens: 900,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 32_900,
      },
      {
        bucketStartMs: 1_777_382_400_000,
        inputTokens: 420_000,
        outputTokens: 8_400,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 428_400,
      },
      {
        bucketStartMs: 1_777_418_400_000,
        inputTokens: 2_149_606,
        outputTokens: 21_250,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 2_170_856,
      },
    ],
  };
}

function createTokenHeatmap() {
  return {
    timeZone: "local",
    totalTokens: 2_170_856,
    hourTotals: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      totalTokens: hour === 21 ? 64_306 : hour === 10 ? 2_106_550 : 0,
    })),
    weekdayTotals: [
      { weekday: 0, label: "周日", totalTokens: 0 },
      { weekday: 1, label: "周一", totalTokens: 2_106_550 },
      { weekday: 2, label: "周二", totalTokens: 0 },
      { weekday: 3, label: "周三", totalTokens: 0 },
      { weekday: 4, label: "周四", totalTokens: 64_306 },
      { weekday: 5, label: "周五", totalTokens: 0 },
      { weekday: 6, label: "周六", totalTokens: 0 },
    ],
  };
}

function createUsagePage(pageNum = 1) {
  if (pageNum === 2) {
    return createPage([
      {
        usageEventId: "usage-older",
        sessionKey: "sess-token-transcript",
        runId: "run-token-transcript",
        agentId: "main",
        provider: "openclaw",
        model: "openclaw/main",
        sourceType: "actual",
        sourceOrigin: "transcript",
        inputTokens: 2_149_606,
        outputTokens: 21_250,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 2_170_856,
        assistantTextCount: 1,
        isEstimated: false,
        occurredAtMs: 1_777_349_500_000,
      },
    ], 2, 20, 2);
  }

  return createPage([
    {
      usageEventId: "usage-latest",
      sessionKey: "sess-token-hook",
      runId: "run-token-hook",
      agentId: "main",
      provider: "openclaw",
      model: "openclaw/main",
      sourceType: "actual",
      sourceOrigin: "hook",
      inputTokens: 64_306,
      outputTokens: 72,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 64_378,
      assistantTextCount: 1,
      isEstimated: false,
      occurredAtMs: 1_777_418_400_000,
    },
    {
      usageEventId: "usage-older",
      sessionKey: "sess-token-transcript",
      runId: "run-token-transcript",
      agentId: "main",
      provider: "openclaw",
      model: "openclaw/main",
      sourceType: "actual",
      sourceOrigin: "transcript",
      inputTokens: 2_149_606,
      outputTokens: 21_250,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2_170_856,
      assistantTextCount: 1,
      isEstimated: false,
      occurredAtMs: 1_777_349_500_000,
    },
  ], 1, 20, 2);
}

function queryParam(url: string, key: string): string | null {
  return new URL(url, "http://localhost").searchParams.get(key);
}

function getRangeCallUrls(calls: Array<[RequestInfo | URL, RequestInit | undefined]>) {
  return calls.map((call) => String(call[0]));
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

  it("renders native-like token analytics with compact values and heatmap", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/lynx/tokens/summary")) {
        return createJsonResponse(createTokenSummary());
      }
      if (url.startsWith("/lynx/tokens/trend")) {
        return createJsonResponse(createTokenTrend());
      }
      if (url.startsWith("/lynx/tokens/heatmap")) {
        return createJsonResponse(createTokenHeatmap());
      }
      if (url.startsWith("/lynx/tokens/usage")) {
        return createJsonResponse(createUsagePage(Number(queryParam(url, "pageNum") ?? "1")));
      }
      return createJsonResponse(createPage([]));
    });

    const { container } = render(<TokensPage />);

    expect(screen.getByText("Token 分析")).toBeInTheDocument();
    expect(container.querySelector(".page-header")).not.toBeNull();
    expect(container.querySelector(".token-hero")).toBeNull();
    expect(container.querySelector(".token-metric-strip.metric-grid.metric-grid--compact")).not.toBeNull();
    expect(container.querySelector(".token-metric-grid")).toBeNull();
    expect(container.querySelectorAll(".metric-grid.metric-grid--compact > .metric-card")).toHaveLength(4);
    expect(container.querySelector(".metric-grid.metric-grid--compact .summary-card")).toBeNull();
    expect(screen.getByRole("button", { name: "总量" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "按类型" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Token 类型拆分")).toBeInTheDocument();
    expect(screen.getByText("使用热力分布")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "最近 24 小时消耗趋势" })).toBeInTheDocument();
    for (const label of ["最近 1 小时", "最近 24 小时", "最近 7 天", "最近 30 天", "全部时间"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    const urls = getRangeCallUrls(fetchMock.mock.calls);
    expect(urls).toContain("/lynx/tokens/summary?fromMs=1777334400000&toMs=1777420800000");
    expect(urls).toContain("/lynx/tokens/trend?bucket=hour&fromMs=1777334400000&toMs=1777420800000");
    expect(urls).toContain("/lynx/tokens/usage?fromMs=1777334400000&toMs=1777420800000&pageNum=1&pageSize=20");
    expect(urls).toContain("/lynx/tokens/heatmap?fromMs=1777334400000&toMs=1777420800000");

    const summaryTotalLabel = screen.getAllByText("总量", { selector: ".metric-card__label" })[0];
    const summaryTotalCard = summaryTotalLabel.closest(".metric-card");
    expect(summaryTotalCard).not.toBeNull();
    await waitFor(() => {
      expect(within(summaryTotalCard as HTMLElement).getByText("2.2M")).toBeInTheDocument();
      expect(within(summaryTotalCard as HTMLElement).getByTitle("2,170,856 tokens")).toBeInTheDocument();
    });
    expect(screen.getByText("64.3K -> 72")).toBeInTheDocument();
    expect(screen.getByTitle("21:00 · 64.3K tokens")).toBeInTheDocument();
    expect(screen.getByTitle("周一 · 2.1M tokens")).toBeInTheDocument();
    expect(screen.getByTestId("token-weekday-cell-1")).toHaveClass("token-weekday-cell--level-4");
    expect(screen.getByTestId("token-hour-cell-10")).toHaveClass("token-hour-cell--level-4");

    const breakdownPanel = screen.getByRole("heading", { name: "Token 类型拆分" }).closest(".token-breakdown-panel");
    expect(breakdownPanel).not.toBeNull();
    expect(within(breakdownPanel as HTMLElement).getByText("上下文输入")).toBeInTheDocument();
    expect(within(breakdownPanel as HTMLElement).getByText("模型输出")).toBeInTheDocument();
    expect(within(breakdownPanel as HTMLElement).getByText("缓存读取")).toBeInTheDocument();
    expect(within(breakdownPanel as HTMLElement).getByText("缓存写入")).toBeInTheDocument();

    const trendChart = await screen.findByTestId("token-trend-chart");
    expect(trendChart).toBeInTheDocument();
    expect(within(trendChart).getAllByText("2,170,856").length).toBeGreaterThan(0);
    expect(within(trendChart).getAllByText("12,000").length).toBeGreaterThan(0);
    const lineChart = within(trendChart).getByTestId("token-trend-line-chart");
    expect(lineChart.tagName.toLowerCase()).toBe("svg");
    expect(lineChart).toHaveAttribute("viewBox", "0 0 720 132");
    expect(within(lineChart).getByTestId("token-trend-area")).toBeInTheDocument();
    const trendLine = within(lineChart).getByTestId("token-trend-line");
    const pointCoordinates = trendLine.getAttribute("points") ?? "";
    const yCoordinates = pointCoordinates
      .trim()
      .split(/\s+/)
      .map((coordinate) => coordinate.split(",")[1])
      .filter(Boolean);
    expect(yCoordinates.length).toBeGreaterThanOrEqual(5);
    expect(new Set(yCoordinates).size).toBeGreaterThan(2);
    expect(within(lineChart).getAllByTestId(/^token-trend-point-/)).toHaveLength(5);
    expect(within(trendChart).queryByTestId("token-trend-bar-0")).not.toBeInTheDocument();

    expect(await screen.findByText("实时 hook")).toBeInTheDocument();
    expect(screen.getByText("Transcript 回填")).toBeInTheDocument();
    expect(screen.getByText(/共 2 条记录/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "按类型" }));
    expect(screen.getByRole("button", { name: "总量" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "按类型" })).toHaveAttribute("aria-pressed", "true");
    expect(within(lineChart).getByTestId("token-trend-line-output")).toBeInTheDocument();
    expect(within(lineChart).getByTestId("token-trend-line-input")).toBeInTheDocument();
    expect(within(lineChart).getByTestId("token-trend-line-cache-read")).toBeInTheDocument();
    expect(within(lineChart).getByTestId("token-trend-line-cache-write")).toBeInTheDocument();

    expect(container.querySelector(".token-breakdown-bar")).not.toBeNull();
    expect(screen.getByTestId("token-breakdown-segment-cache-read")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("token-breakdown-segment-cache-write")).toHaveStyle({ display: "none" });
    expect(container.querySelector(".token-mosaic-panel")).not.toBeNull();
    expect(container.querySelector(".token-heatmap-grid")).not.toBeNull();
    expect(container.querySelectorAll(".token-heatmap-cell__swatch")).toHaveLength(31);
    expect(screen.getByTestId("token-weekday-cell-1").querySelector(".token-heatmap-cell__swatch")).not.toBeNull();
    expect(screen.getByTestId("token-hour-cell-10").querySelector(".token-heatmap-cell__swatch")).not.toBeNull();
    expect(screen.getAllByText("实际", { selector: ".token-badge--actual" }).length).toBeGreaterThan(0);
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
        return createJsonResponse({ bucket: "hour", points: [] });
      }
      if (url.startsWith("/lynx/tokens/heatmap")) {
        return createJsonResponse({
          timeZone: "local",
          totalTokens: 0,
          hourTotals: Array.from({ length: 24 }, (_, hour) => ({ hour, totalTokens: 0 })),
          weekdayTotals: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            label: `周${weekday}`,
            totalTokens: 0,
          })),
        });
      }
      return createJsonResponse(createPage([]));
    });

    render(<TokensPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    expect(screen.getByText("暂无 Token 趋势")).toBeInTheDocument();
    expect(screen.queryByTestId("token-trend-chart")).not.toBeInTheDocument();
    expect(screen.queryByText("64.3K -> 72")).not.toBeInTheDocument();
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
          measurableCacheReadTokens: 0,
          measurableCacheWriteTokens: 0,
          estimatedCount: 1,
          unavailableCount: 0,
          originTotals: [{ sourceOrigin: "hook", totalTokens: 1_322, count: 1 }],
          topModels: [{ model: "glm-5", totalTokens: 1_322 }],
        });
      }
      if (url.startsWith("/lynx/tokens/trend")) {
        return createJsonResponse({ bucket: "hour", points: [] });
      }
      if (url.startsWith("/lynx/tokens/heatmap")) {
        return createJsonResponse({
          timeZone: "local",
          totalTokens: 1_322,
          hourTotals: Array.from({ length: 24 }, (_, hour) => ({
            hour,
            totalTokens: hour === 9 ? 1_322 : 0,
          })),
          weekdayTotals: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            label: `周${weekday}`,
            totalTokens: weekday === 1 ? 1_322 : 0,
          })),
        });
      }
      return createJsonResponse(createPage([
        {
          usageEventId: "token-usage:estimated-only",
          sessionKey: "#LX-ESTIMATED",
          provider: "bailian",
          model: "glm-5",
          sourceType: "estimated",
          sourceOrigin: "transcript",
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

    render(<TokensPage />);

    expect((await screen.findAllByTitle("1,322 tokens")).length).toBeGreaterThan(0);
    expect(screen.getByText("Transcript 回填")).toBeInTheDocument();
    expect(screen.getByText("1.3K -> 22")).toBeInTheDocument();
  });
});
