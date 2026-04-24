import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";

import type { Logger } from "../types.js";

const REQUIRED_RUNTIME_PACKAGES = [
  "@fastify/static",
  "better-sqlite3",
  "fastify",
  "zod",
];

function packagePathSegments(packageName: string): string[] {
  return packageName.split("/");
}

function hasInstalledPackage(backendRoot: string, packageName: string): boolean {
  return existsSync(
    join(backendRoot, "node_modules", ...packagePathSegments(packageName), "package.json"),
  );
}

function defaultInstallRunner(backendRoot: string): void {
  const packageJsonPath = join(backendRoot, "package.json");
  const packageLockPath = join(backendRoot, "package-lock.json");
  if (!existsSync(packageJsonPath)) {
    throw new Error(`local console backend package.json is missing: ${packageJsonPath}`);
  }
  if (!existsSync(packageLockPath)) {
    throw new Error(`local console backend package-lock.json is missing: ${packageLockPath}`);
  }

  const result = spawnSync("npm", ["ci", "--omit=dev"], {
    cwd: backendRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if ((result.status ?? 1) !== 0) {
    throw new Error(`npm ci --omit=dev failed in ${backendRoot}`);
  }
}

export function resolveLocalConsoleBackendRoot(entryPath: string): string {
  return resolve(dirname(entryPath), "..");
}

export function hasLocalConsoleBackendRuntimeDeps(backendRoot: string): boolean {
  return REQUIRED_RUNTIME_PACKAGES.every((packageName) => hasInstalledPackage(backendRoot, packageName));
}

export async function ensureLocalConsoleBackendRuntimeDeps(options: {
  backendRoot: string;
  installRunner?: (backendRoot: string) => void | Promise<void>;
  logger: Pick<Logger, "info">;
}): Promise<void> {
  if (hasLocalConsoleBackendRuntimeDeps(options.backendRoot)) {
    return;
  }

  options.logger.info(
    `[lynx-guardian] installing local console backend runtime dependencies in ${options.backendRoot}`,
  );

  const installRunner = options.installRunner ?? defaultInstallRunner;
  await installRunner(options.backendRoot);
}
