import { describe, expect, it } from "vitest";
import {
  clearApprovalGrants,
  matchApprovalGrant,
  revokeApprovalGrantsForLifecycle,
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

  it("keeps grants scoped to the current chain, run, tool, requester, and target", () => {
    clearApprovalGrants();
    const now = Date.now();
    saveApprovalGrant({
      grantId: "grant-scoped",
      channelProfile: "webchat",
      channelId: "web",
      accountId: "default",
      conversationId: "conversation-1",
      sessionKey: "session-1",
      chainId: "chain-1",
      runId: "run-1",
      requesterOuId: "ou-a",
      module: "M2:protected_file_access",
      toolName: "exec",
      targetFingerprint: "cmd:abc",
      maxRiskLevel: "L3",
      createdAt: now,
      expiresAt: now + 60_000,
      sourceApprovalId: "plugin:approval-scoped",
    });

    expect(
      matchApprovalGrant({
        channelProfile: "webchat",
        channelId: "web",
        accountId: "default",
        conversationId: "conversation-1",
        sessionKey: "session-1",
        chainId: "chain-1",
        runId: "run-1",
        requesterOuId: "ou-a",
        module: "M2:protected_file_access",
        toolName: "exec",
        targetFingerprint: "cmd:abc",
        riskLevel: "L3",
      }),
    ).toMatchObject({ grantId: "grant-scoped" });

    for (const override of [
      { targetFingerprint: "cmd:expanded" },
      { runId: "run-2" },
      { chainId: "chain-2" },
      { requesterOuId: "ou-b" },
      { toolName: "read" },
    ]) {
      expect(
        matchApprovalGrant({
          channelProfile: "webchat",
          channelId: "web",
          accountId: "default",
          conversationId: "conversation-1",
          sessionKey: "session-1",
          chainId: "chain-1",
          runId: "run-1",
          requesterOuId: "ou-a",
          module: "M2:protected_file_access",
          toolName: "exec",
          targetFingerprint: "cmd:abc",
          riskLevel: "L3",
          ...override,
        }),
      ).toBeUndefined();
    }
  });

  it("does not replace same-module grants for different protected targets", () => {
    clearApprovalGrants();
    const now = Date.now();
    const baseGrant = {
      channelProfile: "webchat" as const,
      channelId: "web",
      accountId: "default",
      conversationId: "conversation-1",
      sessionKey: "session-1",
      chainId: "chain-1",
      runId: "run-1",
      requesterOuId: "ou-a",
      module: "M2:protected_file_access",
      toolName: "exec",
      maxRiskLevel: "L3" as const,
      createdAt: now,
      expiresAt: now + 60_000,
    };

    saveApprovalGrant({
      ...baseGrant,
      grantId: "grant-target-a",
      targetFingerprint: "cmd:abc",
      sourceApprovalId: "plugin:approval-a",
    });
    saveApprovalGrant({
      ...baseGrant,
      grantId: "grant-target-b",
      targetFingerprint: "cmd:def",
      sourceApprovalId: "plugin:approval-b",
    });

    expect(
      matchApprovalGrant({
        channelProfile: "webchat",
        channelId: "web",
        accountId: "default",
        conversationId: "conversation-1",
        sessionKey: "session-1",
        chainId: "chain-1",
        runId: "run-1",
        requesterOuId: "ou-a",
        module: "M2:protected_file_access",
        toolName: "exec",
        targetFingerprint: "cmd:abc",
        riskLevel: "L3",
      }),
    ).toMatchObject({ grantId: "grant-target-a" });

    expect(
      matchApprovalGrant({
        channelProfile: "webchat",
        channelId: "web",
        accountId: "default",
        conversationId: "conversation-1",
        sessionKey: "session-1",
        chainId: "chain-1",
        runId: "run-1",
        requesterOuId: "ou-a",
        module: "M2:protected_file_access",
        toolName: "exec",
        targetFingerprint: "cmd:def",
        riskLevel: "L3",
      }),
    ).toMatchObject({ grantId: "grant-target-b" });
  });

  it("revokes matching in-memory grants when an agent lifecycle ends", () => {
    clearApprovalGrants();
    const now = Date.now();
    saveApprovalGrant({
      grantId: "grant-revoked",
      channelProfile: "webchat",
      channelId: "web",
      accountId: "default",
      conversationId: "conversation-1",
      sessionKey: "session-1",
      chainId: "chain-1",
      runId: "run-1",
      requesterOuId: "ou-a",
      module: "M2:protected_file_access",
      toolName: "exec",
      targetFingerprint: "cmd:abc",
      maxRiskLevel: "L3",
      createdAt: now,
      expiresAt: now + 60_000,
      sourceApprovalId: "plugin:approval-revoked",
    });

    expect(
      revokeApprovalGrantsForLifecycle({
        sessionKey: "session-1",
        chainId: "chain-1",
        reason: "agent_end",
      }),
    ).toBe(1);

    expect(
      matchApprovalGrant({
        channelProfile: "webchat",
        channelId: "web",
        accountId: "default",
        conversationId: "conversation-1",
        sessionKey: "session-1",
        chainId: "chain-1",
        runId: "run-1",
        requesterOuId: "ou-a",
        module: "M2:protected_file_access",
        toolName: "exec",
        targetFingerprint: "cmd:abc",
        riskLevel: "L3",
      }),
    ).toBeUndefined();
  });
});
