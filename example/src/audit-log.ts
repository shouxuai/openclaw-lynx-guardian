/**
 * Audit Log — SHA-256 hash-chain append-only trail.
 * Only logs blacklist-matched operations (not every tool call).
 */

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { BlacklistMatch } from "./blacklist.js";

export type AuditEntry = {
  timestamp: string;
  toolName: string;
  blacklistLevel: string;
  blacklistReason: string;
  pattern: string;
  userConfirmed: boolean;
  finalReason: string;
  hash: string;
  prevHash: string;
};

let lastHash = "";
let logPath = "";

function getLogPath(): string {
  if (logPath) return logPath;
  logPath = join(homedir(), ".openclaw", "guardian-audit.jsonl");
  return logPath;
}

function computeHash(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function recoverLastHash(path: string): string {
  try {
    if (!existsSync(path)) return "";
    const content = readFileSync(path, "utf-8").trim();
    if (!content) return "";
    const lines = content.split("\n");
    const lastLine = lines[lines.length - 1];
    const entry = JSON.parse(lastLine) as AuditEntry;
    return entry.hash ?? "";
  } catch {
    return "";
  }
}

export function initAuditLog(): void {
  const path = getLogPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  lastHash = recoverLastHash(path);
}

export function writeAuditEntry(
  toolName: string,
  params: Record<string, unknown>,
  match: BlacklistMatch,
  userConfirmed: boolean,
  reason: string,
): void {
  const entry: Omit<AuditEntry, "hash"> & { hash?: string } = {
    timestamp: new Date().toISOString(),
    toolName,
    blacklistLevel: match.level,
    blacklistReason: match.reason,
    pattern: match.pattern,
    userConfirmed,
    finalReason: reason,
    prevHash: lastHash,
  };

  const hashInput = JSON.stringify(entry);
  entry.hash = computeHash(hashInput);
  lastHash = entry.hash;

  try {
    appendFileSync(getLogPath(), JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    console.error(`[guardian] audit write failed: ${err}`);
  }
}
