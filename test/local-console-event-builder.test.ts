import { describe, expect, it } from "vitest";

import type {
  AuditEventItem,
  IngestItemV1,
  LynxCheckUpsertItem,
  ToolCallUpsertItem,
} from "../shared/src/ingest.js";
import { createLocalConsoleEventBuilder } from "../src/console/event-builder.js";

function findAuditEvent(items: IngestItemV1[]): AuditEventItem {
  const item = items.find((candidate): candidate is AuditEventItem => candidate.kind === "auditEvent");
  if (!item) {
    throw new Error("Expected audit event item.");
  }
  return item;
}

function findLynxCheck(items: IngestItemV1[]): LynxCheckUpsertItem {
  const item = items.find((candidate): candidate is LynxCheckUpsertItem => candidate.kind === "lynxCheckUpsert");
  if (!item) {
    throw new Error("Expected lynx-check upsert item.");
  }
  return item;
}

function findToolCall(items: IngestItemV1[]): ToolCallUpsertItem {
  const item = items.find((candidate): candidate is ToolCallUpsertItem => candidate.kind === "toolCallUpsert");
  if (!item) {
    throw new Error("Expected tool-call upsert item.");
  }
  return item;
}

describe("createLocalConsoleEventBuilder", () => {
  it("stores redacted prompt and assistant excerpts in audit events", () => {
    const builder = createLocalConsoleEventBuilder();
    const secretKey = `sk-${"a".repeat(32)}`;
    const promptEvent = findAuditEvent(builder.beforeAgentStart({
      occurredAtMs: 1_776_945_600_000,
      sessionKey: "session-a",
      runId: "run-a",
      promptText: `请根据身份证号 11010519491231002X 处理请求，临时密钥 ${secretKey}`,
    }));
    const assistantEvent = findAuditEvent(builder.agentEnd({
      occurredAtMs: 1_776_945_601_000,
      sessionKey: "session-a",
      runId: "run-a",
      outputText: "已经处理完成，银行卡 4111111111111111 不会原样写入审计日志。",
    }));

    expect(promptEvent.data.contentExcerpt).toContain("110105********002X");
    expect(promptEvent.data.contentExcerpt).not.toContain("11010519491231002X");
    expect(promptEvent.data.contentExcerpt).not.toContain(secretKey);
    expect(assistantEvent.data.contentExcerpt).toContain("411111******1111");
    expect(assistantEvent.data.contentExcerpt).not.toContain("4111111111111111");
  });

  it("can attach a completed lynx-check snapshot to agent_end", () => {
    const builder = createLocalConsoleEventBuilder();

    const check = findLynxCheck(builder.agentEnd({
      occurredAtMs: 1_776_945_610_000,
      sessionKey: "session-a",
      runId: "run-a",
      requestId: "lynx-check-1",
      outputText: "report sent",
      lynxCheck: {
        requestId: "lynx-check-1",
        source: "manual",
        trigger: "lynx_command",
        preferredTargetKind: "current",
        sessionKey: "session-a",
        status: "completed",
        sendAttempted: true,
        sendSucceeded: true,
        transport: "message_sending",
        reportPath: "C:/tmp/report.md",
        createdAtMs: 1_776_945_600_000,
        completedAtMs: 1_776_945_610_000,
      },
    } as any));

    expect(check.data.status).toBe("completed");
    expect(check.data.sendAttempted).toBe(true);
    expect(check.data.sendSucceeded).toBe(true);
    expect(check.data.completedAtMs).toBe(1_776_945_610_000);
  });

  it("stores long excerpts up to 1024 characters without display ellipses", () => {
    const builder = createLocalConsoleEventBuilder();
    const longPrompt = "p".repeat(1_100);
    const longParamSummary = "a".repeat(1_100);
    const longResult = "r".repeat(1_100);
    const longError = "e".repeat(1_100);

    const promptEvent = findAuditEvent(builder.beforeAgentStart({
      occurredAtMs: 1_776_945_620_000,
      sessionKey: "session-long",
      runId: "run-long",
      promptText: longPrompt,
    }));
    const toolCall = findToolCall(builder.afterToolCall({
      occurredAtMs: 1_776_945_621_000,
      sessionKey: "session-long",
      runId: "run-long",
      toolCallId: "tool-long",
      toolName: "shell",
      paramSummary: longParamSummary,
      resultExcerpt: longResult,
      errorText: longError,
    }));

    expect(promptEvent.data.contentExcerpt).toHaveLength(1_024);
    expect(promptEvent.data.contentExcerpt?.endsWith("...")).toBe(false);
    expect(toolCall.data.paramSummary).toHaveLength(1_024);
    expect(toolCall.data.paramSummary?.endsWith("...")).toBe(false);
    expect(toolCall.data.resultExcerpt).toHaveLength(1_024);
    expect(toolCall.data.resultExcerpt?.endsWith("...")).toBe(false);
    expect(toolCall.data.errorText).toHaveLength(1_024);
    expect(toolCall.data.errorText?.endsWith("...")).toBe(false);
  });
});
