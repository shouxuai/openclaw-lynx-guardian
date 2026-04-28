import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureLynxCheckTaskControlPlane,
  createLynxCheckRunIntent,
  updateLynxCheckRunIntentStatus,
  writeLynxCheckRunResult,
} from "../src/runtime/lynx-check-run-store.js";

function makeRootDir(): string {
  return mkdtempSync(join(tmpdir(), "lynx-check-task-bridge-"));
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("lynx check task bridge", () => {
  afterEach(() => {
    configureLynxCheckTaskControlPlane();
  });

  it("starts a Go task when the local compatibility intent is created", async () => {
    const rootDir = makeRootDir();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "created" }), { status: 200 }));
    configureLynxCheckTaskControlPlane({
      baseUrl: "http://127.0.0.1:18789/",
      getToken: () => "token-1",
      fetchImpl,
    });

    try {
      createLynxCheckRunIntent({
        requestId: "manual-bridge-1",
        source: "manual",
        trigger: "lynx_command",
        preferredTargetKind: "current",
        sessionKey: "session-1",
        routeHint: {
          targetKey: "target-1",
          updatedAtMs: 1,
        },
      }, { rootDir });
      await flushMicrotasks();

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("http://127.0.0.1:18789/lynx/internal/v1/tasks/lynx-check/start");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer token-1",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        requestId: "manual-bridge-1",
        trigger: "manual",
        source: "lynx_command",
        sessionKey: "session-1",
        targetKey: "target-1",
      });
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("sends status and delivery result events to the Go task plane", async () => {
    const rootDir = makeRootDir();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    configureLynxCheckTaskControlPlane({
      baseUrl: "http://127.0.0.1:18789",
      fetchImpl,
    });

    try {
      createLynxCheckRunIntent({
        requestId: "delivery-bridge-1",
        source: "scheduled",
        trigger: "scheduled_lynx_check",
        preferredTargetKind: "recent",
      }, { rootDir });
      updateLynxCheckRunIntentStatus("delivery-bridge-1", "running", { rootDir });
      writeLynxCheckRunResult("delivery-bridge-1", {
        status: "completed",
        sendAttempted: true,
        sendSucceeded: true,
        transport: "feishu",
        deliveryAttempts: [{
          targetKey: "target-2",
          delivered: true,
          transport: "ctx-sendMessage",
        }],
      }, { rootDir });
      await flushMicrotasks();

      expect(fetchImpl).toHaveBeenCalledTimes(3);
      expect(fetchImpl.mock.calls[1][0]).toBe("http://127.0.0.1:18789/lynx/internal/v1/tasks/lynx-check/delivery-bridge-1/event");
      expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({
        status: "collecting",
      });
      expect(JSON.parse(String(fetchImpl.mock.calls[2][1]?.body))).toMatchObject({
        status: "completed",
        deliveryChannel: "feishu",
        deliveryStatus: "sent",
      });
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
