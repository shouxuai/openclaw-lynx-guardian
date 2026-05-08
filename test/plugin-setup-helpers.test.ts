import { describe, expect, it } from "vitest";

import {
  appendFeishuNativeApprovalGuidance,
  buildToolApprovalDetailDescription,
  buildFeishuNativeToolApprovalReplyPrompt,
  extractApproveCommand,
  resolveToolApprovalScopeType,
  resolveToolApprovalProtectedTargetSummary,
} from "../src/approval/approval-prompts.js";
import {
  buildOutboundDeliveryTarget,
} from "../src/delivery/delivery-targets.js";
import {
  resolveManagedLynxCheckPromptChannel,
  resolveManagedLynxCheckSource,
} from "../src/lynx-check/setup-helpers.js";

describe("plugin setup helpers", () => {
  it("extracts allow and deny decisions from an approve command", () => {
    expect(extractApproveCommand("/approve approval-1 allow-once|deny")).toEqual({
      approvalId: "approval-1",
      allowDecision: "allow-once",
      denyDecision: "deny",
    });
  });

  it("does not append duplicate approval command guidance after a native approval surface appears", () => {
    const baseText = [
      "[Lynx Guardian] exec 已进入原生审批窗口。",
      "/approve approval-1 allow-once|deny",
    ].join("\n");
    const withGuidance = appendFeishuNativeApprovalGuidance(baseText);

    expect(withGuidance).toBe(baseText);
    expect(withGuidance).not.toContain("确认放行本次操作");
  });

  it("builds native approval context text without manual approve commands", () => {
    const prompt = buildFeishuNativeToolApprovalReplyPrompt({
      approvalId: "approval-1",
      module: "M3:over_agency",
      riskLevel: "L3",
      toolName: "exec",
      timeoutMs: 30_000,
    });

    expect(prompt).toContain("[Lynx Guardian]");
    expect(prompt).toContain("exec");
    expect(prompt).not.toContain("/approve");
    expect(prompt).not.toContain("确认放行本次操作");
    expect(prompt).toContain("\n---\n");
    expect(prompt).toContain("[^lynx-log]");
    expect(prompt).toContain("http://127.0.0.1:18789/webview");
  });

  it("summarizes protected targets from file paths, commands, and fallback params", () => {
    expect(resolveToolApprovalProtectedTargetSummary("read", {
      file_path: "  C:\\temp\\demo.txt  ",
    })).toBe("C:\\temp\\demo.txt");

    expect(resolveToolApprovalProtectedTargetSummary("exec", {
      command: "  git   status   --short  ",
    })).toBe("git status --short");

    expect(resolveToolApprovalProtectedTargetSummary("custom", {
      nested: {
        value: 1,
      },
    })).toContain('"nested":{"value":1}');
  });

  it("describes why approval is needed and what the current-process approval covers", () => {
    const description = buildToolApprovalDetailDescription({
      reason: "protected file access",
      toolName: "read",
      protectedTargetSummary: "C:\\secrets\\config.json",
      scopeType: "workflow",
    });

    expect(resolveToolApprovalScopeType("read")).toBe("workflow");
    expect(resolveToolApprovalScopeType("exec")).toBe("execWorkflow");
    expect(description).toContain("原因：protected file access");
    expect(description).toContain("审批对象：read C:\\secrets\\config.json");
    expect(description).toContain("批准范围：当前流程内同级或更低风险的非执行工具调用");
  });

  it("describes exec approvals as a separate current-process command boundary", () => {
    const description = buildToolApprovalDetailDescription({
      reason: "fatal triangle",
      toolName: "exec",
      protectedTargetSummary: "wget https://example.com",
      scopeType: "execWorkflow",
    });

    expect(description).toContain("审批对象：exec wget https://example.com");
    expect(description).toContain("批准范围：当前流程内同级或更低风险的执行命令调用");
  });

  it("resolves managed /lynx-check source and prompt channel from runtime context", () => {
    expect(resolveManagedLynxCheckSource({
      trigger: "cron",
    })).toBe("scheduled");
    expect(resolveManagedLynxCheckSource({
      subsystem: "plugins",
    })).toBe("scheduled");
    expect(resolveManagedLynxCheckSource({
      sessionKey: "interactive:session-1",
    })).toBe("manual");

    expect(resolveManagedLynxCheckPromptChannel({
      messageProvider: "feishu",
    })).toBe("feishu");
    expect(resolveManagedLynxCheckPromptChannel({
      channelId: "webchat",
    })).toBe("webchat");
    expect(resolveManagedLynxCheckPromptChannel({}, {
      channelId: "sms",
    })).toBe("generic");
  });

  it("merges outbound delivery data from context and outgoing event", () => {
    expect(buildOutboundDeliveryTarget(
      {
        to: "conversation-2",
        accountId: "acc-2",
        threadId: "thread-2",
      },
      {
        sessionKey: "session-1",
        channelId: "feishu",
        messageProvider: "feishu",
        senderId: "ou_owner_1",
        to: "conversation-1",
        accountId: "acc-1",
        threadId: "thread-1",
      },
    )).toEqual({
      sessionKey: "session-1",
      channelId: "feishu",
      messageProvider: "feishu",
      senderId: "ou_owner_1",
      bindingId: undefined,
      to: "conversation-2",
      accountId: "acc-2",
      threadId: "thread-2",
    });
  });
});
