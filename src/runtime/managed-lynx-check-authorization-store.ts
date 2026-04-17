import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { assertManagedLynxAuditBoundary } from "./lynx-audit-runtime.js";
import { normalizeString, resolveRuntimeHomeDir } from "./plugin-runtime-helpers.js";

export interface ManagedLynxCheckAuthorization {
  scope: "manual-and-scheduled";
  source: "scheduled-job-create" | "plugin-startup" | "manual-bootstrap";
  grantedAtMs: number;
  grantedByPlugin: true;
}

interface ManagedLynxCheckAuthorizationStoreOptions {
  filePath?: string;
}

function getDefaultAuthorizationPath(): string {
  return join(resolveRuntimeHomeDir(), ".openclaw", "lynx", "managed-lynx-check-authorization.json");
}

function resolveAuthorizationPath(customPath?: string): string {
  const trimmed = normalizeString(customPath);
  if (!trimmed) {
    return getDefaultAuthorizationPath();
  }
  if (trimmed.startsWith("~")) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, resolveRuntimeHomeDir()));
  }
  return resolve(trimmed);
}

function writeAuthorization(
  record: ManagedLynxCheckAuthorization,
  options?: ManagedLynxCheckAuthorizationStoreOptions,
): ManagedLynxCheckAuthorization {
  const filePath = resolveAuthorizationPath(options?.filePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");
  return record;
}

export function readManagedLynxCheckAuthorization(
  options?: ManagedLynxCheckAuthorizationStoreOptions,
): ManagedLynxCheckAuthorization | null {
  const filePath = resolveAuthorizationPath(options?.filePath);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    if (
      record.scope !== "manual-and-scheduled"
      || (
        record.source !== "scheduled-job-create"
        && record.source !== "plugin-startup"
        && record.source !== "manual-bootstrap"
      )
      || typeof record.grantedAtMs !== "number"
      || record.grantedByPlugin !== true
    ) {
      return null;
    }

    return {
      scope: "manual-and-scheduled",
      source: record.source,
      grantedAtMs: record.grantedAtMs,
      grantedByPlugin: true,
    };
  } catch {
    return null;
  }
}

export function grantManagedLynxCheckAuthorization(
  input: {
    scope: "manual-and-scheduled";
    source: ManagedLynxCheckAuthorization["source"];
  },
  options?: ManagedLynxCheckAuthorizationStoreOptions,
): ManagedLynxCheckAuthorization {
  assertManagedLynxAuditBoundary({
    action: "authorize_run",
    target: input.source,
    managed: true,
  });

  return writeAuthorization({
    scope: input.scope,
    source: input.source,
    grantedAtMs: Date.now(),
    grantedByPlugin: true,
  }, options);
}

export function hasManagedLynxCheckAuthorization(
  options?: ManagedLynxCheckAuthorizationStoreOptions,
): boolean {
  return readManagedLynxCheckAuthorization(options)?.grantedByPlugin === true;
}

export function clearManagedLynxCheckAuthorization(
  options?: ManagedLynxCheckAuthorizationStoreOptions,
): void {
  const filePath = resolveAuthorizationPath(options?.filePath);
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
