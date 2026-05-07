import { describe, expect, it, vi } from "vitest";
import {
  clearFeishuRunContinuations,
  matchFeishuRunContinuation,
  saveFeishuRunContinuation,
} from "../src/approval/approval-bridge.js";

describe("feishu run continuation store", () => {
  it("matches same run same module same requester same-or-lower risk", () => {
    clearFeishuRunContinuations();
    const now = Date.now();
    saveFeishuRunContinuation({
      runId: "run-1",
      channelProfile: "feishu",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      maxRiskLevel: "L3",
      createdAt: now,
      expiresAt: now + 60_000,
    });

    expect(
      matchFeishuRunContinuation({
        runId: "run-1",
        channelProfile: "feishu",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
      }),
    ).toMatchObject({ runId: "run-1" });

    expect(
      matchFeishuRunContinuation({
        runId: "run-1",
        channelProfile: "feishu",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L3",
      }),
    ).toMatchObject({ runId: "run-1" });
  });

  it("does not match higher risk, different module, different run, or non-feishu", () => {
    clearFeishuRunContinuations();
    const now = Date.now();
    saveFeishuRunContinuation({
      runId: "run-2",
      channelProfile: "feishu",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      maxRiskLevel: "L2",
      createdAt: now,
      expiresAt: now + 60_000,
    });

    expect(
      matchFeishuRunContinuation({
        runId: "run-2",
        channelProfile: "feishu",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L3",
      }),
    ).toBeUndefined();

    expect(
      matchFeishuRunContinuation({
        runId: "run-2",
        channelProfile: "feishu",
        requesterOuId: "ou_owner",
        module: "M3:remote_access_control",
        riskLevel: "L2",
      }),
    ).toBeUndefined();

    expect(
      matchFeishuRunContinuation({
        runId: "run-x",
        channelProfile: "feishu",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
      }),
    ).toBeUndefined();

    expect(
      matchFeishuRunContinuation({
        runId: "run-2",
        channelProfile: "webchat",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
      }),
    ).toBeUndefined();
  });

  it("prunes expired windows", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-17T00:00:00Z"));
      saveFeishuRunContinuation({
        runId: "run-expired",
        channelProfile: "feishu",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        maxRiskLevel: "L3",
        createdAt: Date.now(),
        expiresAt: Date.now() + 1_000,
      });
      vi.setSystemTime(new Date("2026-04-17T00:00:05Z"));

      expect(
        matchFeishuRunContinuation({
          runId: "run-expired",
          channelProfile: "feishu",
          requesterOuId: "ou_owner",
          module: "M2:protected_file_access",
          riskLevel: "L2",
        }),
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
      clearFeishuRunContinuations();
    }
  });

  it("returns defensive copies from match", () => {
    clearFeishuRunContinuations();
    const now = Date.now();
    saveFeishuRunContinuation({
      runId: "run-copy",
      channelProfile: "feishu",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      maxRiskLevel: "L3",
      createdAt: now,
      expiresAt: now + 60_000,
    });

    const first = matchFeishuRunContinuation({
      runId: "run-copy",
      channelProfile: "feishu",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      riskLevel: "L2",
    });
    expect(first).toBeDefined();
    (first as any).module = "M3:remote_access_control";

    const second = matchFeishuRunContinuation({
      runId: "run-copy",
      channelProfile: "feishu",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      riskLevel: "L2",
    });
    expect(second).toMatchObject({ module: "M2:protected_file_access" });
  });
});
