import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  TESTED_MIN_OPENCLAW_VERSION,
  getHookCapabilityReport,
  getOpenClawRuntimeVersion,
  isVersionAtLeast,
} from "../src/runtime/hook-capabilities.js";

describe("hook capabilities", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not depend on the Node module builtin package", () => {
    const source = readFileSync(
      new URL("../src/runtime/hook-capabilities.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain('from "module"');
  });

  it("compares runtime versions against the tested minimum", () => {
    expect(isVersionAtLeast("2026.3.13", TESTED_MIN_OPENCLAW_VERSION)).toBe(true);
    expect(isVersionAtLeast("2026.2.25", TESTED_MIN_OPENCLAW_VERSION)).toBe(false);
  });

  it("prefers explicit OPENCLAW_VERSION from the environment", () => {
    vi.stubEnv("OPENCLAW_VERSION", "2026.3.13");

    expect(getOpenClawRuntimeVersion()).toBe("2026.3.13");
  });

  it("uses OPENCLAW_SERVICE_VERSION when the runtime injects a service version", () => {
    vi.stubEnv("OPENCLAW_VERSION", "");
    vi.stubEnv("OPENCLAW_SERVICE_VERSION", "2026.4.1");

    expect(getOpenClawRuntimeVersion()).toBe("2026.4.1");
  });

  it("falls back to the runtime package root when plugin-local self resolution is unavailable", () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "lynx-hook-capabilities-"));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(runtimeRoot);
    const previousOpenClawVersion = process.env.OPENCLAW_VERSION;
    const previousDependencyVersion = process.env.npm_package_dependencies_openclaw;
    const previousPeerDependencyVersion = process.env.npm_package_peerDependencies_openclaw;

    try {
      delete process.env.OPENCLAW_VERSION;
      delete process.env.npm_package_dependencies_openclaw;
      delete process.env.npm_package_peerDependencies_openclaw;

      mkdirSync(join(runtimeRoot, "node_modules", "openclaw", "dist"), {
        recursive: true,
      });
      writeFileSync(
        join(runtimeRoot, "package.json"),
        JSON.stringify({ name: "runtime-host", private: true }),
        "utf8",
      );
      writeFileSync(
        join(runtimeRoot, "node_modules", "openclaw", "package.json"),
        JSON.stringify({
          name: "openclaw",
          version: "2026.4.1",
          type: "module",
          main: "dist/index.js",
          exports: {
            ".": "./dist/index.js",
          },
        }),
        "utf8",
      );
      writeFileSync(
        join(runtimeRoot, "node_modules", "openclaw", "dist", "index.js"),
        "export {};",
        "utf8",
      );

      expect(getOpenClawRuntimeVersion()).toBe("2026.4.1");
    } finally {
      cwdSpy.mockRestore();
      if (previousOpenClawVersion === undefined) delete process.env.OPENCLAW_VERSION;
      else process.env.OPENCLAW_VERSION = previousOpenClawVersion;
      if (previousDependencyVersion === undefined) delete process.env.npm_package_dependencies_openclaw;
      else process.env.npm_package_dependencies_openclaw = previousDependencyVersion;
      if (previousPeerDependencyVersion === undefined) delete process.env.npm_package_peerDependencies_openclaw;
      else process.env.npm_package_peerDependencies_openclaw = previousPeerDependencyVersion;
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it("can derive the runtime version from the process entrypoint when cwd is only the OpenClaw home", () => {
    const runtimeHome = mkdtempSync(join(tmpdir(), "lynx-openclaw-home-"));
    const runtimeInstallRoot = mkdtempSync(join(tmpdir(), "lynx-openclaw-install-"));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(runtimeHome);
    const previousArgv1 = process.argv[1];
    const previousOpenClawVersion = process.env.OPENCLAW_VERSION;
    const previousDependencyVersion = process.env.npm_package_dependencies_openclaw;
    const previousPeerDependencyVersion = process.env.npm_package_peerDependencies_openclaw;

    try {
      delete process.env.OPENCLAW_VERSION;
      delete process.env.npm_package_dependencies_openclaw;
      delete process.env.npm_package_peerDependencies_openclaw;

      mkdirSync(join(runtimeInstallRoot, "node_modules", "openclaw"), {
        recursive: true,
      });
      writeFileSync(
        join(runtimeInstallRoot, "node_modules", "openclaw", "package.json"),
        JSON.stringify({
          name: "openclaw",
          version: "2026.3.13",
          type: "module",
        }),
        "utf8",
      );
      writeFileSync(
        join(runtimeInstallRoot, "node_modules", "openclaw", "openclaw.mjs"),
        "export {};",
        "utf8",
      );
      process.argv[1] = join(
        runtimeInstallRoot,
        "node_modules",
        "openclaw",
        "openclaw.mjs",
      );

      expect(getOpenClawRuntimeVersion()).toBe("2026.3.13");
    } finally {
      cwdSpy.mockRestore();
      process.argv[1] = previousArgv1;
      if (previousOpenClawVersion === undefined) delete process.env.OPENCLAW_VERSION;
      else process.env.OPENCLAW_VERSION = previousOpenClawVersion;
      if (previousDependencyVersion === undefined) delete process.env.npm_package_dependencies_openclaw;
      else process.env.npm_package_dependencies_openclaw = previousDependencyVersion;
      if (previousPeerDependencyVersion === undefined) delete process.env.npm_package_peerDependencies_openclaw;
      else process.env.npm_package_peerDependencies_openclaw = previousPeerDependencyVersion;
      rmSync(runtimeHome, { recursive: true, force: true });
      rmSync(runtimeInstallRoot, { recursive: true, force: true });
    }
  });

  it("reports unknown support when runtime version is unavailable", () => {
    expect(getHookCapabilityReport()).toEqual({
      runtimeVersion: "unknown",
      testedMinimumVersion: TESTED_MIN_OPENCLAW_VERSION,
      supported: "unknown",
    });
  });
});
