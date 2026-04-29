import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { mkdtempSync } from "fs";
import { describe, expect, it } from "vitest";

import { buildInstallLocalConsoleRuntimeDepsShellCommand } from "../scripts/dev-sync-lib.mjs";
import {
  buildLynxServerExecutableName,
  resolveLocalConsoleBackendEntryPath,
} from "../src/runtime/local-console-launch.js";
import {
  hasLocalConsoleBackendRuntimeDeps,
} from "../src/runtime/local-console-runtime-deps.js";

describe("Lynx server backend packaging and launch", () => {
  it("uses platform-specific lynx-server executable names", () => {
    expect(buildLynxServerExecutableName("linux", "x64")).toBe("lynx-server-linux-x64");
    expect(buildLynxServerExecutableName("win32", "x64")).toBe("lynx-server-win32-x64.exe");
  });

  it("resolves the packaged Go backend", () => {
    const root = mkdtempSync(join(tmpdir(), "lynx-go-launch-"));
    const runtimeDir = join(root, "src", "runtime");
    const backendGoDir = join(root, "server", "backend");
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(backendGoDir, { recursive: true });

    const goEntry = join(backendGoDir, buildLynxServerExecutableName("linux", "x64"));
    writeFileSync(goEntry, "", "utf8");

    const resolved = resolveLocalConsoleBackendEntryPath(
      pathToFileURL(join(runtimeDir, "local-console-launch.js")).href,
      { platform: "linux", arch: "x64" },
    );

    expect(resolved).toBe(goEntry);
  });

  it("does not fall back to the old Fastify backend entry", () => {
    const root = mkdtempSync(join(tmpdir(), "lynx-go-no-fastify-"));
    const runtimeDir = join(root, "src", "runtime");
    const oldBackendDir = join(root, "server", "backend", "dist");
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(oldBackendDir, { recursive: true });
    writeFileSync(join(oldBackendDir, "main.js"), "", "utf8");

    const resolved = resolveLocalConsoleBackendEntryPath(
      pathToFileURL(join(runtimeDir, "local-console-launch.js")).href,
      { platform: "linux", arch: "x64" },
    );

    expect(resolved).toContain("backend");
    expect(resolved).not.toContain("backend/dist/main.js");
  });

  it("treats a packaged Go backend as self-contained runtime dependencies", () => {
    const backendRoot = mkdtempSync(join(tmpdir(), "lynx-go-runtime-deps-"));
    writeFileSync(join(backendRoot, "lynx-server-linux-x64"), "", "utf8");

    expect(hasLocalConsoleBackendRuntimeDeps(backendRoot)).toBe(true);
  });

  it("skips container npm install when the Go backend package is present", () => {
    const command = buildInstallLocalConsoleRuntimeDepsShellCommand({
      containerPluginPath: "/app/extensions/openclaw-lynx-guardian",
    });

    expect(command).toContain("/app/extensions/openclaw-lynx-guardian/server/backend");
    expect(command).toContain("lynx-server backend present; skip runtime dependency install");
    expect(command).not.toContain("npm ci");
  });
});
