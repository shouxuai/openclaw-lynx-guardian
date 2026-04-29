import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  savePendingOverride,
  getPendingOverride,
  consumePendingOverride,
  clearPendingOverride,
} from "../src/runtime/pending-override-store.js";
import type { PendingOverride } from "../src/runtime/pending-override-store.js";
import {
  getRecentActiveDeliveryTarget,
  rememberRecentActiveDeliveryTarget,
  readRecentActiveDeliverySnapshot,
} from "../src/runtime/recent-active-delivery.js";
import {
  createLynxCheckRunIntent,
  getLynxCheckRunReportPath,
  getLynxCheckRunResultPath,
  readLynxCheckRunIntent,
  readLynxCheckRunResult,
  writeLynxCheckRunResult,
} from "../src/lynx-check/lynx-check-bridge.js";

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

describe("Lynx Check Run Artifact Bridge", () => {
  it("persists a manual lynx-check intent as a compatibility artifact", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lynx-check-run-intent-"));

    try {
      const intent = createLynxCheckRunIntent({
        requestId: "lynx-check-artifact-1",
        source: "manual",
        trigger: "lynx_command",
        preferredTargetKind: "current",
        sessionKey: "session-lynx-check",
        createdAtMs: 1712700000000,
      }, { rootDir: tempDir });

      expect(readLynxCheckRunIntent(intent.requestId, { rootDir: tempDir })).toEqual(intent);
      expect(getLynxCheckRunReportPath(intent.requestId, { rootDir: tempDir })).toBe(
        join(tempDir, "lynx-check-artifact-1.report.md"),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid intent enum values instead of coercing legacy delivery defaults", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lynx-check-run-invalid-enum-"));

    try {
      expect(() =>
        createLynxCheckRunIntent({
          requestId: "lynx-check-invalid-enum",
          source: "manual-ish",
          trigger: "manual_trigger",
          preferredTargetKind: "latest",
          createdAtMs: 1712700000000,
        } as any, { rootDir: tempDir }),
      ).toThrow("Invalid LynxCheckRunIntent");
      expect(readLynxCheckRunIntent("lynx-check-invalid-enum", { rootDir: tempDir })).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects the removed keyword_request trigger", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lynx-check-run-invalid-trigger-"));

    try {
      expect(() =>
        createLynxCheckRunIntent({
          requestId: "lynx-check-invalid-trigger",
          source: "manual",
          trigger: "keyword_request",
          preferredTargetKind: "recent",
          createdAtMs: 1712700000000,
        } as any, { rootDir: tempDir }),
      ).toThrow("Invalid LynxCheckRunIntent");

      expect(readLynxCheckRunIntent("lynx-check-invalid-trigger", { rootDir: tempDir })).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("persists completion results while keeping report files as plugin artifacts", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lynx-check-run-result-"));

    try {
      const intent = createLynxCheckRunIntent({
        requestId: "lynx-check-result-1",
        source: "scheduled",
        trigger: "scheduled_lynx_check",
        preferredTargetKind: "recent",
        createdAtMs: 1712700000000,
      }, { rootDir: tempDir });

      const result = writeLynxCheckRunResult(intent.requestId, {
        status: "completed",
        sendAttempted: true,
        sendSucceeded: true,
        transport: "inline-message",
        reportPath: getLynxCheckRunReportPath(intent.requestId, { rootDir: tempDir }),
        completedAtMs: 1712700001000,
      }, { rootDir: tempDir });

      expect(readLynxCheckRunResult(intent.requestId, { rootDir: tempDir })).toEqual(result);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes unsupported result status into an explicit failed artifact", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lynx-check-run-invalid-result-"));
    const resultPath = getLynxCheckRunResultPath("lynx-check-invalid-result", { rootDir: tempDir });

    try {
      writeFileSync(resultPath, JSON.stringify({
        requestId: "lynx-check-invalid-result",
        status: "queued",
        sendAttempted: false,
        sendSucceeded: false,
        transport: "pending",
        completedAtMs: 1712700001000,
      }), "utf8");

      expect(readLynxCheckRunResult("lynx-check-invalid-result", { rootDir: tempDir })).toEqual(
        expect.objectContaining({
          status: "failed",
          errorMessage: "Unsupported run result status: queued",
        }),
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Recent Active Delivery Route Hints", () => {
  it("persists durable route hints including bindingId while keeping live sender in memory", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "recent-active-route-hint-"));
    const hintPath = join(tempDir, "recent-active.json");
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    try {
      const remembered = rememberRecentActiveDeliveryTarget(
        {
          sessionKey: "sess-route-hint",
          channelId: "webchat",
          messageProvider: "webchat",
          senderId: "sender-a",
          bindingId: "binding-123",
          sendMessage,
        } as any,
        { path: hintPath, now: 1712701000000 },
      );

      expect(remembered).toEqual(
        expect.objectContaining({
          targetKey: "sess-route-hint",
          bindingId: "binding-123",
        }),
      );

      expect(readRecentActiveDeliverySnapshot(hintPath)).toEqual(
        expect.objectContaining({
          targetKey: "sess-route-hint",
          bindingId: "binding-123",
        }),
      );

      const resolved = getRecentActiveDeliveryTarget(hintPath);
      expect(resolved?.sendMessage).toBe(sendMessage);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
