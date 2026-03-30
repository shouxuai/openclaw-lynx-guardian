import { normalize, resolve } from "path";
import type { GuardContext } from "./safety-guard.js";

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
