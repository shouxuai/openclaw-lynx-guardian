import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { normalizeString, resolveRuntimeHomeDir } from "./plugin-runtime-helpers.js";

export interface LynxDeliveryIntent {
  id: string;
  source: "manual" | "scheduled";
  trigger: "lynx_command" | "keyword_request";
  preferredTargetKind: "current" | "bound" | "recent";
  reportPath: string;
  createdAtMs: number;
}

function getDefaultLynxDeliveryIntentPath(): string {
  return join(resolveRuntimeHomeDir(), ".openclaw", "lynx", "delivery-intent.json");
}

function resolveLynxDeliveryIntentPath(customPath?: string): string {
  const trimmed = normalizeString(customPath);
  if (!trimmed) {
    return getDefaultLynxDeliveryIntentPath();
  }

  if (trimmed.startsWith("~")) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, resolveRuntimeHomeDir()));
  }

  return resolve(trimmed);
}

function normalizeIntent(input: unknown): LynxDeliveryIntent | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const parsed = input as Record<string, unknown>;
  const source = parsed.source;
  const trigger = parsed.trigger;
  const preferredTargetKind = parsed.preferredTargetKind;
  const createdAtMs = parsed.createdAtMs;

  if (source !== "manual" && source !== "scheduled") {
    return null;
  }

  if (trigger !== "lynx_command" && trigger !== "keyword_request") {
    return null;
  }

  if (preferredTargetKind !== "current" && preferredTargetKind !== "bound" && preferredTargetKind !== "recent") {
    return null;
  }

  const intent: LynxDeliveryIntent = {
    id: normalizeString(parsed.id),
    source,
    trigger,
    preferredTargetKind,
    reportPath: normalizeString(parsed.reportPath),
    createdAtMs: typeof createdAtMs === "number" && Number.isFinite(createdAtMs) ? createdAtMs : 0,
  };

  if (!intent.id || !intent.reportPath || intent.createdAtMs <= 0) {
    return null;
  }

  return intent;
}

export function writeLynxDeliveryIntent(
  intent: LynxDeliveryIntent,
  options?: { path?: string },
): LynxDeliveryIntent {
  const normalized = normalizeIntent(intent);
  if (!normalized) {
    throw new Error("Invalid LynxDeliveryIntent");
  }

  const filePath = resolveLynxDeliveryIntentPath(options?.path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(normalized), "utf8");
  return normalized;
}

export function readLynxDeliveryIntent(options?: { path?: string }): LynxDeliveryIntent | null {
  const filePath = resolveLynxDeliveryIntentPath(options?.path);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    if (!raw) {
      return null;
    }

    return normalizeIntent(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearLynxDeliveryIntent(options?: { path?: string }): void {
  const filePath = resolveLynxDeliveryIntentPath(options?.path);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
