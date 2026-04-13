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
  });

  it("deep-merges explicit runtime config over manifest defaults", () => {
    const result = resolvePluginRuntimeConfig({
      scheduledLynxCheck: {
        cron: "5 6 * * *",
      },
      managedLynxCheckAuthorization: {
        enabled: false,
      },
      selfSafetyGuard: {
        ownerVerification: {
          trustedUserIds: ["owner-1"],
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
    expect(result.selfSafetyGuard?.ownerVerification).toEqual(
      expect.objectContaining({
        enabled: true,
        trustedUserIds: ["owner-1"],
      }),
    );
  });
});
