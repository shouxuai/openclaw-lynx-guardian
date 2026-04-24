import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { afterEach, describe, expect, it } from "vitest";

import { createLocalConsoleApp } from "../src/app.js";

describe("static webview routes", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("serves the frontend bundle and SPA fallback from /webview", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "lynx-console-webview-data-"));
    const frontendDistDir = mkdtempSync(join(tmpdir(), "lynx-console-webview-dist-"));
    cleanupDirs.push(dataDir, frontendDistDir);

    mkdirSync(join(frontendDistDir, "assets"), { recursive: true });
    writeFileSync(
      join(frontendDistDir, "index.html"),
      "<!doctype html><html><body><div id=\"root\"></div></body></html>",
      "utf8",
    );
    writeFileSync(
      join(frontendDistDir, "assets", "app.js"),
      "console.log('lynx console');",
      "utf8",
    );

    const app = await createLocalConsoleApp({
      dataDir,
      databasePath: join(dataDir, "lynx.db"),
      ingestToken: "test-token",
      frontendDistPath: frontendDistDir,
      host: "127.0.0.1",
      port: 31789,
    });

    try {
      const entryResponse = await app.inject({
        method: "GET",
        url: "/webview",
      });
      expect(entryResponse.statusCode).toBe(200);
      expect(entryResponse.headers["content-type"]).toContain("text/html");
      expect(entryResponse.body).toContain("<div id=\"root\"></div>");

      const nestedRouteResponse = await app.inject({
        method: "GET",
        url: "/webview/events",
      });
      expect(nestedRouteResponse.statusCode).toBe(200);
      expect(nestedRouteResponse.body).toContain("<div id=\"root\"></div>");

      const assetResponse = await app.inject({
        method: "GET",
        url: "/webview/assets/app.js",
      });
      expect(assetResponse.statusCode).toBe(200);
      expect(assetResponse.headers["content-type"]).toContain("application/javascript");
      expect(assetResponse.body).toContain("lynx console");
    } finally {
      await app.close();
    }
  });
});
