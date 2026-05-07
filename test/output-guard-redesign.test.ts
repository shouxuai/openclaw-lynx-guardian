import { describe, expect, it } from "vitest";

import {
  guardAssistantPersistence,
  guardOutputText,
  guardToolResultPersistence,
  type OutputSink,
} from "../src/local-guard/output-protection.js";

describe("sink-aware output guard", () => {
  it("defines the expected output sinks", () => {
    const sinks: OutputSink[] = [
      "llm_output",
      "agent_end",
      "before_message_write",
      "tool_result_persist",
      "message_sending",
    ];

    expect(sinks).toHaveLength(5);
  });

  it("keeps normal Chinese business output unchanged", () => {
    const text = "客户退款流程可以先按订单状态分层，再补充客服回访和财务复核节点。";
    const decision = guardOutputText(text, undefined, { sink: "message_sending" });

    expect(decision.changed).toBe(false);
    expect(decision.content).toBe(text);
  });

  it("keeps metadata-only protected config summaries unchanged", () => {
    const message = {
      role: "assistant",
      content: [
        "AGENTS.md content follows:",
        "- Name: Lynx Guardian",
        "- Version: 1.5.0",
        "- Description: repo-local development guidance",
        "- Current path: C:\\Users\\alice\\.openclaw\\extensions\\openclaw-lynx-guardian",
      ].join("\n"),
    };

    const decision = guardAssistantPersistence(message, { sink: "before_message_write" });

    expect(decision.block).toBe(false);
    expect(decision.message).toBe(message);
    expect(decision.warning).toContain("L2");
  });

  it("fully replaces PEM private keys in persisted tool results", () => {
    const decision = guardToolResultPersistence("read_file", {
      role: "tool",
      content: [
        "-----BEGIN PRIVATE KEY-----",
        "abc123",
        "-----END PRIVATE KEY-----",
      ].join("\n"),
    }, { sink: "tool_result_persist" });

    expect(decision.block).toBe(true);
    expect(String(decision.message?.content)).not.toContain("BEGIN PRIVATE KEY");
    expect(String(decision.message?.content)).toContain("direct:private_key");
  });

  it("redacts resident IDs without replacing the whole assistant message", () => {
    const decision = guardAssistantPersistence({
      role: "assistant",
      content: "客户身份证号：110105200002290021，请仅用于本次核验。",
    }, { sink: "before_message_write" });

    expect(decision.block).toBe(true);
    expect(String(decision.message?.content)).toContain("110105********0021");
    expect(String(decision.message?.content)).not.toContain("110105200002290021");
  });

  it("blocks raw system prompt content", () => {
    const decision = guardAssistantPersistence({
      role: "assistant",
      content: "The SOUL.md content says: 核心使命与防御架构, 纵深防御理念, 5级风险评估框架",
    }, { sink: "before_message_write" });

    expect(decision.block).toBe(true);
    expect(String(decision.message?.content)).toContain("modules=M2:system_prompt_leak");
    expect(String(decision.message?.content)).not.toContain("核心使命与防御架构");
  });

  it("does not replace trusted /lynx-check reports for ordinary security wording", () => {
    const report = {
      role: "assistant",
      content: [
        "/lynx-check 安全巡检报告",
        "发现项：建议检查插件配置、审批链路和日志可观测性。",
      ].join("\n"),
    };

    const decision = guardAssistantPersistence(report, {
      sink: "before_message_write",
      trustedManagedLynxCheckPersistence: true,
    });

    expect(decision.block).toBe(false);
    expect(decision.message).toBe(report);
  });

  it("still scans trusted /lynx-check reports for secrets", () => {
    const decision = guardAssistantPersistence({
      role: "assistant",
      content: [
        "/lynx-check 安全巡检报告",
        "-----BEGIN PRIVATE KEY-----",
        "abc123",
        "-----END PRIVATE KEY-----",
      ].join("\n"),
    }, {
      sink: "before_message_write",
      trustedManagedLynxCheckPersistence: true,
    });

    expect(decision.block).toBe(true);
    expect(String(decision.message?.content)).not.toContain("BEGIN PRIVATE KEY");
    expect(String(decision.message?.content)).toContain("direct:private_key");
  });
});
