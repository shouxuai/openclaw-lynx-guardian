import { describe, expect, it } from "vitest";

import { stripToolUseAssistantPreamble } from "../src/runtime/tool-use-assistant-persistence.js";

describe("stripToolUseAssistantPreamble", () => {
  it("removes assistant preamble text and thinking from tool-use messages", () => {
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "The model is planning before a tool call." },
        { type: "text", text: "PREAMBLE-SHOULD-NOT-PERSIST\n\n" },
        { type: "toolCall", id: "call_1", name: "write", arguments: { path: "requirements.txt" } },
      ],
    };

    const stripped = stripToolUseAssistantPreamble(message);

    expect(stripped).not.toBe(message);
    expect(stripped.content).toEqual([
      { type: "toolCall", id: "call_1", name: "write", arguments: { path: "requirements.txt" } },
    ]);
  });

  it("leaves ordinary assistant replies unchanged", () => {
    const message = {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "Project created." }],
    };

    expect(stripToolUseAssistantPreamble(message)).toBe(message);
  });

  it("preserves explicit final_answer text if a provider marks it", () => {
    const finalSignature = JSON.stringify({ v: 1, id: "final", phase: "final_answer" });
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        {
          type: "text",
          text: "Working...",
          textSignature: JSON.stringify({ v: 1, id: "commentary", phase: "commentary" }),
        },
        { type: "text", text: "Done.", textSignature: finalSignature },
        { type: "toolCall", id: "call_1", name: "exec", arguments: { command: "pwd" } },
      ],
    };

    expect(stripToolUseAssistantPreamble(message).content).toEqual([
      { type: "text", text: "Done.", textSignature: finalSignature },
      { type: "toolCall", id: "call_1", name: "exec", arguments: { command: "pwd" } },
    ]);
  });
});
