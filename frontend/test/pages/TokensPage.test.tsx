import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TokensPage } from "../../src/pages/TokensPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
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
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
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
      }))
      .mockResolvedValueOnce(createJsonResponse({
        items: [{
          usageEventId: "token-usage:1",
          sessionKey: "#LX-90821-AF",
          provider: "bailian",
          model: "glm-5",
          inputTokens: 1_300,
          outputTokens: 22,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 1_322,
          assistantTextCount: 1,
          isEstimated: true,
          occurredAtMs: 1_776_942_111_288,
        }],
        nextCursor: "cursor-token-page-2",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        bucket: "hour",
        points: [{ bucketStartMs: 1_776_942_000_000, inputTokens: 1_300, outputTokens: 22, totalTokens: 1_322 }],
      }))
      .mockResolvedValueOnce(createJsonResponse({
        items: [{
          usageEventId: "token-usage:2",
          sessionKey: "#LX-90821-BF",
          provider: "bailian",
          model: "glm-5",
          inputTokens: 800,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 1_000,
          assistantTextCount: 1,
          isEstimated: false,
          occurredAtMs: 1_776_942_222_288,
        }],
      }));

    const { container } = render(<TokensPage />);

    expect(screen.getByText("Token 统计报表")).toBeInTheDocument();
    expect(screen.getByText("今日消耗总数")).toBeInTheDocument();
    expect(screen.getByText("可计量总量")).toBeInTheDocument();
    expect(screen.getByText("输入/输出比例")).toBeInTheDocument();
    expect(screen.getByText("7 日消耗趋势分析")).toBeInTheDocument();
    expect(screen.getByText("实时审计数据流")).toBeInTheDocument();
    expect(screen.getByLabelText("时间范围")).toHaveValue("last24h");
    expect(screen.getByRole("option", { name: "最近 7 天" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
    await screen.findByText("bailian / glm-5");
    expect(screen.getAllByText("1,322").length).toBeGreaterThan(0);
    expect(screen.getAllByText("估算").length).toBeGreaterThan(0);
    const trendLegend = container.querySelector(".trend-panel__legend");
    expect(trendLegend).toHaveTextContent("glm-5");
    expect(trendLegend).not.toHaveTextContent("GPT-4o");
    expect(trendLegend).not.toHaveTextContent("Claude 3.5");
    const trendChart = await screen.findByTestId("token-trend-chart");
    expect(within(trendChart).getByText("总计 1,322")).toBeInTheDocument();
    expect(within(trendChart).getByText("输入 1,300")).toBeInTheDocument();
    expect(within(trendChart).getByText("输出 22")).toBeInTheDocument();
    expect(within(trendChart).getByTestId("token-trend-total-0")).toHaveAttribute("data-total-tokens", "1322");
    expect(within(trendChart).getByTestId("token-trend-input-0")).toHaveAttribute("data-input-tokens", "1300");
    expect(within(trendChart).getByTestId("token-trend-output-0")).toHaveAttribute("data-output-tokens", "22");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/tokens/summary?fromMs=1777334400000&toMs=1777420800000");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/tokens/usage?limit=20&fromMs=1777334400000&toMs=1777420800000");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/lynx/tokens/trend?bucket=hour&fromMs=1777334400000&toMs=1777420800000");

    fireEvent.click(screen.getByTitle(/Next Page|下一页/));

    await screen.findByText("#LX-90821-BF");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/lynx/tokens/usage?limit=20&cursor=cursor-token-page-2&fromMs=1777334400000&toMs=1777420800000");
  });

  it("keeps the trend panel in an empty state when trend points are unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
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
      }))
      .mockResolvedValueOnce(createJsonResponse({ items: [] }))
      .mockResolvedValueOnce(createJsonResponse({
        bucket: "hour",
        points: [],
      }));

    render(<TokensPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByText("暂无 Token 趋势点")).toBeInTheDocument();
    expect(screen.queryByTestId("token-trend-chart")).not.toBeInTheDocument();
  });
});
