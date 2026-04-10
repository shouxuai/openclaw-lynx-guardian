export type LynxCheckTriggerKind =
  | "none"
  | "native_passthrough"
  | "lynx_command"
  | "keyword_request";

export interface LynxCheckTrigger {
  kind: LynxCheckTriggerKind;
  normalizedText: string;
}

const NATIVE_PASSTHROUGH = new Set(["check", "/check"]);
const LYNX_COMMANDS = new Set(["lynx-check", "/lynx-check"]);
const LIKELY_SENDER_PREFIX = /^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+){0,2}$/u;

const ACTION_KEYWORDS = {
  english: ["check", "inspect", "scan", "detect", "verify"],
  cjk: ["检查", "检测", "扫描", "探测", "排查"],
};

const TARGET_KEYWORDS = {
  english: ["openclaw", "lynx"],
  cjk: ["龙虾"],
};

const SIGNAL_KEYWORDS = {
  english: ["service", "process", "gateway", "ip", "port", "address"],
  cjk: ["服务", "进程", "网关", "端口", "地址"],
};

function normalizeRawInput(text: string): string {
  return text.trim().toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasEnglishKeyword(text: string, keywords: string[]): boolean {
  const pattern = keywords.map(escapeRegExp).join("|");
  return new RegExp(`(^|[^a-z0-9-])(?:${pattern})(?=$|[^a-z0-9-])`, "i").test(text);
}

function hasCjkKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function hasKeywordGroup(
  text: string,
  keywords: {
    english: string[];
    cjk: string[];
  },
): boolean {
  return hasEnglishKeyword(text, keywords.english) || hasCjkKeyword(text, keywords.cjk);
}

function isLikelySenderPrefix(prefix: string): boolean {
  const trimmedPrefix = prefix.trim();
  if (!trimmedPrefix) {
    return false;
  }

  if (!LIKELY_SENDER_PREFIX.test(trimmedPrefix)) {
    return false;
  }

  return !hasKeywordGroup(trimmedPrefix, ACTION_KEYWORDS)
    && !hasKeywordGroup(trimmedPrefix, TARGET_KEYWORDS)
    && !hasKeywordGroup(trimmedPrefix, SIGNAL_KEYWORDS);
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

  // Feishu-style sender prefixes should not block exact command matching.
  return suffix;
}

function hasSlashCommand(text: string): boolean {
  return /(^|\s)\/\S+/.test(text);
}

function isKeywordDiscoveryPrompt(normalizedText: string): boolean {
  return hasKeywordGroup(normalizedText, ACTION_KEYWORDS)
    && hasKeywordGroup(normalizedText, TARGET_KEYWORDS)
    && hasKeywordGroup(normalizedText, SIGNAL_KEYWORDS);
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

  if (!hasSlashCommand(rawNormalizedText) && isKeywordDiscoveryPrompt(rawNormalizedText)) {
    return { kind: "keyword_request", normalizedText: rawNormalizedText };
  }

  return { kind: "none", normalizedText: rawNormalizedText };
}
