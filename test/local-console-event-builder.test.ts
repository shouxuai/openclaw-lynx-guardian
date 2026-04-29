import { describe, expect, it } from "vitest";

import type {
  AuditEventItem,
  ApprovalUpsertItem,
  IngestItemV1,
  LynxCheckUpsertItem,
  QaRecordUpsertItem,
  ToolCallUpsertItem,
} from "../shared/src/ingest.js";
import { createLocalConsoleEventBuilder } from "../src/console/event-builder.js";
import { createLocalConsoleHookHandlers } from "../src/console/runtime.js";

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

function findQaRecord(items: IngestItemV1[]): QaRecordUpsertItem {
  const item = items.find((candidate): candidate is QaRecordUpsertItem => candidate.kind === "qaRecordUpsert");
  if (!item) {
    throw new Error("Expected QA record upsert item.");
  }
  return item;
}

function findApproval(items: IngestItemV1[]): ApprovalUpsertItem {
  const item = items.find((candidate): candidate is ApprovalUpsertItem => candidate.kind === "approvalUpsert");
  if (!item) {
    throw new Error("Expected approval upsert item.");
  }
  return item;
}

describe("createLocalConsoleEventBuilder", () => {
  it("groups prompt, tools, approvals, audits, and final answer into one QA record per run", () => {
    const builder = createLocalConsoleEventBuilder();
    const base = {
      occurredAtMs: 1_776_945_600_000,
      sessionKey: "session-a",
      runId: "run-a",
    };

    const promptItems = builder.beforeAgentStart({
      ...base,
      promptText: "Summarize the current project status",
    });
    const promptQaRecord = findQaRecord(promptItems);
    const promptAudit = findAuditEvent(promptItems);

    expect(promptQaRecord.data.sessionKey).toBe("session-a");
    expect(promptQaRecord.data.runId).toBe("run-a");
    expect(promptQaRecord.data.userPromptExcerpt).toBe("Summarize the current project status");
    expect(promptQaRecord.data.status).toBe("running");
    expect(promptAudit.data.qaRecordId).toBe(promptQaRecord.data.qaRecordId);

    const toolItems = builder.beforeToolCall({
      ...base,
      occurredAtMs: base.occurredAtMs + 100,
      toolCallId: "tool-a",
      toolName: "exec",
      params: { command: "git status" },
      approval: {
        approvalId: "approval-a",
        module: "M2:protected_file_access",
        riskLevel: "L3",
        scopeType: "singleTool",
        requestedAtMs: base.occurredAtMs + 100,
        expiresAtMs: base.occurredAtMs + 60_000,
      },
    });
    const toolCall = findToolCall(toolItems);
    const toolAudit = findAuditEvent(toolItems);
    const approval = findApproval(toolItems);

    expect(toolCall.data.qaRecordId).toBe(promptQaRecord.data.qaRecordId);
    expect(toolAudit.data.qaRecordId).toBe(promptQaRecord.data.qaRecordId);
    expect(approval.data.qaRecordId).toBe(promptQaRecord.data.qaRecordId);

    const finalItems = builder.agentEnd({
      ...base,
      occurredAtMs: base.occurredAtMs + 500,
      outputText: "Project status summarized.",
    });
    const finalQaRecord = findQaRecord(finalItems);
    const finalAudit = findAuditEvent(finalItems);

    expect(finalQaRecord.data.qaRecordId).toBe(promptQaRecord.data.qaRecordId);
    expect(finalQaRecord.data.finalAnswerExcerpt).toBe("Project status summarized.");
    expect(finalQaRecord.data.status).toBe("completed");
    expect(finalAudit.data.qaRecordId).toBe(promptQaRecord.data.qaRecordId);
  });

  it("carries the active QA record into output hooks that do not expose runId", () => {
    const batches: IngestItemV1[][] = [];
    const handlers = createLocalConsoleHookHandlers({
      client: {
        enqueueMany(items) {
          batches.push(items);
          return items.length;
        },
      },
      logger: {
        warn() {},
        error() {},
      },
    });

    handlers.beforeAgentStart({
      occurredAtMs: 1_776_945_600_000,
      sessionKey: "session-a",
      runId: "run-a",
      promptText: "Summarize the current project status",
    });
    const qaRecordId = findQaRecord(batches[0]).data.qaRecordId;

    handlers.beforeMessageWrite({
      occurredAtMs: 1_776_945_600_100,
      sessionKey: "session-a",
      contentExcerpt: "Project status summarized.",
      contentKind: "assistant_message",
      messageRole: "assistant",
      messageChanged: false,
      enforcementAction: "allow",
    });
    const messageWriteAudit = findAuditEvent(batches[1]);

    expect(messageWriteAudit.data.qaRecordId).toBe(qaRecordId);
  });

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
