import type { EventContext, Logger, Message, ResolvedMessageTarget } from "../types.js";
import type { RecentActiveRouteHint } from "./recent-active-delivery.js";

interface DeliverLynxReportOptions {
  log: Logger;
  ctx: EventContext;
  message: Message;
  tag: string;
  attempts?: number;
  routeHint?: RecentActiveRouteHint | null;
  routeHintSendMessage?: ((message: Message) => Promise<void>) | null;
  allowSameSessionFallback?: boolean;
}

export interface LynxReportDeliveryResult {
  delivered: boolean;
  transport:
    | "shared-resolved-target"
    | "legacy-route-hint-sendMessage"
    | "ctx-sendMessage-same-session"
    | "none";
}

function isSameSession(ctx: EventContext, routeHint?: RecentActiveRouteHint | null): boolean {
  if (!routeHint) {
    return true;
  }

  if (!routeHint.sessionKey || !ctx.sessionKey) {
    return false;
  }

  return routeHint.sessionKey === ctx.sessionKey;
}

function toTargetHint(routeHint: RecentActiveRouteHint): Partial<ResolvedMessageTarget> {
  return {
    targetKey: routeHint.targetKey,
    sessionKey: routeHint.sessionKey,
    channelId: routeHint.channelId,
    messageProvider: routeHint.messageProvider,
    senderId: routeHint.senderId,
    bindingId: routeHint.bindingId,
  };
}

function toCurrentTargetHint(ctx: EventContext): Partial<ResolvedMessageTarget> | null {
  const sessionKey = typeof ctx.sessionKey === "string" && ctx.sessionKey.trim().length > 0
    ? ctx.sessionKey.trim()
    : undefined;
  const channelId = typeof (ctx as any).channelId === "string" && (ctx as any).channelId.trim().length > 0
    ? (ctx as any).channelId.trim()
    : typeof (ctx as any).channel === "string" && (ctx as any).channel.trim().length > 0
      ? (ctx as any).channel.trim()
      : undefined;
  const messageProvider = typeof (ctx as any).messageProvider === "string" && (ctx as any).messageProvider.trim().length > 0
    ? (ctx as any).messageProvider.trim()
    : typeof (ctx as any).source === "string" && (ctx as any).source.trim().length > 0
      ? (ctx as any).source.trim()
      : undefined;
  const senderId = typeof (ctx as any).senderId === "string" && (ctx as any).senderId.trim().length > 0
    ? (ctx as any).senderId.trim()
    : typeof (ctx as any).userId === "string" && (ctx as any).userId.trim().length > 0
      ? (ctx as any).userId.trim()
      : undefined;
  const bindingId = typeof (ctx as any).bindingId === "string" && (ctx as any).bindingId.trim().length > 0
    ? (ctx as any).bindingId.trim()
    : undefined;
  const routedKey = [messageProvider, channelId, senderId]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(":");
  const targetKey = routedKey || sessionKey;

  if (!targetKey) {
    return null;
  }

  return {
    targetKey,
    sessionKey,
    channelId,
    messageProvider,
    senderId,
    bindingId,
  };
}

export async function deliverLynxReport(options: DeliverLynxReportOptions): Promise<LynxReportDeliveryResult> {
  const attempts = Math.max(1, options.attempts ?? 1);
  const allowSameSessionFallback = options.allowSameSessionFallback === true;
  const transportTargetHint = options.routeHint ? toTargetHint(options.routeHint) : toCurrentTargetHint(options.ctx);
  const sharedMessageSend = options.ctx.sharedMessageSender?.send;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (transportTargetHint && options.ctx.resolveMessageTarget && typeof sharedMessageSend === "function") {
      try {
        options.log.info(
          `[lynx-guardian] sender-execution-plane attempt=${attempt}/${attempts} tag=${options.tag} transport=shared-resolved-target route=${transportTargetHint.targetKey ?? "unknown"}`,
        );
        const resolvedTarget = await options.ctx.resolveMessageTarget(transportTargetHint);
        if (resolvedTarget) {
          await sharedMessageSend({
            target: resolvedTarget,
            message: options.message,
            metadata: {
              source: "lynx-guardian",
              transport: "shared-resolved-target",
              deliveryTargetKey: transportTargetHint.targetKey,
            },
          });
          options.log.info(
            `[lynx-guardian] sender-execution-plane success attempt=${attempt}/${attempts} tag=${options.tag} transport=shared-resolved-target route=${resolvedTarget.targetKey ?? transportTargetHint.targetKey ?? "unknown"}`,
          );
          return { delivered: true, transport: "shared-resolved-target" };
        }
        options.log.warn(
          `[lynx-guardian] sender-execution-plane unresolved target attempt=${attempt}/${attempts} tag=${options.tag} transport=shared-resolved-target route=${transportTargetHint.targetKey ?? "unknown"}`,
        );
      } catch (err: any) {
        options.log.warn(
          `[lynx-guardian] sender-execution-plane failed attempt=${attempt}/${attempts} tag=${options.tag} transport=shared-resolved-target reason=${err?.message ?? String(err)}`,
        );
      }
    }

    if (typeof options.routeHintSendMessage === "function") {
      try {
        options.log.info(
          `[lynx-guardian] sender-execution-plane attempt=${attempt}/${attempts} tag=${options.tag} transport=legacy-route-hint-sendMessage route=${options.routeHint?.targetKey ?? "unknown"}`,
        );
        await options.routeHintSendMessage(options.message);
        options.log.info(
          `[lynx-guardian] sender-execution-plane success attempt=${attempt}/${attempts} tag=${options.tag} transport=legacy-route-hint-sendMessage route=${options.routeHint?.targetKey ?? "unknown"}`,
        );
        return { delivered: true, transport: "legacy-route-hint-sendMessage" };
      } catch (err: any) {
        options.log.warn(
          `[lynx-guardian] sender-execution-plane failed attempt=${attempt}/${attempts} tag=${options.tag} transport=legacy-route-hint-sendMessage reason=${err?.message ?? String(err)}`,
        );
      }
    }

    if (
      allowSameSessionFallback
      && typeof options.ctx.sendMessage === "function"
      && isSameSession(options.ctx, options.routeHint)
    ) {
      try {
        options.log.info(
          `[lynx-guardian] sender-execution-plane attempt=${attempt}/${attempts} tag=${options.tag} transport=ctx-sendMessage-same-session`,
        );
        await options.ctx.sendMessage(options.message);
        options.log.info(
          `[lynx-guardian] sender-execution-plane success attempt=${attempt}/${attempts} tag=${options.tag} transport=ctx-sendMessage-same-session`,
        );
        return { delivered: true, transport: "ctx-sendMessage-same-session" };
      } catch (err: any) {
        options.log.warn(
          `[lynx-guardian] sender-execution-plane failed attempt=${attempt}/${attempts} tag=${options.tag} transport=ctx-sendMessage-same-session reason=${err?.message ?? String(err)}`,
        );
      }
    } else if (
      allowSameSessionFallback
      && typeof options.ctx.sendMessage === "function"
      && options.routeHint?.sessionKey
      && options.ctx.sessionKey
      && options.routeHint.sessionKey !== options.ctx.sessionKey
    ) {
      options.log.warn(
        `[lynx-guardian] sender-execution-plane skipped ctx.sendMessage fallback due to session mismatch route=${options.routeHint.sessionKey} current=${options.ctx.sessionKey}`,
      );
    }
  }

  options.log.error(
    `[lynx-guardian] sender-execution-plane exhausted tag=${options.tag} attempts=${attempts} route=${options.routeHint?.targetKey ?? "none"}`,
  );
  return { delivered: false, transport: "none" };
}
