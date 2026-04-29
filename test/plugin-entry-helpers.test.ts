import { afterEach, describe, expect, it } from "vitest";

import {
  buildForcedAgentStartDenyContext,
  buildToolApprovalRoute,
  parseLocalToolApprovalReply,
  resolveManagedLynxCheckCommandText,
} from "../src/runtime/plugin-entry-helpers.js";

describe("plugin entry helpers", () => {
  const previousRuntimeVersion = process.env.OPENCLAW_VERSION;

  afterEach(() => {
    if (previousRuntimeVersion === undefined) {
      delete process.env.OPENCLAW_VERSION;
      return;
    }

    process.env.OPENCLAW_VERSION = previousRuntimeVersion;
  });

  it("finds a /lynx-check command inside a bracket-prefixed envelope", () => {
    expect(resolveManagedLynxCheckCommandText({
      messages: [
        {
          role: "user",
          content: "[feishu-bot] /lynx-check",
        },
      ],
    })).toBe("/lynx-check");
  });

  it("parses a local tool approval command with token and resolution", () => {
    expect(parseLocalToolApprovalReply("please run /lynx-approve abc123 allow-once now")).toEqual({
      command: "lynx-approve",
      token: "abc123",
      resolution: "allow-once",
    });

    expect(parseLocalToolApprovalReply("/lynx-approve deny")).toEqual({
      command: "lynx-approve",
      token: undefined,
      resolution: "deny",
    });
  });

  it("appends a separated local log webview note to forced L4 deny context", () => {
    const text = buildForcedAgentStartDenyContext({
      riskLevel: "L4",
      reason: "dangerous control-plane request",
    });

    expect(text).toContain("\n---\n");
    expect(text).toContain("[^lynx-log]");
    expect(text).toContain("http://127.0.0.1:18789/webview");
    expect(text).toContain("本地日志页面");
    expect(text).toContain("审计日志");
    expect(text).toContain("最终面向用户的拒绝回复必须");
  });

  it("routes legacy webchat approvals through recovered feishu fallback context", () => {
    process.env.OPENCLAW_VERSION = "2026.3.27";

    const route = buildToolApprovalRoute({
      ctx: {
        channelId: "webchat",
        messageProvider: "webchat",
        sessionKey: "webchat:run-1",
        threadId: "thread-web",
      },
      currentApprovalContext: {
        channelProfile: "webchat",
        approvalTransport: "native",
        sessionKey: "webchat:run-1",
        isGroup: false,
      },
      recoveredFeishuApprovalContext: {
        channelProfile: "feishu",
        approvalTransport: "local-chat",
        sessionKey: "feishu:session-1",
        requesterOuId: "ou_owner_1",
        conversationId: "user:ou_owner_1",
        accountId: "acc-1",
        threadId: "thread-feishu",
        isGroup: false,
      },
      approverOuIds: ["ou_owner_1"],
    });

    expect(route).toMatchObject({
      compatMode: "feishu-local",
      channelProfile: "feishu",
      approvalTransport: "local-chat",
      sessionKey: "feishu:session-1",
      requesterOuId: "ou_owner_1",
      conversationId: "user:ou_owner_1",
      accountId: "acc-1",
      threadId: "thread-feishu",
      runtimeTier: "legacy",
    });
    expect(route.approvalCtx).toMatchObject({
      channelId: "feishu",
      messageProvider: "feishu",
      senderOpenId: "ou_owner_1",
      conversationId: "user:ou_owner_1",
      accountId: "acc-1",
      threadId: "thread-feishu",
    });
  });
});
