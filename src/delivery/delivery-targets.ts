import type { RecentActiveDeliverySnapshot } from "./recent-delivery.js";

export function describeDeliveryTarget(ctx: any): string {
  const parts = [
    ctx?.messageProvider ?? ctx?.source,
    ctx?.channelId ?? ctx?.channel,
    ctx?.sessionKey,
    ctx?.senderId ?? ctx?.userId,
  ];

  const target = parts
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join("|");

  return target || "unknown-target";
}

export function summarizeOutgoingMessage(message: any): string {
  if (typeof message?.content === "string") {
    return `text:${message.content.length}`;
  }

  if (Array.isArray(message?.content)) {
    return `blocks:${message.content.length}`;
  }

  return "unknown-payload";
}

export function resolveDeliveryThreadId(value: any): string | number | undefined {
  return typeof value?.messageThreadId === "number" && Number.isFinite(value.messageThreadId)
    ? value.messageThreadId
    : typeof value?.threadId === "number" && Number.isFinite(value.threadId)
      ? value.threadId
      : normalizeDeliveryString(value?.messageThreadId ?? value?.threadId) || undefined;
}

export function buildDeliveryTargetSnapshot(value: any): Partial<RecentActiveDeliverySnapshot> {
  return {
    sessionKey: normalizeDeliveryString(value?.sessionKey) || undefined,
    channelId: normalizeDeliveryString(value?.channelId ?? value?.channel) || undefined,
    messageProvider: normalizeDeliveryString(value?.messageProvider ?? value?.source) || undefined,
    senderId: normalizeDeliveryString(value?.senderId ?? value?.userId) || undefined,
    bindingId: normalizeDeliveryString(value?.bindingId) || undefined,
    to: normalizeDeliveryString(value?.to ?? value?.recipientId) || undefined,
    accountId: normalizeDeliveryString(value?.accountId) || undefined,
    threadId: resolveDeliveryThreadId(value),
  };
}

export function buildOutboundDeliveryTarget(
  event: any,
  ctx: any,
): Partial<RecentActiveDeliverySnapshot> {
  const currentTarget = buildDeliveryTargetSnapshot(ctx);
  return {
    ...currentTarget,
    bindingId: normalizeDeliveryString(event?.bindingId) || currentTarget.bindingId,
    to: normalizeDeliveryString(event?.to) || currentTarget.to,
    accountId: normalizeDeliveryString(event?.accountId) || currentTarget.accountId,
    threadId: resolveDeliveryThreadId(event) ?? currentTarget.threadId,
  };
}

function normalizeDeliveryString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
