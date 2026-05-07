import { describe, expect, it } from "vitest";

import { resolvePluginRuntimeConfig } from "../src/runtime/plugin-runtime-config.js";

describe("resolvePluginRuntimeConfig", () => {
  it("loads defaults from openclaw.plugin.json when runtime config is missing", () => {
    const result = resolvePluginRuntimeConfig(undefined);

    expect(result.enabled).toBe(true);
    expect(result.selfSafetyGuard).toEqual(
      expect.objectContaining({
        enabled: true,
        inputGuard: true,
        outputGuard: true,
        resultGuard: true,
        toolGuard: true,
      }),
    );
    expect(result.securityAudit).toEqual(
      expect.objectContaining({
        enabled: true,
        runOnStartup: true,
        severity: "low",
      }),
    );
    expect(result.scheduledLynxCheck).toEqual(
      expect.objectContaining({
        enabled: true,
        cron: "37 8 * * *",
        jobName: "Lynx Guardian Daily Check",
        announce: true,
        deliveryMode: "recent-active",
      }),
    );
    expect((result.scheduledLynxCheck as any).autoGrantManagedAuthorization).toBe(true);
    expect(result.managedLynxCheckAuthorization).toEqual(
      expect.objectContaining({
        enabled: true,
        autoGrantOnScheduledJobCreate: true,
        treatManualLynxCheckAsPreauthorized: true,
      }),
    );
    expect((result as any).localConsole).toEqual(
      expect.objectContaining({
        enabled: true,
        autoStart: true,
        host: "127.0.0.1",
        port: 31789,
        dataDir: "%USERPROFILE%\\.openclaw\\lynx\\data",
        requestTimeoutMs: 1500,
        flushIntervalMs: 1000,
        maxBatchItems: 50,
        maxQueueItems: 500,
      }),
    );
  });

  it("deep-merges explicit runtime config over manifest defaults", () => {
    const result = resolvePluginRuntimeConfig({
      scheduledLynxCheck: {
        cron: "5 6 * * *",
      },
      managedLynxCheckAuthorization: {
        enabled: false,
      },
      localConsole: {
        port: 18791,
        maxBatchItems: 10,
      },
      selfSafetyGuard: {
        ownerVerification: {
          trustedUserIds: ["owner-1"],
        },
        policy: {
          localApprovalApproverOuIds: ["ou_owner"],
        },
      },
    });

    expect(result.scheduledLynxCheck).toEqual(
      expect.objectContaining({
        enabled: true,
        cron: "5 6 * * *",
        jobName: "Lynx Guardian Daily Check",
        announce: true,
      }),
    );
    expect(result.managedLynxCheckAuthorization).toEqual(
      expect.objectContaining({
        enabled: false,
        autoGrantOnScheduledJobCreate: true,
        treatManualLynxCheckAsPreauthorized: true,
      }),
    );
    expect((result as any).localConsole).toEqual(
      expect.objectContaining({
        enabled: true,
        autoStart: true,
        host: "127.0.0.1",
        port: 18791,
        dataDir: "%USERPROFILE%\\.openclaw\\lynx\\data",
        requestTimeoutMs: 1500,
        flushIntervalMs: 1000,
        maxBatchItems: 10,
        maxQueueItems: 500,
      }),
    );
    expect(result.selfSafetyGuard?.ownerVerification).toEqual(
      expect.objectContaining({
        enabled: true,
        trustedUserIds: ["owner-1"],
      }),
    );
    expect(result.selfSafetyGuard?.policy).toEqual(
      expect.objectContaining({
        localApprovalApproverOuIds: ["ou_owner"],
      }),
    );
  });
});
