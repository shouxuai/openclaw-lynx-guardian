import { homedir } from "os";
import { normalize, resolve } from "path";
import type { GuardContext } from "../guard/safety-guard.js";

export function canonicalizePath(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    return "";
  }
  if (raw.startsWith("~/")) {
    raw = raw.replace("~", process.env.HOME ?? process.env.USERPROFILE ?? "/root");
  }
  return normalize(resolve(raw));
}

export function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => normalizeString(item)).filter(Boolean)
    : [];
}

export function resolveRuntimeHomeDir(): string {
  const envHome = normalizeString(process.env.HOME) || normalizeString(process.env.USERPROFILE);
  if (envHome) {
    return envHome;
  }

  const homeDrive = normalizeString(process.env.HOMEDRIVE);
  const homePath = normalizeString(process.env.HOMEPATH);
  if (homeDrive && homePath) {
    return `${homeDrive}${homePath}`;
  }

  return homedir();
}

const TRUSTED_INTERNAL_PROTECTED_READ_PATTERNS = [
  /[\\/]openclaw[\\/]skills[\\/]healthcheck[\\/]SKILL\.md$/i,
  /[\\/]\.openclaw[\\/]workspace[\\/]memory[\\/]\d{4}-\d{2}-\d{2}\.md$/i,
];

const TRUSTED_MANAGED_LYNX_CHECK_PROTECTED_READ_PATTERNS = [
  /[\\/]\.openclaw[\\/]openclaw\.json$/i,
];

const TRUSTED_MANAGED_LYNX_CHECK_REPORT_PATTERNS = [
  /#\s*🛡️\s*OpenClaw 全方位安全审计报告/m,
  /执行摘要/m,
  /优先级整改建议/m,
];

function isTrustedInternalProtectedRead(event: any, ctx: any): boolean {
  const toolName = normalizeString(event?.toolName).toLowerCase();
  if (toolName !== "read") {
    return false;
  }

  const rawPath = normalizeString(event?.params?.file_path ?? event?.params?.path);
  if (!rawPath) {
    return false;
  }

  const canonicalPath = canonicalizePath(rawPath);
  const isManagedLynxCheckRun = ctx?.managedLynxCheckRun === true;
  if (
    isManagedLynxCheckRun
    && TRUSTED_MANAGED_LYNX_CHECK_PROTECTED_READ_PATTERNS.some((pattern) => pattern.test(canonicalPath))
  ) {
    return true;
  }

  const subsystem = normalizeString(ctx?.subsystem).toLowerCase();
  if (subsystem !== "plugins") {
    return false;
  }

  return TRUSTED_INTERNAL_PROTECTED_READ_PATTERNS.some((pattern) => pattern.test(canonicalPath));
}

function isTrustedManagedLynxCheckToolCall(event: any, ctx: any): boolean {
  if (ctx?.managedLynxCheckRun !== true) {
    return false;
  }

  const toolName = normalizeString(event?.toolName).toLowerCase();
  if (toolName !== "read") {
    return false;
  }

  const rawPath = normalizeString(event?.params?.file_path ?? event?.params?.path);
  if (!rawPath) {
    return false;
  }

  const canonicalPath = canonicalizePath(rawPath);
  return TRUSTED_MANAGED_LYNX_CHECK_PROTECTED_READ_PATTERNS.some((pattern) => pattern.test(canonicalPath));
}

function extractGuardText(event: any): string {
  if (typeof event === "string") {
    return event;
  }

  if (typeof event?.content === "string") {
    return event.content;
  }

  if (typeof event?.output === "string") {
    return event.output;
  }

  if (event?.message) {
    return extractMessageText(event.message);
  }

  if (Array.isArray(event?.messages) && event.messages.length > 0) {
    return extractMessageText(event.messages[event.messages.length - 1]);
  }

  return "";
}

export function isTrustedManagedLynxCheckReportText(value: unknown): boolean {
  const text = typeof value === "string" ? value : extractGuardText(value);
  if (!text) {
    return false;
  }

  return TRUSTED_MANAGED_LYNX_CHECK_REPORT_PATTERNS.every((pattern) => pattern.test(text));
}

export function buildGuardContext(config: any, event: any, ctx: any): GuardContext {
  const ownerVerification = config?.selfSafetyGuard?.ownerVerification ?? {};
  const requesterId = normalizeString(
    event?.sender?.id
    ?? event?.userId
    ?? ctx?.userId
    ?? ctx?.senderId,
  );
  const channel = normalizeString(
    event?.channel
    ?? event?.source
    ?? ctx?.channel
    ?? ctx?.source,
  );

  const trustedUserIds = new Set(
    normalizeStringList(ownerVerification.trustedUserIds).map((item) => item.toLowerCase()),
  );
  const trustedChannels = new Set(
    normalizeStringList(ownerVerification.trustedChannels).map((item) => item.toLowerCase()),
  );

  const verifiedOwner = ownerVerification.enabled === false
    ? false
    : event?.verifiedOwner === true
    || ctx?.verifiedOwner === true
    || (requesterId.length > 0 && trustedUserIds.has(requesterId.toLowerCase()))
    || (channel.length > 0 && trustedChannels.has(channel.toLowerCase()));

  return {
    verifiedOwner,
    requesterId,
    channel,
    trustedInternalProtectedRead: isTrustedInternalProtectedRead(event, ctx),
    trustedManagedLynxCheckToolCall: isTrustedManagedLynxCheckToolCall(event, ctx),
    trustedManagedLynxCheckOutput: ctx?.managedLynxCheckRun === true && isTrustedManagedLynxCheckReportText(event),
    trustedManagedLynxCheckPersistence: ctx?.managedLynxCheckRun === true && isTrustedManagedLynxCheckReportText(event),
  };
}

export function redactAgentOutput(event: any, replacement: string): void {
  if (!event) {
    return;
  }
  if (typeof event.output === "string") {
    event.output = replacement;
  }

  if (!Array.isArray(event.messages) || event.messages.length === 0) {
    return;
  }

  const lastMessage = event.messages[event.messages.length - 1];
  if (!lastMessage) {
    return;
  }

  if (typeof lastMessage.content === "string") {
    lastMessage.content = replacement;
    return;
  }

  if (Array.isArray(lastMessage.content) && lastMessage.content.length > 0) {
    const lastBlock = lastMessage.content[lastMessage.content.length - 1];
    if (lastBlock && typeof lastBlock === "object") {
      lastBlock.text = replacement;
    }
  }
}

export function extractMessageText(message: any): string {
  if (!message) {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  if (!Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .filter((block: any) => block && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("\n");
}

export function createReplacementMessage(message: any, replacement: string): any {
  if (!message) {
    return message;
  }

  if (typeof message.content === "string") {
    return {
      ...message,
      content: replacement,
    };
  }

  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: [{ type: "text", text: replacement }],
    };
  }

  return {
    ...message,
    content: replacement,
  };
}
