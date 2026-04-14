export type LynxCheckTriggerKind = "none" | "native_passthrough" | "lynx_command";

export interface LynxCheckTrigger {
  kind: LynxCheckTriggerKind;
  normalizedText: string;
}

const NATIVE_PASSTHROUGH = new Set(["check", "/check"]);
const LYNX_COMMANDS = new Set(["lynx-check", "/lynx-check"]);
const LIKELY_SENDER_PREFIX = /^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+){0,2}$/u;

function normalizeRawInput(text: string): string {
  return text.trim().toLowerCase();
}

function isLikelySenderPrefix(prefix: string): boolean {
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    return false;
  }
  return LIKELY_SENDER_PREFIX.test(trimmedPrefix);
}

function normalizeInput(text: string): string {
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

export function classifyLynxCheckTrigger(text: string): LynxCheckTrigger {
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
