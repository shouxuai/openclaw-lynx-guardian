export type LynxCheckTriggerKind = "none" | "native_passthrough" | "lynx_command";

export interface LynxCheckTrigger {
  kind: LynxCheckTriggerKind;
  normalizedText: string;
}

const NATIVE_PASSTHROUGH = new Set(["/check"]);
const LYNX_COMMANDS = new Set(["/lynx-check"]);
const LIKELY_SENDER_PREFIX = /^[\p{L}\p{N}_-]+$/u;
const DISALLOWED_SENDER_PREFIX_TERMS = new Set([
  "can",
  "check",
  "could",
  "inspect",
  "scan",
  "detect",
  "do",
  "kindly",
  "verify",
  "please",
  "pls",
  "help",
  "would",
  "you",
]);

function normalizeRawInput(text: unknown): string {
  return typeof text === "string" ? text.trim().toLowerCase() : "";
}

function isLikelySenderPrefix(prefix: string): boolean {
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix || !LIKELY_SENDER_PREFIX.test(trimmedPrefix)) {
    return false;
  }

  return !DISALLOWED_SENDER_PREFIX_TERMS.has(trimmedPrefix);
}

function normalizeInput(text: unknown): string {
  const normalized = normalizeRawInput(text);
  if (!normalized || normalized.startsWith("/")) {
    return normalized;
  }

  const colonIdx = normalized.indexOf(": ");
  if (colonIdx < 0) {
    return normalized;
  }

  const prefix = normalized.slice(0, colonIdx);
  const suffix = normalized.slice(colonIdx + 2).trim();
  if (!suffix || !isLikelySenderPrefix(prefix)) {
    return normalized;
  }

  return suffix;
}

export function classifyLynxCheckTrigger(text: unknown): LynxCheckTrigger {
  const rawNormalizedText = normalizeRawInput(text);
  if (!rawNormalizedText) {
    return { kind: "none", normalizedText: rawNormalizedText };
  }

  const normalizedText = normalizeInput(text);
  if (NATIVE_PASSTHROUGH.has(normalizedText)) {
    return { kind: "native_passthrough", normalizedText };
  }

  if (LYNX_COMMANDS.has(normalizedText)) {
    return { kind: "lynx_command", normalizedText };
  }

  return { kind: "none", normalizedText: rawNormalizedText };
}
