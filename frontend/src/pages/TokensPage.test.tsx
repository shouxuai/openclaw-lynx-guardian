import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TokensPage } from "./TokensPage";

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TokensPage", () => {
  it("renders the native-style token dashboard", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tokens/summary")) {
        return createJsonResponse({
          totalTokens: 2_170_856,
          inputTokens: 2_149_606,
          outputTokens: 21_250,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          actualTokens: 2_170_856,
          estimatedTokens: 0,
          estimatedCount: 0,
          unavailableCount: 0,
          topModels: [{ model: "openclaw/main", totalTokens: 2_170_856 }],
        });
      }
      if (url.includes("/tokens/trend")) {
        return createJsonResponse({
          bucket: "hour",
          points: [{
            bucketStartMs: 1_777_350_000_000,
            inputTokens: 64_306,
            outputTokens: 72,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 64_378,
          }],
        });
      }
      if (url.includes("/tokens/heatmap")) {
        return createJsonResponse({
          timeZone: "local",
          totalTokens: 2_170_856,
          hourTotals: Array.from({ length: 24 }, (_, hour) => ({
            hour,
            totalTokens: hour === 21 ? 64_306 : 0,
          })),
          weekdayTotals: Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            label: `周${weekday}`,
            totalTokens: weekday === 1 ? 2_106_550 : 0,
          })),
        });
      }
      return createJsonResponse({
        items: [{
          usageEventId: "usage-1",
          sessionKey: "sess-token-hook",
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
        }],
        total: 1,
        pageNum: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<TokensPage />);

    expect(await screen.findByText("Token 分析")).toBeInTheDocument();
    expect(container.querySelector(".page-header")).not.toBeNull();
    expect(container.querySelector(".token-hero")).toBeNull();
    expect(container.querySelector(".token-metric-strip.metric-grid.metric-grid--compact")).not.toBeNull();
    expect(container.querySelector(".token-metric-grid")).toBeNull();
    expect(screen.getAllByText("总量", { selector: ".metric-card__label" })[0]).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "最近 24 小时" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Last 24 hours" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
    expect(await screen.findByTestId("token-trend-line-chart")).toBeInTheDocument();
    expect(container.querySelector(".token-heatmap-grid")).not.toBeNull();
    expect(container.querySelectorAll(".token-heatmap-cell__swatch")).toHaveLength(31);
    expect(await screen.findByText("实时 hook")).toBeInTheDocument();
  });
});
