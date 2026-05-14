import { describe, expect, it } from "vitest";

import { stripToolUseAssistantPreamble } from "../src/runtime/tool-use-assistant-persistence.js";

describe("stripToolUseAssistantPreamble", () => {
  it("removes assistant preamble text and thinking from tool-use messages", () => {
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "The user wants me to create a project." },
        { type: "text", text: "好，我来创建一个完整的 Python + FastAPI + SQLAlchemy ORM 项目。\n\n" },
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
      content: [{ type: "text", text: "项目已经创建完成。" }],
    };

    expect(stripToolUseAssistantPreamble(message)).toBe(message);
  });

  it("preserves explicit final_answer text if a provider marks it", () => {
    const finalSignature = JSON.stringify({ v: 1, id: "final", phase: "final_answer" });
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "Working...", textSignature: JSON.stringify({ v: 1, id: "c", phase: "commentary" }) },
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
