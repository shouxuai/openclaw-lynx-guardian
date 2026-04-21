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

function normalizeVersionCandidate(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return /^\d+(?:\.\d+)+$/.test(normalized) ? normalized : undefined;
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

function readVersionFromPackageJson(packageJsonPath: string): string | undefined {
  try {
    const rawPackage = readFileSync(packageJsonPath, "utf8");
    const parsed = JSON.parse(rawPackage) as { version?: unknown };
    return normalizeVersionCandidate(parsed.version);
  } catch {
    return undefined;
  }
}

function readRuntimeOpenClawPackageVersion(): string | undefined {
  try {
    const runtimeRequire = createRequire(join(process.cwd(), "package.json"));
    const openClawEntry = runtimeRequire.resolve("openclaw");
    const packageJsonPath = join(dirname(openClawEntry), "..", "package.json");
    return readVersionFromPackageJson(packageJsonPath);
  } catch {
    return undefined;
  }
}

function readEntrypointOpenClawPackageVersion(): string | undefined {
  const entryCandidates = [
    process.argv[1],
    process.argv[0],
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const entry of entryCandidates) {
    const packageCandidates = [
      join(dirname(entry), "package.json"),
      join(dirname(entry), "..", "package.json"),
    ];

    for (const packageJsonPath of packageCandidates) {
      const version = readVersionFromPackageJson(packageJsonPath);
      if (version) {
        return version;
      }
    }
  }

  return undefined;
}

function readPluginLocalOpenClawPackageVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const sdkEntry = require.resolve("openclaw/plugin-sdk");
    const packageJsonPath = join(dirname(sdkEntry), "..", "..", "package.json");
    return readVersionFromPackageJson(packageJsonPath);
  } catch {
    return undefined;
  }
}

export function getOpenClawRuntimeVersion(): string | undefined {
  const candidates = [
    normalizeVersionCandidate(process.env.OPENCLAW_VERSION),
    normalizeVersionCandidate(process.env.OPENCLAW_SERVICE_VERSION),
    readEntrypointOpenClawPackageVersion(),
    readRuntimeOpenClawPackageVersion(),
    normalizeVersionCandidate(process.env.npm_package_dependencies_openclaw),
    normalizeVersionCandidate(process.env.npm_package_peerDependencies_openclaw),
    readPluginLocalOpenClawPackageVersion(),
  ];

  return candidates.find((candidate) => candidate !== undefined);
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
