import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createLocalConsoleApp } from "../src/app.js";

describe("createLocalConsoleApp", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("serves health and capabilities for the local console backend", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "lynx-console-health-"));
    cleanupDirs.push(dataDir);

    const app = await createLocalConsoleApp({
      dataDir,
      databasePath: join(dataDir, "lynx.db"),
      ingestToken: "test-token",
      host: "127.0.0.1",
      port: 31789,
    });

    try {
      const healthResponse = await app.inject({
        method: "GET",
        url: "/lynx/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json()).toEqual(
        expect.objectContaining({
          ok: true,
          schemaVersion: expect.any(String),
          serverTimeMs: expect.any(Number),
        }),
      );

      const capabilitiesResponse = await app.inject({
        method: "GET",
        url: "/lynx/meta/capabilities",
      });

      expect(capabilitiesResponse.statusCode).toBe(200);
      expect(capabilitiesResponse.json()).toEqual({
        tokenUsageEnabled: false,
        gatewayAuthLogsEnabled: false,
        queryApiVersion: "v1",
      });

      const legacyHealthResponse = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      expect(legacyHealthResponse.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("reflects tokenUsageEnabled when the backend runtime turns the capability on", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "lynx-console-health-token-"));
    cleanupDirs.push(dataDir);

    const app = await createLocalConsoleApp({
      dataDir,
      databasePath: join(dataDir, "lynx.db"),
      ingestToken: "test-token",
      host: "127.0.0.1",
      port: 31789,
      tokenUsageEnabled: true,
    });

    try {
      const capabilitiesResponse = await app.inject({
        method: "GET",
        url: "/lynx/meta/capabilities",
      });

      expect(capabilitiesResponse.statusCode).toBe(200);
      expect(capabilitiesResponse.json()).toEqual({
        tokenUsageEnabled: true,
        gatewayAuthLogsEnabled: false,
        queryApiVersion: "v1",
      });
    } finally {
      await app.close();
    }
  });

  it("allows host-routed docker gateway requests when the gateway ip is trusted", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "lynx-console-health-gateway-"));
    cleanupDirs.push(dataDir);

    const app = await createLocalConsoleApp({
      dataDir,
      databasePath: join(dataDir, "lynx.db"),
      ingestToken: "test-token",
      host: "127.0.0.1",
      port: 31789,
      trustedProxyIps: ["172.20.0.1"],
    } as any);

    try {
      const gatewayResponse = await app.inject({
        method: "GET",
        url: "/lynx/health",
        remoteAddress: "172.20.0.1",
      });

      expect(gatewayResponse.statusCode).toBe(200);

      const blockedResponse = await app.inject({
        method: "GET",
        url: "/lynx/health",
        remoteAddress: "172.20.0.99",
      });

      expect(blockedResponse.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
