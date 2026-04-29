import { describe, expect, it } from "vitest";

import type { IngestItemV1, TokenUsageItem } from "../shared/src/ingest.js";
import { createLocalConsoleTokenHook } from "../src/console/token-usage.js";
import type { EventContext, LlmOutputEvent } from "../src/types.js";

function event(overrides: Partial<LlmOutputEvent> = {}): LlmOutputEvent {
  return {
    runId: "run-1",
    sessionId: "session-1",
    provider: "openai",
    model: "gpt-test",
    assistantTexts: ["hello"],
    ...overrides,
  };
}

function collectTokenItems(estimator?: Parameters<typeof createLocalConsoleTokenHook>[0]["estimator"]) {
  const items: IngestItemV1[] = [];
  const hook = createLocalConsoleTokenHook({
    client: {
      enqueueMany(queued) {
        items.push(...queued);
        return queued.length;
      },
    },
    logger: console,
    estimator,
  });
  return { hook, items };
}

function firstTokenUsage(items: IngestItemV1[]): TokenUsageItem {
  const item = items.find((entry): entry is TokenUsageItem => entry.kind === "tokenUsage");
  if (!item) {
    throw new Error(`No tokenUsage item found in ${JSON.stringify(items)}`);
  }
  return item;
}

describe("createLocalConsoleTokenHook", () => {
  it("marks provider usage as actual", () => {
    const { hook, items } = collectTokenItems();

    hook.handle(event({ usage: { input: 10, output: 5, total: 15 } }), {
      sessionKey: "session-key",
      agentId: "agent-1",
    } as EventContext);

    const usage = firstTokenUsage(items);
    expect(usage.data.sourceType).toBe("actual");
    expect(usage.data.isEstimated).toBe(false);
    expect(usage.data.totalTokens).toBe(15);
  });

  it("marks estimator usage as estimated", () => {
    const { hook, items } = collectTokenItems({
      estimate() {
        return {
          inputTokens: 3,
          outputTokens: 4,
          totalTokens: 7,
          payloadJson: { estimateMethod: "test-estimator" },
        };
      },
    });

    hook.handle(event(), {} as EventContext);

    const usage = firstTokenUsage(items);
    expect(usage.data.sourceType).toBe("estimated");
    expect(usage.data.isEstimated).toBe(true);
    expect(usage.data.totalTokens).toBe(7);
    expect(usage.data.payloadJson?.estimateMethod).toBe("test-estimator");
  });

  it("emits unavailable token usage without inventing counts", () => {
    const { hook, items } = collectTokenItems({
      estimate() {
        return null;
      },
    });

    hook.handle(event(), {} as EventContext);

    const usage = firstTokenUsage(items);
    expect(usage.data.sourceType).toBe("unavailable");
    expect(usage.data.isEstimated).toBe(false);
    expect(usage.data.totalTokens).toBe(0);
    expect(usage.data.inputTokens).toBeUndefined();
    expect(usage.data.outputTokens).toBeUndefined();
  });
});
