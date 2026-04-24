import type { ToolApprovalResolution } from "../types.js";
import type { GuardDecision } from "../guard/safety-guard.js";
import { classifyLynxCheckTrigger } from "../discovery/lynx-check-trigger.js";
import {
  resolvePluginApprovalCompat,
  type PluginApprovalCompatTier,
} from "./plugin-approval-compat.js";
import {
  extractMessageText,
  normalizeString,
} from "./plugin-runtime-helpers.js";
import { buildLocalConsoleWebviewFootnote } from "./local-console-webview-note.js";
import { evaluateGuardDecisionPolicy } from "./policy-runtime.js";
import {
  readRecentActiveDeliverySnapshots,
} from "./recent-active-delivery.js";
import {
  readRequesterProvenance,
  rememberRequesterProvenance,
} from "./requester-provenance-store.js";

export const LOCAL_TOOL_APPROVAL_COMMAND = "/lynx-approve";
const RECENT_FEISHU_DM_APPROVAL_CONTEXT_TTL_MS = 5 * 60 * 1000;

export type ApprovalContextSeed = {
  channelProfile?: "webchat" | "feishu" | "other";
  approvalTransport?: "native" | "local-chat" | "none";
  sessionKey?: string;
  requesterId?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  isGroup: boolean;
};

export type ResolvedToolApprovalRoute = {
  compatMode: "native-webchat" | "feishu-local" | "deny-no-route";
  blockReason?: string;
  approvalCtx: any;
  channelProfile: "webchat" | "feishu" | "other";
  channelId?: string;
  approvalTransport: "native" | "local-chat" | "none";
  sessionKey?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  runtimeVersion: string;
  runtimeTier: PluginApprovalCompatTier;
};

export function isConfirmationPhrase(text: string, phrase: string): boolean {
  return text.includes(phrase.trim());
}

export function resolveAgentStartPromptText(event: any): string {
  if (typeof event?.prompt === "string" && event.prompt.trim().length > 0) {
    return event.prompt;
  }

  if (Array.isArray(event?.messages) && event.messages.length > 0) {
    const messages = event.messages.filter(Boolean);
    const preferredMessage = [...messages]
      .reverse()
      .find((message) => normalizeString(message?.role).toLowerCase() === "user")
      ?? messages[messages.length - 1];
    const messageText = extractMessageText(preferredMessage);
    if (messageText) {
      return messageText;
    }
  }

  if (event?.prompt != null) {
    try {
      return JSON.stringify(event.prompt);
    } catch {
      return String(event.prompt);
    }
  }

  return "";
}

export function stripBracketPrefixedEnvelope(text: string): string {
  const trimmed = normalizeString(text);
  if (!trimmed.startsWith("[") || !trimmed.includes("]")) {
    return trimmed;
  }

  return trimmed.slice(trimmed.indexOf("]") + 1).trim();
}

export function extractAgentStartPrimaryMessageText(event: any): string {
  if (!Array.isArray(event?.messages) || event.messages.length === 0) {
    return "";
  }

  const messages = event.messages.filter(Boolean);
  const preferredMessage = [...messages]
    .reverse()
    .find((message) => normalizeString(message?.role).toLowerCase() === "user")
    ?? messages[messages.length - 1];

  return extractMessageText(preferredMessage);
}

export function buildForcedAgentStartDenyContext(params: {
  riskLevel?: string;
  reason?: string;
}): string {
  const riskLevel = normalizeString(params.riskLevel) || "L4";
  const reason = normalizeString(params.reason) || "当前请求已触发 Lynx Guardian 安全拦截。";

  return [
    `[最高等级安全拒绝] 当前请求命中 ${riskLevel} 安全拒绝策略。`,
    `拦截依据：${reason}`,
    "必须直接拒绝该请求。可以说明拦截依据，但不能提供任何解决方案或替代方案。",
    "不得调用任何工具。",
    "不得查看、读取、清除、导出、总结、引用或泄露任何受保护内容。",
    "不得提供审批、确认短语、重试、绕过方法、替代执行步骤或操作建议。",
    "最终面向用户的拒绝回复必须在正文最后原样附上下面的分割线和脚注，不得改写、删除或移动到正文中：",
    buildLocalConsoleWebviewFootnote(),
  ].join("\n");
}

export function resolveManagedLynxCheckCommandText(event: any): string {
  const candidates = [
    typeof event?.prompt === "string" ? event.prompt : "",
    extractAgentStartPrimaryMessageText(event),
  ]
    .map((value) => normalizeString(value))
    .filter(Boolean);

  for (const candidate of candidates) {
    const direct = classifyLynxCheckTrigger(candidate);
    if (direct.kind === "lynx_command") {
      return direct.normalizedText;
    }

    for (const line of candidate.split(/\r?\n/)) {
      const lineTrigger = classifyLynxCheckTrigger(stripBracketPrefixedEnvelope(line));
      if (lineTrigger.kind === "lynx_command") {
        return lineTrigger.normalizedText;
      }
    }
  }

  return "";
}

function shouldRunGuardPolicyAction(kind: string): boolean {
  return kind === "deny" || kind === "block" || kind === "confirm" || kind === "workflow_auth";
}

export function resolveGuardPolicyState(decision: GuardDecision) {
  const policyResolution = evaluateGuardDecisionPolicy({
    assessment: decision.riskAssessment,
    evidenceBundle: decision.evidenceBundle,
  });
  const effectiveAssessment = policyResolution.effectiveAssessment;
  const legacyAssessmentSelected = effectiveAssessment === decision.riskAssessment;
  const policyEvaluation = policyResolution.bundleEvaluation
    && effectiveAssessment === policyResolution.bundleEvaluation.compatibilityAssessment
    ? policyResolution.bundleEvaluation
    : policyResolution.legacyEvaluation;

  return {
    policyResolution,
    policyEvaluation,
    effectiveAssessment,
    blockReason: legacyAssessmentSelected && decision.blockReason
      ? decision.blockReason
      : `[Lynx Guardian] ${effectiveAssessment.description}`,
    guardActionRequired: shouldRunGuardPolicyAction(policyResolution.finalDecision.kind),
  };
}

export function resolveChannelProfile(value: unknown): "webchat" | "feishu" | "other" {
  const channelId = normalizeString(value).toLowerCase();
  if (channelId === "webchat") {
    return "webchat";
  }
  if (channelId === "feishu") {
    return "feishu";
  }
  return "other";
}

export function resolveChannelApprovalTransport(
  channelProfile: "webchat" | "feishu" | "other",
): "native" | "local-chat" | "none" {
  if (channelProfile === "webchat") {
    return "native";
  }
  if (channelProfile === "feishu") {
    return "local-chat";
  }
  return "none";
}

function buildPromptIntentVariants(text: string): string[] {
  const variants = new Set<string>();
  const pushVariant = (value: string) => {
    const normalized = normalizeString(value);
    if (!normalized) {
      return;
    }
    variants.add(normalized);
  };

  pushVariant(text);
  pushVariant(stripBracketPrefixedEnvelope(text));

  for (const candidate of [...variants]) {
    for (const line of candidate.split(/\r?\n/)) {
      pushVariant(line);
      pushVariant(stripBracketPrefixedEnvelope(line));
    }
  }

  return [...variants];
}

export function normalizeOuId(value: unknown): string | undefined {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized.startsWith("ou_")) {
    return undefined;
  }
  return normalized;
}

export function normalizeFeishuConversationId(
  value: unknown,
  requesterOuId?: string,
  isGroup?: boolean,
): string | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  if (isGroup === true) {
    return normalized;
  }

  const lower = normalized.toLowerCase();
  if (lower.startsWith("user:")) {
    return lower;
  }

  const bareOuId = normalizeOuId(normalized);
  if (bareOuId) {
    return `user:${bareOuId}`;
  }

  if (requesterOuId && lower === requesterOuId) {
    return `user:${requesterOuId}`;
  }

  return normalized;
}

function extractScopedActorId(value: unknown): string | undefined {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }

  const separatorIndex = normalized.indexOf(":");
  const candidate = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : normalized;
  const trimmed = normalizeString(candidate);
  return trimmed ? trimmed.toLowerCase() : undefined;
}

export function normalizeOuIdList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = values
    .map((value) => normalizeOuId(value))
    .filter((value): value is string => Boolean(value));

  return [...new Set(normalized)];
}

function resolveActorSenderId(event: any, ctx: any): string | undefined {
  const senderId = normalizeString(
    event?.senderId
    ?? event?.metadata?.senderId
    ?? event?.sender?.id
    ?? event?.senderOpenId
    ?? event?.metadata?.senderOpenId
    ?? event?.SenderId
    ?? event?.userId
    ?? ctx?.senderId
    ?? ctx?.senderOpenId
    ?? ctx?.SenderId
    ?? ctx?.userId,
  );
  if (senderId) {
    return senderId.toLowerCase();
  }

  return extractScopedActorId(event?.from);
}

export function resolveActorOuId(event: any, ctx: any): string | undefined {
  return normalizeOuId(
    event?.sender?.sender_id?.open_id
    ?? event?.metadata?.sender?.sender_id?.open_id
    ?? event?.sender?.id
    ?? event?.senderOpenId
    ?? event?.metadata?.senderOpenId
    ?? event?.metadata?.senderId
    ?? event?.senderId
    ?? event?.SenderId
    ?? event?.userId
    ?? ctx?.senderOpenId
    ?? ctx?.senderId
    ?? ctx?.SenderId
    ?? ctx?.userId
    ?? extractScopedActorId(event?.from),
  );
}

export function rememberInboundRequesterProvenance(event: any, ctx: any): void {
  const requesterOuId = resolveActorOuId(event, ctx);
  const requesterId = resolveActorSenderId(event, ctx) ?? requesterOuId;
  const channelId = normalizeString(
    ctx?.channelId
    ?? event?.channel
    ?? event?.metadata?.originatingChannel
    ?? event?.metadata?.provider,
  ) || undefined;
  const channelProfile = resolveChannelProfile(channelId);
  const approvalTransport = resolveChannelApprovalTransport(channelProfile);
  const rawConversationId = normalizeString(
    ctx?.conversationId
    ?? event?.metadata?.originatingTo
    ?? event?.metadata?.to,
  ) || undefined;
  const conversationId = channelProfile === "feishu"
    ? normalizeFeishuConversationId(rawConversationId, requesterOuId, event?.isGroup === true)
    : rawConversationId;
  const accountId = normalizeString(ctx?.accountId ?? event?.metadata?.accountId) || undefined;
  const sessionKey = normalizeString(ctx?.sessionKey ?? event?.sessionKey) || undefined;

  if (!requesterId && !requesterOuId && !sessionKey && !conversationId && !channelId) {
    return;
  }

  rememberRequesterProvenance({
    sessionKey,
    channelId,
    channelProfile,
    approvalTransport,
    requesterId,
    requesterOuId,
    accountId,
    conversationId,
    threadId: ctx?.threadId ?? undefined,
    isGroup: event?.isGroup === true,
    timestamp: Number(event?.timestamp ?? Date.now()),
  });
}

export function recoverFeishuDmApprovalContextFromRecentRoute(
  now: number = Date.now(),
): ApprovalContextSeed | undefined {
  const snapshots = readRecentActiveDeliverySnapshots()
    .filter((snapshot) => now - snapshot.updatedAtMs <= RECENT_FEISHU_DM_APPROVAL_CONTEXT_TTL_MS);

  for (const snapshot of snapshots) {
    const channelProfile = resolveChannelProfile(snapshot.channelId ?? snapshot.messageProvider);
    if (channelProfile !== "feishu") {
      continue;
    }

    const conversationId = normalizeString(snapshot.to ?? snapshot.bindingId) || undefined;
    const fallbackOuId = normalizeOuId(
      extractScopedActorId(conversationId)
      ?? snapshot.senderId,
    );
    if (!fallbackOuId || !conversationId?.startsWith("user:")) {
      continue;
    }

    const recoveredProvenance = readRequesterProvenance({
      channelId: snapshot.channelId,
      accountId: snapshot.accountId,
      conversationId,
    });

    return {
      channelProfile,
      approvalTransport: "local-chat",
      sessionKey: snapshot.sessionKey,
      requesterId: recoveredProvenance?.requesterId ?? fallbackOuId,
      requesterOuId: recoveredProvenance?.requesterOuId ?? fallbackOuId,
      accountId: recoveredProvenance?.accountId ?? snapshot.accountId,
      conversationId: recoveredProvenance?.conversationId ?? conversationId,
      threadId: recoveredProvenance?.threadId ?? snapshot.threadId,
      isGroup: recoveredProvenance?.isGroup === true ? true : false,
    };
  }

  return undefined;
}

export function mergeApprovalContextSeed(
  current: ApprovalContextSeed,
  fallback?: ApprovalContextSeed,
): ApprovalContextSeed {
  const preferredChannelProfile = current.channelProfile && current.channelProfile !== "other"
    ? current.channelProfile
    : fallback?.channelProfile;
  const preferredApprovalTransport = current.approvalTransport && current.approvalTransport !== "none"
    ? current.approvalTransport
    : fallback?.approvalTransport;

  return {
    channelProfile: preferredChannelProfile ?? current.channelProfile,
    approvalTransport: preferredApprovalTransport ?? current.approvalTransport,
    sessionKey: current.sessionKey ?? fallback?.sessionKey,
    requesterId: current.requesterId ?? fallback?.requesterId,
    requesterOuId: current.requesterOuId ?? fallback?.requesterOuId,
    accountId: current.accountId ?? fallback?.accountId,
    conversationId: current.conversationId ?? fallback?.conversationId,
    threadId: current.threadId ?? fallback?.threadId,
    isGroup: current.isGroup === true || fallback?.isGroup === true,
  };
}

function hasFeishuApprovalFallbackContext(
  seed: ApprovalContextSeed | undefined,
  approverOuIds: string[],
): boolean {
  const requesterOuId = normalizeOuId(seed?.requesterOuId ?? seed?.requesterId);
  if (!requesterOuId || !approverOuIds.includes(requesterOuId)) {
    return false;
  }
  const conversationId = normalizeFeishuConversationId(
    seed?.conversationId,
    requesterOuId,
    seed?.isGroup,
  );
  return Boolean(requesterOuId && conversationId);
}

export function buildToolApprovalRoute(params: {
  ctx: any;
  currentApprovalContext: ApprovalContextSeed;
  recoveredFeishuApprovalContext?: ApprovalContextSeed;
  approverOuIds: string[];
}): ResolvedToolApprovalRoute {
  const currentChannelProfile = params.currentApprovalContext.channelProfile
    ?? resolveChannelProfile(params.ctx?.messageProvider ?? params.ctx?.channelId ?? params.ctx?.channel);
  const currentChannelId = normalizeString(params.ctx?.channelId ?? params.ctx?.channel)
    || (currentChannelProfile === "other" ? undefined : currentChannelProfile);
  const currentRequesterOuId = normalizeOuId(
    params.currentApprovalContext.requesterOuId
    ?? params.currentApprovalContext.requesterId
    ?? params.ctx?.senderOpenId
    ?? params.ctx?.senderId
    ?? params.ctx?.userId,
  );
  const currentConversationId = currentChannelProfile === "feishu"
    ? normalizeFeishuConversationId(
        params.currentApprovalContext.conversationId
        ?? normalizeString(params.ctx?.conversationId)
        ?? normalizeString(params.ctx?.to)
        ?? normalizeString(params.ctx?.recipientId),
        currentRequesterOuId,
        params.currentApprovalContext.isGroup || params.ctx?.isGroup === true,
      )
    : (params.currentApprovalContext.conversationId
      ?? normalizeString(params.ctx?.conversationId)
      ?? normalizeString(params.ctx?.to)
      ?? normalizeString(params.ctx?.recipientId));
  const compatDecision = resolvePluginApprovalCompat({
    currentChannelProfile,
    hasFeishuApproverRoute: params.approverOuIds.length > 0,
    hasFeishuFallbackContext: hasFeishuApprovalFallbackContext(
      params.recoveredFeishuApprovalContext,
      params.approverOuIds,
    ),
  });

  if (compatDecision.mode === "feishu-local") {
    const feishuSeed = currentChannelProfile === "feishu"
      ? {
          ...params.currentApprovalContext,
          sessionKey: params.currentApprovalContext.sessionKey
            ?? (normalizeString(params.ctx?.sessionKey) || undefined),
          requesterOuId: currentRequesterOuId ?? params.currentApprovalContext.requesterOuId,
          conversationId: currentConversationId ?? params.currentApprovalContext.conversationId,
          accountId: params.currentApprovalContext.accountId
            ?? (normalizeString(params.ctx?.accountId) || undefined),
          threadId: params.currentApprovalContext.threadId ?? params.ctx?.threadId,
          isGroup: params.currentApprovalContext.isGroup || params.ctx?.isGroup === true,
        }
      : params.recoveredFeishuApprovalContext;
    const requesterOuId = normalizeOuId(
      feishuSeed?.requesterOuId
      ?? feishuSeed?.requesterId
      ?? params.ctx?.senderOpenId
      ?? params.ctx?.senderId,
    );
    const conversationId = normalizeFeishuConversationId(
      feishuSeed?.conversationId,
      requesterOuId,
      feishuSeed?.isGroup,
    );

    if (requesterOuId && conversationId) {
      return {
        compatMode: compatDecision.mode,
        blockReason: compatDecision.blockReason,
        approvalCtx: {
          ...params.ctx,
          sessionKey: feishuSeed?.sessionKey,
          channelId: "feishu",
          channel: "feishu",
          messageProvider: "feishu",
          source: "feishu",
          senderId: requesterOuId,
          senderOpenId: requesterOuId,
          userId: requesterOuId,
          conversationId,
          to: conversationId,
          recipientId: conversationId,
          accountId: feishuSeed?.accountId
            ?? (normalizeString(params.ctx?.accountId) || undefined),
          threadId: feishuSeed?.threadId ?? params.ctx?.threadId,
          isGroup: feishuSeed?.isGroup === true,
        },
        channelProfile: "feishu",
        channelId: "feishu",
        approvalTransport: "local-chat",
        sessionKey: feishuSeed?.sessionKey,
        requesterOuId,
        accountId: feishuSeed?.accountId
          ?? (normalizeString(params.ctx?.accountId) || undefined),
        conversationId,
        threadId: feishuSeed?.threadId ?? params.ctx?.threadId,
        runtimeVersion: compatDecision.runtimeVersion,
        runtimeTier: compatDecision.runtimeTier,
      };
    }
  }

  return {
    compatMode: compatDecision.mode === "feishu-local" ? "deny-no-route" : compatDecision.mode,
    blockReason: compatDecision.mode === "feishu-local"
      ? "[Lynx Guardian] No usable Feishu approval route is available for this request. Upgrade OpenClaw or configure Feishu approval."
      : compatDecision.blockReason,
    approvalCtx: params.ctx,
    channelProfile: currentChannelProfile,
    channelId: currentChannelId,
    approvalTransport: compatDecision.transport,
    sessionKey: params.currentApprovalContext.sessionKey
      ?? (normalizeString(params.ctx?.sessionKey) || undefined),
    requesterOuId: currentRequesterOuId ?? params.currentApprovalContext.requesterOuId,
    accountId: params.currentApprovalContext.accountId
      ?? (normalizeString(params.ctx?.accountId) || undefined),
    conversationId: currentConversationId ?? params.currentApprovalContext.conversationId,
    threadId: params.currentApprovalContext.threadId ?? params.ctx?.threadId,
    runtimeVersion: compatDecision.runtimeVersion,
    runtimeTier: compatDecision.runtimeTier,
  };
}

export function parseLocalToolApprovalReply(text: string): {
  command: "lynx-approve";
  token?: string;
  resolution: Extract<ToolApprovalResolution, "allow-once" | "deny">;
} | null {
  const variants = buildPromptIntentVariants(text);
  for (const variant of variants) {
    const legacyMatch = variant.match(
      /(?:^|\s)\/lynx-approve(?:\s+([a-z0-9]+))?\s+(allow-once|deny)(?=$|\s)/i,
    );
    if (legacyMatch) {
      return {
        command: "lynx-approve",
        token: legacyMatch[1]?.toLowerCase(),
        resolution: legacyMatch[2].toLowerCase() as Extract<ToolApprovalResolution, "allow-once" | "deny">,
      };
    }
  }

  return null;
}
