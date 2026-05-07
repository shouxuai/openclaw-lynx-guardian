import { describe, expect, it } from "vitest";
import type { EventContext } from "../src/types.js";
import {
  buildOperationFingerprint,
  resolveOverrideKey,
  resolveOverrideKeys,
} from "../src/runtime/override-runtime.js";

describe("override-runtime helpers", () => {
  it("deduplicates override keys from session and channel", () => {
    const ctx: EventContext = {
      sessionKey: "sess-1",
      channelId: "chan-1",
    };

    expect(resolveOverrideKeys(ctx)).toEqual(["sess-1", "chan-1"]);
  });

  it("prefers channelId as primary override key", () => {
    const ctx: EventContext = {
      sessionKey: "sess-1",
      channelId: "chan-1",
    };

    expect(resolveOverrideKey(ctx)).toBe("chan-1");
  });

  it("builds stable fingerprints for the same payload", () => {
    const first = buildOperationFingerprint({
      sessionKey: "sess-1",
      actionType: "tool",
      payload: "{\"toolName\":\"exec\"}",
    });
    const second = buildOperationFingerprint({
      sessionKey: "sess-1",
      actionType: "tool",
      payload: "{\"toolName\":\"exec\"}",
    });

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });
});
