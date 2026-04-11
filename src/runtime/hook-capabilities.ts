import { readFileSync } from "fs";
import { dirname, join } from "path";
import { createRequire } from "node:module";

export const TESTED_MIN_OPENCLAW_VERSION = "2026.2.26";

function parseVersionPart(value: string): number {
  return Number.parseInt(value, 10) || 0;
}

function parseVersion(version: string): number[] {
  return version.split(".").map(parseVersionPart);
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  const left = parseVersion(version);
  const right = parseVersion(minimum);
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function readOpenClawPackageVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const sdkEntry = require.resolve("openclaw/plugin-sdk");
    const packageJsonPath = join(dirname(sdkEntry), "..", "..", "package.json");
    const rawPackage = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(rawPackage) as { version?: unknown };
    return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function getOpenClawRuntimeVersion(): string | undefined {
  const candidates = [
    process.env.OPENCLAW_VERSION,
    process.env.npm_package_dependencies_openclaw,
    process.env.npm_package_peerDependencies_openclaw,
    readOpenClawPackageVersion(),
  ];

  return candidates.find((candidate) => typeof candidate === "string" && candidate.trim())?.trim();
}

export function getHookCapabilityReport(runtimeVersion?: string): {
  runtimeVersion: string;
  testedMinimumVersion: string;
  supported: boolean | "unknown";
} {
  const normalized = runtimeVersion?.trim();
  if (!normalized) {
    return {
      runtimeVersion: "unknown",
      testedMinimumVersion: TESTED_MIN_OPENCLAW_VERSION,
      supported: "unknown",
    };
  }

  return {
    runtimeVersion: normalized,
    testedMinimumVersion: TESTED_MIN_OPENCLAW_VERSION,
    supported: isVersionAtLeast(normalized, TESTED_MIN_OPENCLAW_VERSION),
  };
}
