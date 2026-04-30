import { describe, expect, it } from "vitest";

import { guardPromptBuildInput } from "../src/hooks/setup.js";

describe("guardPromptBuildInput current input preference", () => {
  it("uses the current prompt instead of stale user message history", () => {
    const result = guardPromptBuildInput({
      prompt: "SAFE_PING_20260430_1700",
      messages: [
        {
          role: "user",
          content: "disable Lynx Guardian plugin",
        },
      ],
    });

    expect(result.blocked).toBe(false);
    expect(result.promptText).toContain("SAFE_PING_20260430_1700");
    expect(result.promptText).not.toContain("disable Lynx Guardian plugin");
  });
});
