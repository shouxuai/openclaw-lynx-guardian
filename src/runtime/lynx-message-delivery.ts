import type { EventContext, Logger, LynxReportDeliveryAttempt, Message, ResolvedMessageTarget } from "../types.js";
import {
  getRecentActiveDeliveryTargets,
  isSystemOnlyDeliveryRoute,
  readRecentActiveDeliverySnapshots,
  readSessionStoreDeliverySnapshots,
  type RecentActiveRouteHint,
} from "./recent-active-delivery.js";
import {
  extractInjectableWebchatText,
  injectLynxWebchatReportViaGateway,
} from "./lynx-webchat-delivery.js";

interface DeliverLynxReportOptions {
  log: Logger;
  ctx: EventContext;
  message: Message;
  tag: string;
  attempts?: number;
  routeHint?: RecentActiveRouteHint | null;
  routeHintSendMessage?: ((message: Message) => Promise<void>) | null;
  allowSameSessionFallback?: boolean;
  excludeMessageProviders?: string[];
  excludeChannelIds?: string[];
  useSessionStoreFallback?: boolean;
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
    to: routeHint.to,
    accountId: routeHint.accountId,
    threadId: routeHint.threadId,
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
  const to = typeof (ctx as any).to === "string" && (ctx as any).to.trim().length > 0
    ? (ctx as any).to.trim()
    : typeof (ctx as any).recipientId === "string" && (ctx as any).recipientId.trim().length > 0
      ? (ctx as any).recipientId.trim()
      : undefined;
  const accountId = typeof (ctx as any).accountId === "string" && (ctx as any).accountId.trim().length > 0
    ? (ctx as any).accountId.trim()
    : undefined;
  const threadId = typeof (ctx as any).messageThreadId === "number" && Number.isFinite((ctx as any).messageThreadId)
    ? (ctx as any).messageThreadId
    : typeof (ctx as any).threadId === "number" && Number.isFinite((ctx as any).threadId)
      ? (ctx as any).threadId
      : typeof (ctx as any).messageThreadId === "string" && (ctx as any).messageThreadId.trim().length > 0
        ? (ctx as any).messageThreadId.trim()
        : typeof (ctx as any).threadId === "string" && (ctx as any).threadId.trim().length > 0
          ? (ctx as any).threadId.trim()
          : undefined;
  const routedKey = [messageProvider, channelId, senderId]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(":");
  const targetKey = routedKey || sessionKey || `same-session:${senderId ?? "current"}`;

  const candidate: DeliveryCandidate = {
    targetKey,
    sessionKey,
    channelId,
    messageProvider,
    senderId,
    bindingId,
    to,
    accountId,
    threadId,
    updatedAtMs: Date.now(),
    allowCurrentFallback: true,
    sendMessage: typeof ctx.sendMessage === "function" ? ctx.sendMessage : undefined,
  };

  return isSystemOnlyDeliveryRoute(candidate) ? null : candidate;
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
  const excludedProviders = new Set(
    (options.excludeMessageProviders ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const excludedChannels = new Set(
    (options.excludeChannelIds ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

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

  if (options.useSessionStoreFallback === true) {
    for (const snapshot of readSessionStoreDeliverySnapshots()) {
      mergeCandidate(candidates, {
        ...snapshot,
        updatedAtMs: snapshot.updatedAtMs,
      });
    }
  }

  if (
    options.allowSameSessionFallback === true
    && typeof options.ctx.sendMessage === "function"
    && !options.routeHint
  ) {
    mergeCandidate(candidates, toCurrentTargetHint(options.ctx));
  }

  return [...candidates.values()]
    .filter((candidate) => {
      if (isSystemOnlyDeliveryRoute(candidate)) {
        return false;
      }
      const provider = (candidate.messageProvider ?? "").trim().toLowerCase();
      const channel = (candidate.channelId ?? "").trim().toLowerCase();
      if (provider && excludedProviders.has(provider)) {
        return false;
      }
      if (channel && excludedChannels.has(channel)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}

function extractFeishuLead(text: string): string[] {
  const ratingMatch = text.match(/^\s*总体评级：?[^\n]+/m);
  const firstActionMatch = text.match(/^\s*1\.\s+([^\n]+)/m);

  const lead: string[] = [];
  if (ratingMatch) {
    lead.push(`【飞书速览】${ratingMatch[0].trim()}`);
  }
  if (firstActionMatch) {
    lead.push(`【立即动作】${firstActionMatch[1].trim()}`);
  }
  return lead;
}

function stripExistingFeishuLead(text: string): string {
  const lines = text.split(/\r?\n/);
  let index = 0;

  while (
    index < lines.length
    && (
      lines[index].startsWith("【飞书速览】")
      || lines[index].startsWith("【立即动作】")
    )
  ) {
    index += 1;
  }

  while (index < lines.length && lines[index].trim().length === 0) {
    index += 1;
  }

  return index === 0 ? text : lines.slice(index).join("\n");
}

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(trimmed);
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function flattenMarkdownTablesForFeishu(text: string): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = lines[index];
    const nextLine = lines[index + 1];

    if (
      currentLine?.trim().startsWith("|")
      && typeof nextLine === "string"
      && isMarkdownTableSeparator(nextLine)
    ) {
      const headers = splitMarkdownTableRow(currentLine);
      index += 2;

      while (index < lines.length && lines[index].trim().startsWith("|")) {
        const cells = splitMarkdownTableRow(lines[index]);
        const pairs = headers
          .map((header, cellIndex) => {
            const cell = cells[cellIndex] ?? "";
            if (!header && !cell) {
              return "";
            }
            return `${header || `列${cellIndex + 1}`}：${cell || "未提供"}`;
          })
          .filter(Boolean);

        output.push(`- ${pairs.join("；")}`);
        index += 1;
      }

      index -= 1;
      continue;
    }

    output.push(currentLine);
  }

  return output.join("\n");
}

const FEISHU_AUDIT_MAX_CHARS = 4200;
const FEISHU_AUDIT_HEAD_MAX_CHARS = 2200;
const FEISHU_AUDIT_REMEDIATION_MAX_CHARS = 1400;
const FEISHU_AUDIT_MIN_HEAD_CHARS = 1200;

function collapseExcessBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function trimAtLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text.trim();
  }

  const slice = text.slice(0, Math.max(0, maxChars));
  const lastBreak = slice.lastIndexOf("\n");
  if (lastBreak >= Math.floor(Math.max(0, maxChars) * 0.6)) {
    return slice.slice(0, lastBreak).trim();
  }

  return slice.trim();
}

function extractFeishuRemediationSection(text: string): string | null {
  const match = text.match(/(^##\s+(?:八、)?优先级整改建议[\s\S]*$)/m);
  return match?.[1]?.trim() ?? null;
}

function shortenFeishuAuditForSafety(text: string): string {
  if (text.length <= FEISHU_AUDIT_MAX_CHARS) {
    return text;
  }

  const notice = "> 飞书安全缩略：正文过长，已保留首屏摘要与整改建议，避免消息卡片超限。";
  let remediationSection = trimAtLineBoundary(
    extractFeishuRemediationSection(text) ?? "## 八、优先级整改建议\n1. 立即复核本次审计发现",
    FEISHU_AUDIT_REMEDIATION_MAX_CHARS,
  );
  let headSection = trimAtLineBoundary(text, FEISHU_AUDIT_HEAD_MAX_CHARS);

  let combined = [headSection, notice, remediationSection].join("\n\n");
  if (combined.length <= FEISHU_AUDIT_MAX_CHARS) {
    return combined;
  }

  while (combined.length > FEISHU_AUDIT_MAX_CHARS && remediationSection.length > 600) {
    remediationSection = trimAtLineBoundary(remediationSection, remediationSection.length - 200);
    combined = [headSection, notice, remediationSection].join("\n\n");
  }

  if (combined.length > FEISHU_AUDIT_MAX_CHARS) {
    const remainingHeadBudget = Math.max(
      FEISHU_AUDIT_MIN_HEAD_CHARS,
      FEISHU_AUDIT_MAX_CHARS - notice.length - remediationSection.length - 4,
    );
    headSection = trimAtLineBoundary(text, remainingHeadBudget);
    combined = [headSection, notice, remediationSection].join("\n\n");
  }

  return combined;
}

export function shapeTextForProvider(text: string, provider?: string): string {
  if ((provider ?? "").toLowerCase() !== "feishu" || typeof text !== "string" || text.length === 0) {
    return text;
  }

  const normalizedText = stripExistingFeishuLead(text);
  if (!/^#\s*🛡️\s*OpenClaw 全方位安全审计报告/m.test(normalizedText)) {
    return text;
  }

  const flattenedContent = collapseExcessBlankLines(flattenMarkdownTablesForFeishu(normalizedText));
  const shortenedContent = shortenFeishuAuditForSafety(flattenedContent);
  const lead = extractFeishuLead(shortenedContent);
  return lead.length > 0
    ? `${lead.join("\n")}\n\n${shortenedContent}`
    : shortenedContent;
}

export function shapeMessageForProvider(message: Message, provider?: string): Message {
  if ((provider ?? "").toLowerCase() !== "feishu") {
    return message;
  }

  if (typeof message.content === "string") {
    const shapedContent = shapeTextForProvider(message.content, provider);
    if (shapedContent === message.content) {
      return message;
    }

    return {
      ...message,
      content: shapedContent,
    };
  }

  if (Array.isArray(message.content)) {
    let changed = false;
    const nextContent = message.content.map((block) => {
      if (!block || typeof block !== "object" || block.type !== "text" || typeof block.text !== "string") {
        return block;
      }

      const shapedText = shapeTextForProvider(block.text, provider);
      if (shapedText === block.text) {
        return block;
      }

      changed = true;
      return {
        ...block,
        text: shapedText,
      };
    });

    if (!changed) {
      return message;
    }

    return {
      ...message,
      content: nextContent,
    };
  }

  return message;
}

async function deliverToCandidate(
  options: DeliverLynxReportOptions,
  candidate: DeliveryCandidate,
): Promise<LynxReportDeliveryAttempt> {
  const maxAttempts = Math.max(1, options.attempts ?? 1);
  const sharedMessageSend = options.ctx.sharedMessageSender?.send;
  const shapedMessage = shapeMessageForProvider(options.message, candidate.messageProvider);
  const injectableWebchatText = extractInjectableWebchatText(shapedMessage);
  const excludedProviders = new Set(
    (options.excludeMessageProviders ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const excludedChannels = new Set(
    (options.excludeChannelIds ?? [])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  let lastErrorMessage: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (candidate.targetKey && options.ctx.resolveMessageTarget && typeof sharedMessageSend === "function") {
      try {
        options.log.info(
          `[lynx-guardian] sender-execution-plane attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=shared-resolved-target route=${candidate.targetKey}`,
        );
        const resolvedTarget = await options.ctx.resolveMessageTarget(toTargetHint(candidate));
        if (resolvedTarget) {
          const resolvedProvider = (resolvedTarget.messageProvider ?? "").trim().toLowerCase();
          const resolvedChannel = (resolvedTarget.channelId ?? "").trim().toLowerCase();
          if (
            (resolvedProvider && excludedProviders.has(resolvedProvider))
            || (resolvedChannel && excludedChannels.has(resolvedChannel))
          ) {
            lastErrorMessage = `Resolved target matched an excluded delivery route (${resolvedTarget.targetKey ?? candidate.targetKey})`;
            options.log.info(
              `[lynx-guardian] sender-execution-plane skipped attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=shared-resolved-target route=${resolvedTarget.targetKey ?? candidate.targetKey} reason=${lastErrorMessage}`,
            );
            continue;
          }

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

    if (
      (candidate.messageProvider ?? "").trim().toLowerCase() === "webchat"
      && candidate.sessionKey
      && injectableWebchatText.length > 0
    ) {
      try {
        options.log.info(
          `[lynx-guardian] sender-execution-plane attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=gateway-chat.inject route=${candidate.targetKey}`,
        );
        await injectLynxWebchatReportViaGateway({
          sessionKey: candidate.sessionKey,
          message: shapedMessage,
        });
        options.log.info(
          `[lynx-guardian] sender-execution-plane success attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=gateway-chat.inject route=${candidate.targetKey}`,
        );
        return {
          targetKey: candidate.targetKey,
          sessionKey: candidate.sessionKey,
          channelId: candidate.channelId,
          messageProvider: candidate.messageProvider,
          senderId: candidate.senderId,
          bindingId: candidate.bindingId,
          delivered: true,
          transport: "gateway-chat.inject",
        };
      } catch (err: any) {
        lastErrorMessage = err?.message ?? String(err);
        options.log.warn(
          `[lynx-guardian] sender-execution-plane failed attempt=${attempt}/${maxAttempts} tag=${options.tag} transport=gateway-chat.inject route=${candidate.targetKey} reason=${lastErrorMessage}`,
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
