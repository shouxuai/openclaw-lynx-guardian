import { describe, expect, it } from "vitest";
import {
  clearRunApprovalContexts,
  saveRunApprovalContext,
  readRunApprovalContext,
} from "../src/approval/approval-bridge.js";

describe("run approval context store", () => {
  it("binds requester identity to a specific run", () => {
    clearRunApprovalContexts();
    const now = Date.now();
    saveRunApprovalContext({
      runId: "run-1",
      sessionKey: "sess-group-1",
      channelProfile: "feishu",
      requesterId: "ou_owner",
      requesterOuId: "ou_owner",
      accountId: "default",
      conversationId: "chat-1",
      promptText: "please read /etc/passwd",
      threadId: "thread-9",
      isGroup: true,
      createdAt: now,
      expiresAt: now + 60_000,
    });

    expect(readRunApprovalContext("run-1")).toMatchObject({
      requesterOuId: "ou_owner",
      conversationId: "chat-1",
      promptText: "please read /etc/passwd",
    });
  });

  it("returns defensive copies from read", () => {
    clearRunApprovalContexts();
    const now = Date.now();
    saveRunApprovalContext({
      runId: "run-copy",
      sessionKey: "sess-group-1",
      channelProfile: "feishu",
      requesterId: "ou_owner",
      requesterOuId: "ou_owner",
      accountId: "default",
      conversationId: "chat-1",
      promptText: "please read /etc/passwd",
      threadId: "thread-9",
      isGroup: true,
      createdAt: now,
      expiresAt: now + 60_000,
    });

    const first = readRunApprovalContext("run-copy");
    expect(first).toBeDefined();
    (first as any).promptText = "tampered";

    const second = readRunApprovalContext("run-copy");
    expect(second).toMatchObject({ promptText: "please read /etc/passwd" });
  });
});
