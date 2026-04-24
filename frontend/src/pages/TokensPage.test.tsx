import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TokensPage } from "./TokensPage";

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

  it("renders live token data from the backend APIs", async () => {
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
          sessionKey: "agent:main:main",
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
      }))
      .mockResolvedValueOnce(createJsonResponse({
        bucket: "hour",
        points: [{ bucketStartMs: 1_776_942_000_000, inputTokens: 1_300, outputTokens: 22, totalTokens: 1_322 }],
      }));

    render(<TokensPage />);

    await screen.findByText("包含估算回填记录");
    expect(screen.getAllByText("1,322").length).toBeGreaterThan(0);
    expect(screen.getByText("bailian / glm-5")).toBeInTheDocument();
    expect(screen.getAllByText("估算").length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/tokens/summary");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/tokens/usage?limit=20");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/lynx/tokens/trend?bucket=hour");
  });
});
