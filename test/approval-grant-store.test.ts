import { describe, expect, it } from "vitest";
import {
  clearApprovalGrants,
  matchApprovalGrant,
  saveApprovalGrant,
} from "../src/approval/approval-bridge.js";

describe("approval grant store", () => {
  it("matches same-source same-requester same-module lower-risk retries across runs", () => {
    clearApprovalGrants();
    const now = Date.now();
    saveApprovalGrant({
      grantId: "grant-1",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      maxRiskLevel: "L3",
      createdAt: now,
      expiresAt: now + 60_000,
      sourceApprovalId: "plugin:approval-1",
    } as any);

    expect(
      matchApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
      } as any),
    ).toMatchObject({
      grantId: "grant-1",
    });
  });

  it("does not match a different source, requester, or higher risk", () => {
    clearApprovalGrants();
    const now = Date.now();
    saveApprovalGrant({
      grantId: "grant-2",
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "oc_dm:ou_owner",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      maxRiskLevel: "L2",
      createdAt: now,
      expiresAt: now + 60_000,
      sourceApprovalId: "plugin:approval-2",
    } as any);

    expect(
      matchApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_other",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
      } as any),
    ).toBeUndefined();

    expect(
      matchApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_other",
        module: "M2:protected_file_access",
        riskLevel: "L2",
      } as any),
    ).toBeUndefined();

    expect(
      matchApprovalGrant({
        channelProfile: "feishu",
        channelId: "feishu",
        accountId: "default",
        conversationId: "oc_dm:ou_owner",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L3",
      } as any),
    ).toBeUndefined();
  });
});
