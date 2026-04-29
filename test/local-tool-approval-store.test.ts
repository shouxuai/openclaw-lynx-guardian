import { describe, expect, it } from "vitest";
import {
  clearLocalToolApprovals,
  registerLocalToolApproval,
} from "../src/runtime/local-tool-approval-store.js";

describe("local tool approval store", () => {
  it("reuses an open approval token for repeated same-source same-module requests", () => {
    clearLocalToolApprovals();

    const first = registerLocalToolApproval({
      pendingId: "pending-1",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      requestFingerprint: "fp-1",
      approverOuIds: ["ou_f3d86d9e96e13864d7f572aa281a2dff"],
      module: "M2:protected_file_access",
      riskLevel: "L2",
      toolName: "read",
      timeoutMs: 60_000,
      onResolution: () => {},
    } as any);

    const second = registerLocalToolApproval({
      pendingId: "pending-2",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      requestFingerprint: "fp-1",
      approverOuIds: ["ou_f3d86d9e96e13864d7f572aa281a2dff"],
      module: "M2:protected_file_access",
      riskLevel: "L2",
      toolName: "read",
      timeoutMs: 60_000,
      onResolution: () => {},
    } as any);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.approval?.approvalToken).toBe(first.approval?.approvalToken);
    expect(first.approval?.requestFingerprint).toBe("fp-1");
  });

  it("creates a new approval when the feishu request fingerprint differs", () => {
    clearLocalToolApprovals();

    const first = registerLocalToolApproval({
      pendingId: "pending-1",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      requestFingerprint: "fp-1",
      approverOuIds: ["ou_f3d86d9e96e13864d7f572aa281a2dff"],
      module: "M2:protected_file_access",
      riskLevel: "L2",
      toolName: "read",
      timeoutMs: 60_000,
      onResolution: () => {},
    } as any);

    const second = registerLocalToolApproval({
      pendingId: "pending-2",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      requestFingerprint: "fp-2",
      approverOuIds: ["ou_f3d86d9e96e13864d7f572aa281a2dff"],
      module: "M2:protected_file_access",
      riskLevel: "L2",
      toolName: "read",
      timeoutMs: 60_000,
      onResolution: () => {},
    } as any);

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.approval?.approvalToken).not.toBe(first.approval?.approvalToken);
    expect(second.approval?.requestFingerprint).toBe("fp-2");
  });

  it("fails closed for feishu approvals when request fingerprint is missing", () => {
    clearLocalToolApprovals();

    const result = registerLocalToolApproval({
      pendingId: "pending-missing-fp",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      riskLevel: "L2",
      toolName: "read",
      timeoutMs: 60_000,
      onResolution: () => {},
    } as any);

    expect(result.created).toBe(false);
    expect(result.approval).toBeUndefined();
  });
});
