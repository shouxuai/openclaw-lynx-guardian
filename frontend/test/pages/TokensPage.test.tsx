import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  });

  afterEach(() => {
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

    render(<TokensPage />);

    expect(screen.getByText("Token 统计报表")).toBeInTheDocument();
    expect(screen.getByText("今日消耗总数")).toBeInTheDocument();
    expect(screen.getByText("输入/输出比例")).toBeInTheDocument();
    expect(screen.getByText("7 日消耗趋势分析")).toBeInTheDocument();
    expect(screen.getByText("实时审计数据流")).toBeInTheDocument();
    await screen.findByText("bailian / glm-5");
    expect(screen.getAllByText("1,322").length).toBeGreaterThan(0);
    expect(screen.getAllByText("估算").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/tokens/summary");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/tokens/usage?limit=20");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/lynx/tokens/trend?bucket=hour");

    fireEvent.click(screen.getByTitle(/Next Page|下一页/));

    await screen.findByText("#LX-90821-BF");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/lynx/tokens/usage?limit=20&cursor=cursor-token-page-2");
  });
});
