import { readdirSync } from "fs";
import { basename, dirname, resolve } from "path";

import type { Logger } from "../types.js";

function hasGoBackendExecutable(backendRoot: string): boolean {
  try {
    return readdirSync(backendRoot).some((entry) => /^lynx-server-(linux|win32|darwin)-/.test(entry));
  } catch {
    return false;
  }
}

function defaultInstallRunner(backendRoot: string): void {
  throw new Error(`lynx-server backend executable is missing in ${backendRoot}`);
}

export function resolveLocalConsoleBackendRoot(entryPath: string): string {
  if (/^lynx-server-(linux|win32|darwin)-/.test(basename(entryPath))) {
    return resolve(dirname(entryPath));
  }
  return resolve(dirname(entryPath));
}

export function hasLocalConsoleBackendRuntimeDeps(backendRoot: string): boolean {
  return hasGoBackendExecutable(backendRoot);
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
    `[lynx-guardian] checking lynx-server backend runtime in ${options.backendRoot}`,
  );

  const installRunner = options.installRunner ?? defaultInstallRunner;
  await installRunner(options.backendRoot);
}
