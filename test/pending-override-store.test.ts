import { describe, it, expect, vi } from "vitest";
import {
  savePendingOverride,
  getPendingOverride,
  consumePendingOverride,
  clearPendingOverride,
} from "../src/runtime/pending-override-store.js";
import type { PendingOverride } from "../src/runtime/pending-override-store.js";

function buildOverride(overrides: Partial<PendingOverride> = {}): PendingOverride {
  const now = Date.now();
  return {
    operationFingerprint: "op-1",
    createdAt: now,
    expiresAt: now + 60_000,
    actionType: "input",
    replayPayload: { text: "payload" },
    riskScore: 7,
    riskLevel: "L3",
    matchedModules: ["M3:over_agency"],
    ...overrides,
  };
}

describe("Pending Override Store", () => {
  it("stores one pending override per session", () => {
    const sessionKey = "session-store";
    const first = buildOverride({ operationFingerprint: "op-first" });
    const second = buildOverride({ operationFingerprint: "op-second" });

    savePendingOverride(sessionKey, first);
    savePendingOverride(sessionKey, second);

    const result = getPendingOverride(sessionKey);
    expect(result).toEqual(second);
  });

  it("consumes overrides exactly once", () => {
    const sessionKey = "session-consume";
    const override = buildOverride({ operationFingerprint: "op-consume" });

    savePendingOverride(sessionKey, override);

    const firstRead = consumePendingOverride(sessionKey);
    const secondRead = consumePendingOverride(sessionKey);

    expect(firstRead).toEqual(override);
    expect(secondRead).toBeUndefined();
  });

  it("drops expired entries", () => {
    const sessionKey = "session-expired";
    const override = buildOverride({
      operationFingerprint: "op-expired",
      createdAt: Date.now() - 10_000,
      expiresAt: Date.now() - 1,
    });

    savePendingOverride(sessionKey, override);

    const result = getPendingOverride(sessionKey);
    expect(result).toBeUndefined();
  });

  it("returns pending override without consuming", () => {
    const sessionKey = "session-get";
    const override = buildOverride({ operationFingerprint: "op-get" });

    savePendingOverride(sessionKey, override);

    const firstRead = getPendingOverride(sessionKey);
    const secondRead = consumePendingOverride(sessionKey);

    expect(firstRead).toEqual(override);
    expect(secondRead).toEqual(override);
  });

  it("clears pending override", () => {
    const sessionKey = "session-clear";
    const override = buildOverride({ operationFingerprint: "op-clear" });

    savePendingOverride(sessionKey, override);
    clearPendingOverride(sessionKey);

    expect(getPendingOverride(sessionKey)).toBeUndefined();
  });

  it("prunes expired entries on later access", () => {
    vi.useFakeTimers();
    const baseTime = new Date("2026-03-01T00:00:00Z").getTime();
    const expiredSessionKey = "session-expired-later";
    const activeSessionKey = "session-active-later";
    try {
      vi.setSystemTime(baseTime);
      savePendingOverride(
        expiredSessionKey,
        buildOverride({
          operationFingerprint: "op-expire-later",
          createdAt: baseTime,
          expiresAt: baseTime + 1_000,
        }),
      );

      vi.setSystemTime(baseTime + 2_000);
      savePendingOverride(
        activeSessionKey,
        buildOverride({
          operationFingerprint: "op-active",
          createdAt: baseTime + 2_000,
          expiresAt: baseTime + 3_000,
        }),
      );

      vi.setSystemTime(baseTime + 500);
      expect(getPendingOverride(expiredSessionKey)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
