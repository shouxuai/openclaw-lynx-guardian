import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "fs";
import { rmSync } from "fs";
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
  clearLynxDeliveryIntent,
  readLynxDeliveryIntent,
  writeLynxDeliveryIntent,
} from "../src/runtime/lynx-delivery-intent-store.js";
import type { LynxDeliveryIntent } from "../src/runtime/lynx-delivery-intent-store.js";

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

describe("Lynx Delivery Intent Storage", () => {
  it("persists and loads delivery intent via dedicated store module", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lynx-delivery-intent-"));
    const storePath = join(tempDir, "intent.json");
    const intent: LynxDeliveryIntent = {
      id: "intent-1",
      source: "manual",
      trigger: "lynx_command",
      preferredTargetKind: "recent",
      reportPath: "/tmp/report.md",
      createdAtMs: 1712700000000,
    };

    try {
      writeLynxDeliveryIntent(intent, { path: storePath });
      expect(readLynxDeliveryIntent({ path: storePath })).toEqual(intent);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid enum values instead of coercing defaults", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lynx-delivery-intent-invalid-enum-"));
    const storePath = join(tempDir, "intent.json");
    const invalidIntent = {
      id: "intent-invalid-enum",
      source: "manual-ish",
      trigger: "manual_trigger",
      preferredTargetKind: "latest",
      reportPath: "/tmp/report.md",
      createdAtMs: 1712700000000,
    } as any;

    try {
      expect(() => writeLynxDeliveryIntent(invalidIntent, { path: storePath })).toThrow(
        "Invalid LynxDeliveryIntent",
      );
      expect(readLynxDeliveryIntent({ path: storePath })).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects non-finite createdAtMs values", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lynx-delivery-intent-invalid-time-"));
    const storePath = join(tempDir, "intent.json");

    try {
      expect(() =>
        writeLynxDeliveryIntent(
          {
            id: "intent-invalid-nan",
            source: "manual",
            trigger: "lynx_command",
            preferredTargetKind: "recent",
            reportPath: "/tmp/report.md",
            createdAtMs: Number.NaN,
          },
          { path: storePath },
        ),
      ).toThrow("Invalid LynxDeliveryIntent");

      expect(() =>
        writeLynxDeliveryIntent(
          {
            id: "intent-invalid-infinity",
            source: "scheduled",
            trigger: "lynx_command",
            preferredTargetKind: "bound",
            reportPath: "/tmp/report.md",
            createdAtMs: Number.POSITIVE_INFINITY,
          },
          { path: storePath },
        ),
      ).toThrow("Invalid LynxDeliveryIntent");

      expect(readLynxDeliveryIntent({ path: storePath })).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects the removed keyword_request trigger", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lynx-delivery-intent-invalid-trigger-"));
    const storePath = join(tempDir, "intent.json");

    try {
      expect(() =>
        writeLynxDeliveryIntent(
          {
            id: "intent-invalid-trigger",
            source: "manual",
            trigger: "keyword_request" as any,
            preferredTargetKind: "recent",
            reportPath: "/tmp/report.md",
            createdAtMs: 1712700000000,
          },
          { path: storePath },
        ),
      ).toThrow("Invalid LynxDeliveryIntent");

      expect(readLynxDeliveryIntent({ path: storePath })).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("clears a stored delivery intent", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lynx-delivery-intent-clear-"));
    const storePath = join(tempDir, "intent.json");
    const intent: LynxDeliveryIntent = {
      id: "intent-clear-1",
      source: "manual",
      trigger: "lynx_command",
      preferredTargetKind: "recent",
      reportPath: "/tmp/report.md",
      createdAtMs: 1712700000000,
    };

    try {
      writeLynxDeliveryIntent(intent, { path: storePath });
      expect(readLynxDeliveryIntent({ path: storePath })).toEqual(intent);

      clearLynxDeliveryIntent({ path: storePath });
      expect(readLynxDeliveryIntent({ path: storePath })).toBeNull();
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
