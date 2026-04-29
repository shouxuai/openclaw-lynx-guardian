import { describe, expect, it } from "vitest";

import {
  appendFeishuNativeApprovalGuidance,
  buildFeishuNativeToolApprovalReplyPrompt,
  extractApproveCommand,
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

  it("adds feishu approval guidance only once", () => {
    const baseText = [
      "[Lynx Guardian] exec 已进入原生审批窗口。",
      "/approve approval-1 allow-once|deny",
    ].join("\n");
    const withGuidance = appendFeishuNativeApprovalGuidance(baseText);

    expect(withGuidance).toContain("飞书审批提示：");
    expect(withGuidance).toContain("请在 Feishu 会话回复或webchat中进行审批。");
    expect(appendFeishuNativeApprovalGuidance(withGuidance)).toBe(withGuidance);
  });

  it("appends a separated local log webview note to native approval prompts", () => {
    const prompt = buildFeishuNativeToolApprovalReplyPrompt({
      approvalId: "approval-1",
      module: "M3:over_agency",
      riskLevel: "L3",
      toolName: "exec",
      timeoutMs: 30_000,
      confirmationPhrase: "确认放行本次操作",
    });

    expect(prompt).toContain("\n---\n");
    expect(prompt).toContain("[^lynx-log]");
    expect(prompt).toContain("http://127.0.0.1:18789/webview");
    expect(prompt).toContain("本地日志页面");
    expect(prompt).toContain("工具调用");
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
