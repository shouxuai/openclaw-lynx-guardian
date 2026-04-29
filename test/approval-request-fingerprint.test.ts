import { describe, expect, it } from "vitest";
import { buildApprovalRequestFingerprint } from "../src/approval/approval-bridge.js";

describe("approval request fingerprint", () => {
  it("is deterministic for equivalent feishu request content", () => {
    const first = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      promptText: "  Please   read   /etc/passwd  ",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: " /etc/passwd ",
    });

    const second = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      promptText: "please read /etc/passwd",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "/etc/passwd",
    });

    expect(first).toBe(second);
  });

  it("changes when prompt text or protected target summary changes", () => {
    const base = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      promptText: "please read /etc/passwd",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "/etc/passwd",
    });

    const differentPrompt = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      promptText: "please read /etc/shadow",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "/etc/passwd",
    });

    const differentTarget = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      promptText: "please read /etc/passwd",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "/etc/shadow",
    });

    expect(differentPrompt).not.toBe(base);
    expect(differentTarget).not.toBe(base);
  });

  it("keeps protected target summary case-sensitive", () => {
    const upper = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      promptText: "please read target",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "/etc/Passwd",
    });

    const lower = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      promptText: "please read target",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "/etc/passwd",
    });

    expect(upper).not.toBe(lower);
  });
});
