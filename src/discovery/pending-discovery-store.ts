import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import { isManualDiscoveryRequest } from "./discovery-hook-utils.js";

export type PendingDiscoveryRequest = {
  sessionKey?: string;
  userInput: string;
};

export function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function writePendingDiscoveryRequest(filePath: string, request: PendingDiscoveryRequest): void {
  ensureParentDirectory(filePath);
  writeFileSync(filePath, JSON.stringify(request), "utf8");
}

export function readPendingDiscoveryRequest(filePath: string): PendingDiscoveryRequest | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.userInput !== "string") {
      return null;
    }

    return {
      sessionKey: typeof parsed.sessionKey === "string" ? parsed.sessionKey : undefined,
      userInput: parsed.userInput,
    };
  } catch {
    return null;
  }
}

export function clearPendingDiscoveryRequest(filePath: string): void {
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

export function shouldAttachPendingDiscoveryReport(filePath: string, currentSessionKey?: string): boolean {
  const pendingRequest = readPendingDiscoveryRequest(filePath);
  if (!pendingRequest || !isManualDiscoveryRequest(pendingRequest.userInput)) {
    return false;
  }

  if (pendingRequest.sessionKey || currentSessionKey) {
    return pendingRequest.sessionKey === currentSessionKey;
  }

  return true;
}
