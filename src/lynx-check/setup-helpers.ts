import type { RecentActiveDeliverySnapshot } from "../delivery/recent-delivery.js";

export function resolveManagedLynxCheckSource(ctx: any): "manual" | "scheduled" {
  return isCronManagedLynxCheckContext(ctx) || isPluginSubsystem(ctx)
    ? "scheduled"
    : "manual";
}

export function resolveManagedLynxCheckPromptChannel(
  ctx: any,
  routeHint?: RecentActiveDeliverySnapshot | null,
): "webchat" | "feishu" | "generic" {
  const candidates = [
    normalizeLynxCheckString(ctx?.messageProvider),
    normalizeLynxCheckString(ctx?.channelId),
    normalizeLynxCheckString(ctx?.source),
    normalizeLynxCheckString(routeHint?.messageProvider),
    normalizeLynxCheckString(routeHint?.channelId),
  ]
    .filter(Boolean)
    .map((value) => value.toLowerCase());

  if (candidates.some((value) => value.includes("feishu"))) {
    return "feishu";
  }
  if (candidates.some((value) => value.includes("webchat"))) {
    return "webchat";
  }
  return "generic";
}

function isPluginSubsystem(ctx: any): boolean {
  return normalizeLynxCheckString(ctx?.subsystem).toLowerCase() === "plugins";
}

function isCronManagedLynxCheckContext(ctx: any): boolean {
  const trigger = normalizeLynxCheckString(ctx?.trigger).toLowerCase();
  if (trigger === "cron") {
    return true;
  }

  const sessionKey = normalizeLynxCheckString(ctx?.sessionKey).toLowerCase();
  return sessionKey.startsWith("cron:") || sessionKey.includes(":cron:");
}

function normalizeLynxCheckString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
