import type { EventContext, Logger, LynxReportDeliveryAttempt, Message, ResolvedMessageTarget } from "../types.js";
import {
  getRecentActiveDeliveryTargets,
  readRecentActiveDeliverySnapshots,
  type RecentActiveRouteHint,
} from "./recent-active-delivery.js";

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
  transport: string;
  deliveryAttempts: LynxReportDeliveryAttempt[];
}

interface DeliveryCandidate extends Partial<ResolvedMessageTarget> {
  targetKey: string;
  updatedAtMs: number;
  sendMessage?: (message: Message) => Promise<void>;
  allowCurrentFallback?: boolean;
  fromRouteHint?: boolean;
}

function isSameSession(ctx: EventContext, routeHint?: Partial<ResolvedMessageTarget> | null): boolean {
  if (!routeHint) {
    return true;
  }

  if (!routeHint.sessionKey || !ctx.sessionKey) {
    return false;
  }

  return routeHint.sessionKey === ctx.sessionKey;
}

function toTargetHint(routeHint: Partial<ResolvedMessageTarget>): Partial<ResolvedMessageTarget> {
  return {
    targetKey: routeHint.targetKey,
    sessionKey: routeHint.sessionKey,
    channelId: routeHint.channelId,
    messageProvider: routeHint.messageProvider,
    senderId: routeHint.senderId,
    bindingId: routeHint.bindingId,
  };
}

function toCurrentTargetHint(ctx: EventContext): DeliveryCandidate | null {
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
  const targetKey = routedKey || sessionKey || `same-session:${senderId ?? "current"}`;

  return {
    targetKey,
    sessionKey,
    channelId,
    messageProvider,
    senderId,
    bindingId,
    updatedAtMs: Date.now(),
    allowCurrentFallback: true,
    sendMessage: typeof ctx.sendMessage === "function" ? ctx.sendMessage : undefined,
  };
}

function mergeCandidate(
  candidates: Map<string, DeliveryCandidate>,
  candidate: DeliveryCandidate | null,
): void {
  if (!candidate || !candidate.targetKey) {
    return;
  }

  const existing = candidates.get(candidate.targetKey);
  if (!existing) {
    candidates.set(candidate.targetKey, candidate);
    return;
  }

  candidates.set(candidate.targetKey, {
    ...existing,
    ...candidate,
    updatedAtMs: Math.max(existing.updatedAtMs ?? 0, candidate.updatedAtMs ?? 0),
    sendMessage: existing.sendMessage ?? candidate.sendMessage,
    allowCurrentFallback: existing.allowCurrentFallback === true || candidate.allowCurrentFallback === true,
    fromRouteHint: existing.fromRouteHint === true || candidate.fromRouteHint === true,
  });
}

function collectDeliveryCandidates(options: DeliverLynxReportOptions): DeliveryCandidate[] {
  const candidates = new Map<string, DeliveryCandidate>();

  if (options.routeHint?.targetKey) {
    mergeCandidate(candidates, {
      ...options.routeHint,
      updatedAtMs: options.routeHint.updatedAtMs ?? Date.now(),
      sendMessage: options.routeHintSendMessage ?? undefined,
      fromRouteHint: true,
    });
  }

  for (const liveTarget of getRecentActiveDeliveryTargets()) {
    mergeCandidate(candidates, {
      ...liveTarget,
      updatedAtMs: liveTarget.updatedAtMs,
      sendMessage: liveTarget.sendMessage,
    });
  }

  for (const snapshot of readRecentActiveDeliverySnapshots()) {
    mergeCandidate(candidates, {
      ...snapshot,
      updatedAtMs: snapshot.updatedAtMs,
    });
  }

  if (
    options.allowSameSessionFallback === true
    && typeof options.ctx.sendMessage === "function"
    && !options.routeHint
  ) {
    mergeCandidate(candidates, toCurrentTargetHint(options.ctx));
  }

  return [...candidates.values()].sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

function extractFeishuLead(text: string): string[] {
  const ratingMatch = text.match(/^\s*总体评级：([^\n]+)/m);
  const firstActionMatch = text.match(/^\s*1\.\s+([^\n]+)/m);

  const lead: string[] = [];
  if (ratingMatch) {
    lead.push(`【飞书速览】总体评级：${ratingMatch[1].trim()}`);
  }
  if (firstActionMatch) {
    lead.push(`【立即动作】${firstActionMatch[1].trim()}`);
  }
  return lead;
}

function shapeMessageForProvider(message: Message, provider?: string): Message {
  if ((provider ?? "").toLowerCase() !== "feishu" || typeof message.content !== "string") {
    return message;
  }

  if (!message.content.includes("# 🛡️ OpenClaw 全方位安全审计报告")) {
    return message;
  }

  const lead = extractFeishuLead(message.content);
  if (lead.length === 0) {
    return message;
  }

  return {
    ...message,
    content: `${lead.join("\n")}\n\n${message.content}`,
  };
}

async function deliverToCandidate(
  options: DeliverLynxReportOptions,
  candidate: DeliveryCandidate,
): Promise<LynxReportDeliveryAttempt> {
  const maxAttempts = Math.max(1, options.attempts ?? 1);
  const sharedMessageSend = options.ctx.sharedMessageSender?.send;
  const shapedMessage = shapeMessageForProvider(options.message, candidate.messageProvider);
  let lastErrorMessage: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (candidate.targetKey && options.ctx.resolveMessageTarget && typeof sharedMessageSend === "function") {
      try {
        options.log.info(
          `[lynx-guardian] sender-execution-plane attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=shared-resolved-target route=${candidate.targetKey}`,
        );
        const resolvedTarget = await options.ctx.resolveMessageTarget(toTargetHint(candidate));
        if (resolvedTarget) {
          await sharedMessageSend({
            target: resolvedTarget,
            message: shapedMessage,
            metadata: {
              source: "lynx-guardian",
              transport: "shared-resolved-target",
              deliveryTargetKey: candidate.targetKey,
            },
          });
          options.log.info(
            `[lynx-guardian] sender-execution-plane success attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=shared-resolved-target route=${resolvedTarget.targetKey ?? candidate.targetKey}`,
          );
          return {
            targetKey: candidate.targetKey,
            sessionKey: candidate.sessionKey,
            channelId: candidate.channelId,
            messageProvider: candidate.messageProvider,
            senderId: candidate.senderId,
            bindingId: candidate.bindingId,
            delivered: true,
            transport: "shared-resolved-target",
          };
        }
      } catch (err: any) {
        lastErrorMessage = err?.message ?? String(err);
        options.log.warn(
          `[lynx-guardian] sender-execution-plane failed attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=shared-resolved-target route=${candidate.targetKey} reason=${lastErrorMessage}`,
        );
      }
    }

    if (typeof candidate.sendMessage === "function") {
      const transport = candidate.fromRouteHint === true
        ? "legacy-route-hint-sendMessage"
        : "live-target-sendMessage";
      try {
        options.log.info(
          `[lynx-guardian] sender-execution-plane attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=${transport} route=${candidate.targetKey}`,
        );
        await candidate.sendMessage(shapedMessage);
        options.log.info(
          `[lynx-guardian] sender-execution-plane success attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=${transport} route=${candidate.targetKey}`,
        );
        return {
          targetKey: candidate.targetKey,
          sessionKey: candidate.sessionKey,
          channelId: candidate.channelId,
          messageProvider: candidate.messageProvider,
          senderId: candidate.senderId,
          bindingId: candidate.bindingId,
          delivered: true,
          transport,
        };
      } catch (err: any) {
        lastErrorMessage = err?.message ?? String(err);
        options.log.warn(
          `[lynx-guardian] sender-execution-plane failed attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=${transport} route=${candidate.targetKey} reason=${lastErrorMessage}`,
        );
      }
    }

    if (
      candidate.allowCurrentFallback === true
      && typeof options.ctx.sendMessage === "function"
      && isSameSession(options.ctx, candidate)
    ) {
      try {
        options.log.info(
          `[lynx-guardian] sender-execution-plane attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=ctx-sendMessage-same-session route=${candidate.targetKey}`,
        );
        await options.ctx.sendMessage(shapedMessage);
        options.log.info(
          `[lynx-guardian] sender-execution-plane success attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=ctx-sendMessage-same-session route=${candidate.targetKey}`,
        );
        return {
          targetKey: candidate.targetKey,
          sessionKey: candidate.sessionKey,
          channelId: candidate.channelId,
          messageProvider: candidate.messageProvider,
          senderId: candidate.senderId,
          bindingId: candidate.bindingId,
          delivered: true,
          transport: "ctx-sendMessage-same-session",
        };
      } catch (err: any) {
        lastErrorMessage = err?.message ?? String(err);
        options.log.warn(
          `[lynx-guardian] sender-execution-plane failed attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=ctx-sendMessage-same-session route=${candidate.targetKey} reason=${lastErrorMessage}`,
        );
      }
    }
  }

  return {
    targetKey: candidate.targetKey,
    sessionKey: candidate.sessionKey,
    channelId: candidate.channelId,
    messageProvider: candidate.messageProvider,
    senderId: candidate.senderId,
    bindingId: candidate.bindingId,
    delivered: false,
    transport: "none",
    errorMessage: lastErrorMessage ?? "No delivery transport resolved for target",
  };
}

export async function deliverLynxReport(options: DeliverLynxReportOptions): Promise<LynxReportDeliveryResult> {
  const candidates = collectDeliveryCandidates(options);
  if (candidates.length === 0) {
    options.log.error(
      `[lynx-guardian] sender-execution-plane exhausted tag=${options.tag} attempts=${Math.max(1, options.attempts ?? 1)} route=none`,
    );
    return {
      delivered: false,
      transport: "none",
      deliveryAttempts: [],
    };
  }

  const deliveryAttempts: LynxReportDeliveryAttempt[] = [];
  for (const candidate of candidates) {
    deliveryAttempts.push(await deliverToCandidate(options, candidate));
  }

  const deliveredAttempts = deliveryAttempts.filter((item) => item.delivered);
  const transport = deliveredAttempts.length > 0
    ? [...new Set(deliveredAttempts.map((item) => item.transport))].join(",")
    : "none";

  if (deliveredAttempts.length === 0) {
    options.log.error(
      `[lynx-guardian] sender-execution-plane exhausted tag=${options.tag} attempts=${Math.max(1, options.attempts ?? 1)} route=${candidates.map((candidate) => candidate.targetKey).join(",")}`,
    );
  }

  return {
    delivered: deliveredAttempts.length > 0,
    transport,
    deliveryAttempts,
  };
}
