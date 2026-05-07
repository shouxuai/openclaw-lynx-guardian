import { existsSync, rmSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createLynxCheckRunIntent,
  getLynxCheckRunReportPath,
  readLynxCheckRunIntent,
  readLynxCheckRunResult,
  writeLynxCheckRunResult,
} from "../src/lynx-check/lynx-check-bridge.js";

describe("lynx check run store", () => {
  const openclawHome = join(process.cwd(), "test-temp", "lynx-check-run-store-home");
  const runStoreRoot = join(openclawHome, ".openclaw", "lynx", "check-runs");

  beforeEach(() => {
    rmSync(openclawHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.stubEnv("HOME", openclawHome);
    vi.stubEnv("USERPROFILE", openclawHome);
  });

  it("creates a manual lynx-check run intent with current-session routing", () => {
    const intent = createLynxCheckRunIntent({
      source: "manual",
      trigger: "lynx_command",
      preferredTargetKind: "current",
      sessionKey: "sess-manual",
      routeHint: {
        targetKey: "webchat:webchat:sender-a",
        sessionKey: "sess-manual",
        channelId: "webchat",
        messageProvider: "webchat",
        senderId: "sender-a",
        updatedAtMs: 1712800000000,
      },
    });

    expect(intent.requestId).toMatch(/^lynx-check-/);
    expect(intent.status).toBe("pending");
    expect(readLynxCheckRunIntent(intent.requestId)).toEqual(intent);
    expect(getLynxCheckRunReportPath(intent.requestId)).toBe(
      join(runStoreRoot, `${intent.requestId}.report.md`),
    );
  });

  it("writes a failed result that preserves the report path for plugin fallback", () => {
    const intent = createLynxCheckRunIntent({
      source: "scheduled",
      trigger: "scheduled_lynx_check",
      preferredTargetKind: "recent",
    });
    const reportPath = getLynxCheckRunReportPath(intent.requestId);

    writeLynxCheckRunResult(intent.requestId, {
      status: "completed",
      sendAttempted: true,
      sendSucceeded: false,
      transport: "skill-send-failed",
      reportPath,
      errorMessage: "webchat send failed",
    });

    expect(existsSync(reportPath)).toBe(false);
    expect(readLynxCheckRunResult(intent.requestId)).toEqual(
      expect.objectContaining({
        requestId: intent.requestId,
        sendSucceeded: false,
        reportPath,
        errorMessage: "webchat send failed",
      }),
    );
  });
});
