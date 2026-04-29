import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TokensPage } from "./TokensPage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TokensPage", () => {
  it("keeps estimated and unavailable usage out of the actual total", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tokens/summary")) {
        return new Response(JSON.stringify({
          totalTokens: 100,
          inputTokens: 60,
          outputTokens: 40,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          actualTokens: 100,
          estimatedTokens: 0,
          estimatedCount: 1,
          unavailableCount: 1,
          topModels: [{ model: "actual-model", totalTokens: 100 }],
        }), { status: 200 });
      }
      if (url.includes("/tokens/trend")) {
        return new Response(JSON.stringify({
          bucket: "hour",
          points: [{ bucketStartMs: 1777390000000, inputTokens: 60, outputTokens: 40, totalTokens: 100 }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        items: [
          {
            usageEventId: "actual-1",
            provider: "openclaw",
            model: "actual-model",
            sourceType: "actual",
            inputTokens: 60,
            outputTokens: 40,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 100,
            assistantTextCount: 1,
            isEstimated: false,
            occurredAtMs: 1777390000000,
          },
          {
            usageEventId: "estimated-1",
            provider: "openclaw",
            model: "estimated-model",
            sourceType: "estimated",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 900,
            assistantTextCount: 1,
            isEstimated: true,
            occurredAtMs: 1777390001000,
          },
          {
            usageEventId: "unavailable-1",
            provider: "openclaw",
            model: "unknown-model",
            sourceType: "unavailable",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 0,
            assistantTextCount: 1,
            isEstimated: false,
            occurredAtMs: 1777390002000,
          },
        ],
      }), { status: 200 });
    }));

    render(<TokensPage />);

    expect(await screen.findByText("可计量总量")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("估算记录 1")).toBeInTheDocument();
    expect(screen.getByText("不可用记录 1")).toBeInTheDocument();
    expect(screen.getByText("estimated")).toBeInTheDocument();
    expect(screen.getByText("unavailable")).toBeInTheDocument();
  });
});
