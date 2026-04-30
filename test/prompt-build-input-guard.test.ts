import { describe, expect, it, vi } from "vitest";

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

  it("treats L3 prompt-build input as model context instead of forced denial", async () => {
    vi.resetModules();
    vi.doMock("../src/guard/safety-guard.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../src/guard/safety-guard.js")>();
      return {
        ...actual,
        guardInput: vi.fn(() => ({
          block: true,
          blockReason: "[Lynx Guardian] protected read request",
          riskAssessment: {
            level: "L3",
            score: 7,
            modules: ["M2:protected_file_access"],
            action: "block",
            description: "protected read request",
          },
        })),
      };
    });

    const { guardPromptBuildInput: guardedPromptBuildInput } = await import("../src/hooks/setup.js");
    const result = guardedPromptBuildInput({
      prompt: "Please inspect a protected file only if approved.",
    });

    expect(result.blocked).toBe(false);
    expect(result.decision?.riskAssessment.level).toBe("L3");
    expect(result.prependContext).toContain("Input risk is L3");
    expect(result.systemPrompt).toBeUndefined();
    expect(result.prependContext).not.toContain("Lynx Guardian L4 Denial");

    vi.doUnmock("../src/guard/safety-guard.js");
  });
});
