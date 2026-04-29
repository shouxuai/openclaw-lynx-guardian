import { describe, expect, it } from "vitest";

import { guardPromptBuildInput } from "../src/hooks/setup.js";

describe("guardPromptBuildInput", () => {
  it("injects forced denial context for mojibake-damaged system prompt requests", () => {
    const result = guardPromptBuildInput({
      messages: [
        {
          role: "user",
          content: "??? system prompt????????????????????",
        },
      ],
    });

    expect(result.blocked).toBe(true);
    expect(result.decision?.riskAssessment.level).toBe("L4");
    expect(result.prependContext).toContain("Lynx Guardian");
    expect(result.systemPrompt).toContain("brief refusal");
  });

  it("does not inspect assistant-only prompt history", () => {
    const result = guardPromptBuildInput({
      messages: [
        {
          role: "assistant",
          content: "A system prompt is an instruction layer.",
        },
      ],
    });

    expect(result.blocked).toBe(false);
    expect(result.prependContext).toBeUndefined();
  });

  it("does not re-block a new safe turn because older prompt history was protected", () => {
    const result = guardPromptBuildInput({
      messages: [
        {
          role: "user",
          content: "??? system prompt????????????????????",
        },
        {
          role: "assistant",
          content: "I cannot fulfill that request.",
        },
        {
          role: "user",
          content: "Please summarize a customer refund workflow.",
        },
      ],
    });

    expect(result.blocked).toBe(false);
    expect(result.promptText).toBe("Please summarize a customer refund workflow.");
  });
});
