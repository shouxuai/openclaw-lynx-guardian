import { describe, expect, it, vi } from "vitest";
import {
  clearFeishuLocalApprovalGrants,
  consumeFeishuLocalApprovalGrant,
  saveFeishuLocalApprovalGrant,
} from "../src/approval/approval-bridge.js";

describe("feishu local approval grant store", () => {
  it("matches exact scope and consumes a one-time grant", () => {
    clearFeishuLocalApprovalGrants();
    const now = Date.now();
    saveFeishuLocalApprovalGrant({
      grantId: "grant-1",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      maxRiskLevel: "L3",
      requestFingerprint: "fp-1",
      grantedByOuId: "ou_admin",
      createdAt: now,
      expiresAt: now + 60_000,
      sourceApprovalId: "pending-1",
    });

    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: "fp-1",
      }),
    ).toMatchObject({ grantId: "grant-1" });

    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: "fp-1",
      }),
    ).toBeUndefined();
  });

  it("does not match different fingerprint, higher risk, or non-feishu channel", () => {
    clearFeishuLocalApprovalGrants();
    const now = Date.now();
    saveFeishuLocalApprovalGrant({
      grantId: "grant-2",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      maxRiskLevel: "L2",
      requestFingerprint: "fp-2",
      grantedByOuId: "ou_admin",
      createdAt: now,
      expiresAt: now + 60_000,
      sourceApprovalId: "pending-2",
    });

    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: "fp-other",
      }),
    ).toBeUndefined();

    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L3",
        requestFingerprint: "fp-2",
      }),
    ).toBeUndefined();

    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "webchat",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: "fp-2",
      }),
    ).toBeUndefined();
  });

  it("prunes expired grants", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-17T00:00:00Z"));
      saveFeishuLocalApprovalGrant({
        grantId: "grant-expired",
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        maxRiskLevel: "L3",
        requestFingerprint: "fp-expired",
        grantedByOuId: "ou_admin",
        createdAt: Date.now(),
        expiresAt: Date.now() + 1_000,
        sourceApprovalId: "pending-expired",
      });
      vi.setSystemTime(new Date("2026-04-17T00:00:03Z"));

      expect(
        consumeFeishuLocalApprovalGrant({
          channelProfile: "feishu",
          channelId: "feishu",
          accountId: "default",
          conversationId: "oc_dm:ou_owner",
          requesterOuId: "ou_owner",
          module: "M2:protected_file_access",
          riskLevel: "L2",
          requestFingerprint: "fp-expired",
        }),
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
      clearFeishuLocalApprovalGrants();
    }
  });

  it("consumes a grant exactly once even if extra remainingUses data is present", () => {
    clearFeishuLocalApprovalGrants();
    const now = Date.now();
    saveFeishuLocalApprovalGrant({
      grantId: "grant-single-use",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      maxRiskLevel: "L3",
      requestFingerprint: "fp-single-use",
      grantedByOuId: "ou_admin",
      createdAt: now,
      expiresAt: now + 60_000,
      sourceApprovalId: "pending-single-use",
      remainingUses: 9,
    } as any);

    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: "fp-single-use",
      }),
    ).toMatchObject({ grantId: "grant-single-use" });

    expect(
      consumeFeishuLocalApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
        requestFingerprint: "fp-single-use",
      }),
    ).toBeUndefined();
  });
});
