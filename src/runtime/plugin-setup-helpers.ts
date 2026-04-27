import { writeFileSync } from "fs";
import type {
  LynxReportDeliveryAttempt,
  ToolApprovalResolution,
} from "../types.js";
import { buildGuardContext, normalizeString } from "./plugin-runtime-helpers.js";
import {
  LOCAL_TOOL_APPROVAL_COMMAND,
  normalizeFeishuConversationId,
  normalizeOuId,
  resolveActorOuId,
  resolveChannelApprovalTransport,
  resolveChannelProfile,
} from "./plugin-entry-helpers.js";
import {
  discardLocalToolApproval,
  listLocalToolApprovalsForSession,
  readLocalToolApprovalByToken,
  registerLocalToolApproval,
} from "./local-tool-approval-store.js";
import {
  consumeFeishuLocalApprovalGrant,
  saveFeishuLocalApprovalGrant,
} from "./feishu-local-approval-grant-store.js";
import {
  consumeFeishuLocalApprovalReplay,
  saveFeishuLocalApprovalReplay,
} from "./feishu-local-approval-replay-store.js";
import {
  matchFeishuRunContinuation,
  saveFeishuRunContinuation,
} from "./feishu-run-continuation-store.js";
import {
  clearRecentActiveDeliveryTargetForContext,
  getRecentActiveDeliveryTargets,
  readRecentActiveDeliverySnapshot,
  rememberRecentActiveDeliveryTarget,
} from "./recent-active-delivery.js";
import type {
  RecentActiveDeliverySnapshot,
  RecentActiveDeliveryTarget,
} from "./recent-active-delivery.js";
import { deliverLynxReport } from "./lynx-message-delivery.js";
import {
  readLatestPendingLynxCheckRunIntent,
} from "./lynx-check-run-store.js";
import { deliverLynxFeishuApprovalPromptDirectly } from "./lynx-feishu-direct-delivery.js";
import { buildApprovalRequestFingerprint } from "./approval-request-fingerprint.js";
import { persistGrantFromApproval } from "./tool-approval-runtime.js";
import { buildParamSummary } from "./policy-runtime.js";
import { hasManagedLynxCheckAuthorization } from "./managed-lynx-check-authorization-store.js";
import { appendLocalConsoleWebviewFootnote } from "./local-console-webview-note.js";
import { shouldSkipRoutineHeartbeatProbe } from "./local-console-heartbeat-filter.js";
import { ensureParentDirectory } from "../discovery/pending-discovery-store.js";

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

export function resolveToolApprovalProtectedTargetSummary(
  toolName: string,
  params: Record<string, any> | undefined,
): string {
  const rawPath = normalizeString(params?.file_path ?? params?.path);
  if (rawPath) {
    return rawPath.replace(/\s+/g, " ");
  }

  const command = normalizeString(params?.command);
  if (command) {
    return command.replace(/\s+/g, " ");
  }

  return buildParamSummary(toolName, params ?? {}).replace(/\s+/g, " ");
}

export function extractApproveCommand(text: string): {
  approvalId: string;
  allowDecision?: string;
  denyDecision?: string;
} | null {
  const match = normalizeString(text).match(
    /\/approve\s+([a-z0-9-]+)\s+([a-z-]+(?:\|[a-z-]+)*)/i,
  );
  if (!match) {
    return null;
  }

  const approvalId = match[1];
  const allowedDecisions = match[2]
    .split("|")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return {
    approvalId,
    allowDecision: allowedDecisions.find((value) => value === "allow-once")
      ?? allowedDecisions.find((value) => value.startsWith("allow-")),
    denyDecision: allowedDecisions.find((value) => value === "deny"),
  };
}

export function appendFeishuNativeApprovalGuidance(text: string): string {
  if (
    text.includes("请在 Feishu 会话回复或webchat中进行审批")
    || text.includes("请直接在当前飞书会话回复")
  ) {
    return text;
  }

  const approveCommand = extractApproveCommand(text);
  if (!approveCommand) {
    return text;
  }

  const lines = [
    text.trimEnd(),
    "",
    "飞书审批提示：",
    "请在 Feishu 会话回复或webchat中进行审批。",
    approveCommand.allowDecision
      ? `如在 Feishu 审批，请回复 \`/approve ${approveCommand.approvalId} ${approveCommand.allowDecision}\`。`
      : "",
    approveCommand.denyDecision
      ? `如需拒绝，回复 \`/approve ${approveCommand.approvalId} ${approveCommand.denyDecision}\`。`
      : "",
    "如在 webchat 审批，可直接在审批窗口中批准或拒绝。",
    "不要再使用 `/lynx-approve`。",
  ].filter(Boolean);

  return appendLocalConsoleWebviewFootnote(lines.join("\n"));
}

export function buildFeishuNativeToolApprovalReplyPrompt(params: {
  approvalId: string;
  module: string;
  riskLevel: string;
  toolName: string;
  timeoutMs: number;
  confirmationPhrase: string;
}): string {
  const timeoutSeconds = Math.max(1, Math.round(params.timeoutMs / 1000));
  const prompt = [
    `[Lynx Guardian] ${params.toolName} 已进入原生审批窗口。`,
    `模块: ${params.module}`,
    `风险: ${params.riskLevel}`,
    `请在 ${timeoutSeconds}s 内在 Feishu 会话回复或webchat中进行审批：`,
    `/approve ${params.approvalId} allow-once`,
    `/approve ${params.approvalId} deny`,
    `如果你之前习惯回复“${params.confirmationPhrase}”，本次请直接回复上面的 /approve 命令，或在 webchat 中完成审批。`,
    "如使用 Feishu，请直接回复上面的 /approve 命令。",
  ].join("\n");

  return params.riskLevel === "L3"
    ? appendLocalConsoleWebviewFootnote(prompt)
    : prompt;
}

function isPluginSubsystem(ctx: any): boolean {
  return normalizeString(ctx?.subsystem).toLowerCase() === "plugins";
}

function isCronManagedLynxCheckContext(ctx: any): boolean {
  const trigger = normalizeString(ctx?.trigger).toLowerCase();
  if (trigger === "cron") {
    return true;
  }

  const sessionKey = normalizeString(ctx?.sessionKey).toLowerCase();
  return sessionKey.startsWith("cron:") || sessionKey.includes(":cron:");
}

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
    normalizeString(ctx?.messageProvider),
    normalizeString(ctx?.channelId),
    normalizeString(ctx?.source),
    normalizeString(routeHint?.messageProvider),
    normalizeString(routeHint?.channelId),
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

export function resolveDeliveryThreadId(value: any): string | number | undefined {
  return typeof value?.messageThreadId === "number" && Number.isFinite(value.messageThreadId)
    ? value.messageThreadId
    : typeof value?.threadId === "number" && Number.isFinite(value.threadId)
      ? value.threadId
      : normalizeString(value?.messageThreadId ?? value?.threadId) || undefined;
}

export function buildDeliveryTargetSnapshot(value: any): Partial<RecentActiveDeliverySnapshot> {
  return {
    sessionKey: normalizeString(value?.sessionKey) || undefined,
    channelId: normalizeString(value?.channelId ?? value?.channel) || undefined,
    messageProvider: normalizeString(value?.messageProvider ?? value?.source) || undefined,
    senderId: normalizeString(value?.senderId ?? value?.userId) || undefined,
    bindingId: normalizeString(value?.bindingId) || undefined,
    to: normalizeString(value?.to ?? value?.recipientId) || undefined,
    accountId: normalizeString(value?.accountId) || undefined,
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
    bindingId: normalizeString(event?.bindingId) || currentTarget.bindingId,
    to: normalizeString(event?.to) || currentTarget.to,
    accountId: normalizeString(event?.accountId) || currentTarget.accountId,
    threadId: resolveDeliveryThreadId(event) ?? currentTarget.threadId,
  };
}

type CreatePluginSetupHelpersParams = {
  config: any;
  hookProbeLogPath: string;
  localApprovalApproverOuIds: string[];
  log: {
    error: (message: string) => void;
    info: (message: string) => void;
    warn: (message: string) => void;
  };
  managedLynxCheckAuthorizationConfig: any;
  riskPolicyConfig: any;
  scheduledLynxCheckConfig: any;
};

export function createPluginSetupHelpers(params: CreatePluginSetupHelpersParams) {
  const {
    config,
    hookProbeLogPath,
    localApprovalApproverOuIds,
    log,
    managedLynxCheckAuthorizationConfig,
    riskPolicyConfig,
    scheduledLynxCheckConfig,
  } = params;

  function isManagedLynxCheckPreauthorized(source: "manual" | "scheduled"): boolean {
    if (managedLynxCheckAuthorizationConfig.enabled === false) {
      return false;
    }
    if (
      source === "manual"
      && managedLynxCheckAuthorizationConfig.treatManualLynxCheckAsPreauthorized === false
    ) {
      return false;
    }
    return hasManagedLynxCheckAuthorization();
  }

  function buildScheduledLynxCheckSyncConfig() {
    return {
      ...scheduledLynxCheckConfig,
      autoGrantManagedAuthorization:
        managedLynxCheckAuthorizationConfig.autoGrantOnScheduledJobCreate !== false,
    };
  }

  function appendLifecycleProbe(hookName: string, payload: unknown, ctx: unknown): void {
    try {
      if (shouldSkipRoutineHeartbeatProbe(hookName, payload, ctx)) {
        return;
      }
      ensureParentDirectory(hookProbeLogPath);
      writeFileSync(
        hookProbeLogPath,
        `${JSON.stringify({ hookName, payload, ctx, timestamp: new Date().toISOString() })}\n`,
        { encoding: "utf8", flag: "a" },
      );
    } catch (err: any) {
      log.error(`[lynx-guardian] Failed to append lifecycle probe: ${err.message}`);
    }
  }

  async function sendHookFeedback(ctx: any, content: string): Promise<void> {
    if (typeof ctx?.sendMessage !== "function" || content.trim().length === 0) {
      return;
    }

    try {
      await ctx.sendMessage({
        role: "assistant",
        content,
      });
    } catch (err: any) {
      log.warn(`[lynx-guardian] Failed to send hook feedback: ${err.message}`);
    }
  }

  function resolveLocalToolApprovalReply(params: {
    event: any;
    ctx: any;
    localApprovalReply: {
      command: "approve" | "lynx-approve";
      token?: string;
      resolution: Extract<ToolApprovalResolution, "allow-once" | "deny">;
    };
  }): { handled: boolean; replyText?: string } {
    const sessionKey = normalizeString(params.ctx.sessionKey) || undefined;
    const actorOuId = resolveActorOuId(params.event, params.ctx);
    if (!actorOuId) {
      return {
        handled: true,
        replyText: "[Lynx Guardian] 当前审批只接受带 ou_id 的飞书回复。",
      };
    }

    let localApproval = params.localApprovalReply.token
      ? readLocalToolApprovalByToken(params.localApprovalReply.token)
      : undefined;

    if (!localApproval) {
      const candidates = listLocalToolApprovalsForSession({ sessionKey });
      if (!params.localApprovalReply.token && candidates.length === 1) {
        [localApproval] = candidates;
      } else if (!params.localApprovalReply.token && candidates.length > 1) {
        return {
          handled: true,
          replyText: `[Lynx Guardian] 当前有多个待审批操作，请使用完整命令：${LOCAL_TOOL_APPROVAL_COMMAND} <token> allow-once|deny`,
        };
      }
    }

    if (!localApproval) {
      return {
        handled: true,
        replyText: "[Lynx Guardian] 当前没有待审批操作或审批已过期。",
      };
    }

    if (localApproval.sessionKey && sessionKey && localApproval.sessionKey !== sessionKey) {
      return {
        handled: true,
        replyText: "[Lynx Guardian] 当前没有待审批操作或审批已过期。",
      };
    }

    const currentConversationId = normalizeFeishuConversationId(
      normalizeString(params.ctx?.conversationId ?? params.event?.conversationId) || undefined,
      localApproval.requesterOuId ?? actorOuId,
      params.ctx?.isGroup === true || params.event?.isGroup === true,
    );
    const currentAccountId = normalizeString(params.ctx?.accountId) || undefined;
    if (
      localApproval.conversationId
      && currentConversationId
      && localApproval.conversationId !== currentConversationId
    ) {
      return {
        handled: true,
        replyText: "[Lynx Guardian] Approval not found or expired.",
      };
    }
    if (localApproval.accountId && currentAccountId && localApproval.accountId !== currentAccountId) {
      return {
        handled: true,
        replyText: "[Lynx Guardian] Approval not found or expired.",
      };
    }

    if (!canActorResolveLocalToolApproval(actorOuId, localApproval)) {
      return {
        handled: true,
        replyText: "[Lynx Guardian] 当前回复的 ou_id 不在本地审批 owner/approver 列表中，无法批准这次操作。",
      };
    }

    log.info(
      `[lynx-guardian] Local tool approval resolved token=${localApproval.approvalToken} decision=${params.localApprovalReply.resolution} actor=${actorOuId}`,
    );
    localApproval.resolve(params.localApprovalReply.resolution);
    return {
      handled: true,
      replyText: params.localApprovalReply.resolution === "deny"
        ? "[Lynx Guardian] 已拒绝本次操作。"
        : "[Lynx Guardian] 已批准本次操作，原工具调用将继续执行。",
    };
  }

  async function tryResolveLocalToolApprovalReply(params: {
    event: any;
    ctx: any;
    localApprovalReply: {
      command: "approve" | "lynx-approve";
      token?: string;
      resolution: Extract<ToolApprovalResolution, "allow-once" | "deny">;
    };
  }): Promise<{ handled: boolean; blockReason?: string }> {
    if (params.localApprovalReply.command === "approve") {
      return { handled: false };
    }

    const resolution = resolveLocalToolApprovalReply(params);
    if (resolution.handled) {
      if (resolution.replyText) {
        await sendHookFeedback(params.ctx, resolution.replyText);
      }
      return { handled: true, blockReason: "[Lynx Guardian] Local approval reply consumed." };
    }

    return { handled: false };
  }

  function resolveFeishuLocalToolApprovalReply(params: {
    event: any;
    ctx: any;
    localApprovalReply: {
      command: "lynx-approve";
      token?: string;
      resolution: Extract<ToolApprovalResolution, "allow-once" | "deny">;
    };
  }): { handled: boolean; replyText?: string } {
    const channelProfile = resolveChannelProfile(
      params.ctx?.messageProvider
      ?? params.ctx?.channelId
      ?? params.ctx?.channel
      ?? params.event?.channel,
    );
    if (channelProfile !== "feishu") {
      return { handled: false };
    }

    const sessionKey = normalizeString(params.ctx.sessionKey) || undefined;
    const actorOuId = resolveActorOuId(params.event, params.ctx);
    if (!actorOuId) {
      return {
        handled: true,
        replyText: "[Lynx Guardian] 当前审批只接受带 Feishu ou_id 的回复。",
      };
    }

    let localApproval = params.localApprovalReply.token
      ? readLocalToolApprovalByToken(params.localApprovalReply.token)
      : undefined;

    if (!localApproval) {
      const candidates = listLocalToolApprovalsForSession({ sessionKey });
      if (!params.localApprovalReply.token && candidates.length === 1) {
        [localApproval] = candidates;
      } else if (!params.localApprovalReply.token && candidates.length > 1) {
        return {
          handled: true,
          replyText: `[Lynx Guardian] 当前有多个待审批操作，请使用完整命令：${LOCAL_TOOL_APPROVAL_COMMAND} <token> allow-once|deny`,
        };
      }
    }

    if (!localApproval) {
      return {
        handled: true,
        replyText: "[Lynx Guardian] 当前没有待审批操作，或审批已过期。",
      };
    }

    const currentConversationId = normalizeFeishuConversationId(
      normalizeString(params.ctx?.conversationId ?? params.event?.conversationId) || undefined,
      localApproval.requesterOuId ?? actorOuId,
      params.ctx?.isGroup === true || params.event?.isGroup === true,
    );
    const currentAccountId = normalizeString(params.ctx?.accountId) || undefined;
    if (localApproval.sessionKey && sessionKey && localApproval.sessionKey !== sessionKey) {
      return {
        handled: true,
        replyText: "[Lynx Guardian] 当前没有待审批操作，或审批已过期。",
      };
    }

    if (!canActorResolveLocalToolApproval(actorOuId, localApproval)) {
      return {
        handled: true,
        replyText: "[Lynx Guardian] 当前回复的 ou_id 不是受信 owner，无法批准这次操作。",
      };
    }

    log.info(
      `[lynx-guardian] Local tool approval resolved token=${localApproval.approvalToken} decision=${params.localApprovalReply.resolution} actor=${actorOuId}`,
    );
    if (params.localApprovalReply.resolution === "allow-once" && !localApproval.requestFingerprint) {
      localApproval.resolve("deny");
      return {
        handled: true,
        replyText: "[Lynx Guardian] 当前审批上下文不完整，请重新发起请求。",
      };
    }
    if (params.localApprovalReply.resolution === "allow-once" && localApproval.requestFingerprint) {
      const createdAt = Date.now();
      saveFeishuLocalApprovalGrant({
        grantId: `${localApproval.pendingId}:${localApproval.approvalToken}:${createdAt}`,
        channelProfile: "feishu",
        channelId: localApproval.channelId,
        accountId: localApproval.accountId,
        conversationId: localApproval.conversationId,
        requesterOuId: localApproval.requesterOuId,
        module: localApproval.module,
        maxRiskLevel: localApproval.maxRiskLevel,
        requestFingerprint: localApproval.requestFingerprint,
        grantedByOuId: actorOuId,
        createdAt,
        expiresAt: createdAt + riskPolicyConfig.grantWindowMs,
        sourceApprovalId: localApproval.pendingId,
      });
      if (localApproval.promptText?.trim()) {
        saveFeishuLocalApprovalReplay({
          approvalToken: localApproval.approvalToken,
          sessionKey: localApproval.sessionKey,
          requesterOuId: localApproval.requesterOuId,
          accountId: currentAccountId ?? localApproval.accountId,
          conversationId: currentConversationId ?? localApproval.conversationId,
          promptText: localApproval.promptText,
          createdAt,
          expiresAt: createdAt + riskPolicyConfig.grantWindowMs,
        });
      }
    }
    localApproval.resolve(params.localApprovalReply.resolution);
    if (params.localApprovalReply.resolution === "allow-once" && localApproval.promptText?.trim()) {
      return {
        handled: false,
        replyText: "[Lynx Guardian] 已批准本次操作，正在继续执行刚才的请求。",
      };
    }
    return {
      handled: true,
      replyText: params.localApprovalReply.resolution === "deny"
        ? "[Lynx Guardian] 已拒绝本次操作。"
        : "[Lynx Guardian] 已批准本次操作。请原请求人在当前 Feishu 会话重新发送刚才的请求。",
    };
  }

  async function tryResolveFeishuLocalToolApprovalReply(params: {
    event: any;
    ctx: any;
    localApprovalReply: {
      command: "lynx-approve";
      token?: string;
      resolution: Extract<ToolApprovalResolution, "allow-once" | "deny">;
    };
  }): Promise<{ handled: boolean; blockReason?: string }> {
    const resolution = resolveFeishuLocalToolApprovalReply(params);
    if (resolution.handled) {
      if (resolution.replyText) {
        await sendHookFeedback(params.ctx, resolution.replyText);
      }
      return { handled: true, blockReason: "[Lynx Guardian] Local approval reply consumed." };
    }

    return { handled: false };
  }

  function shouldPreferNativeToolApproval(
    ctx: any,
    preferredTransport?: "native" | "local-chat" | "none",
  ): boolean {
    const resolvedTransport = preferredTransport ?? resolveChannelApprovalTransport(
      resolveChannelProfile(ctx?.messageProvider ?? ctx?.channelId ?? ctx?.channel),
    );
    if (resolvedTransport === "native") {
      return true;
    }
    if (resolvedTransport === "local-chat") {
      return false;
    }
    return true;
  }

  function canActorResolveLocalToolApproval(
    actorOuId: string,
    approval: { approverOuIds?: string[] },
  ): boolean {
    return (approval.approverOuIds ?? []).includes(actorOuId);
  }

  function buildFeishuLocalToolApprovalPrompt(params: {
    approvalToken: string;
    module: string;
    riskLevel: string;
    toolName: string;
    timeoutMs: number;
  }): string {
    const timeoutSeconds = Math.max(1, Math.round(params.timeoutMs / 1000));
    const prompt = [
      `[Lynx Guardian] 工具 ${params.toolName} 需要 owner 审批。`,
      `模块: ${params.module}`,
      `风险: ${params.riskLevel}`,
      `请在 ${timeoutSeconds}s 内由 owner 在当前 Feishu 会话直接回复以下任一命令：`,
      `${LOCAL_TOOL_APPROVAL_COMMAND} ${params.approvalToken} allow-once`,
      `${LOCAL_TOOL_APPROVAL_COMMAND} ${params.approvalToken} deny`,
      "仅接受已配置 owner/approver 的 Feishu ou_id 审批回复。",
      "审批通过后会自动继续执行刚才的请求，无需重新发送。",
    ].join("\n");

    return params.riskLevel === "L3"
      ? appendLocalConsoleWebviewFootnote(prompt)
      : prompt;
  }

  function buildFeishuLocalApprovalPendingBlockReason(params: {
    approvalToken: string;
    toolName: string;
    module: string;
    riskLevel: string;
  }): string {
    const blockReason = [
      `[Lynx Guardian] ${params.toolName} 正在等待 owner 审批。`,
      `模块: ${params.module}`,
      `风险: ${params.riskLevel}`,
      `请让 owner 在当前 Feishu 会话回复：${LOCAL_TOOL_APPROVAL_COMMAND} ${params.approvalToken} allow-once`,
      `如需拒绝：${LOCAL_TOOL_APPROVAL_COMMAND} ${params.approvalToken} deny`,
      "审批通过后会自动继续执行刚才的请求，无需重新发送。",
    ].join("\n");

    return params.riskLevel === "L3"
      ? appendLocalConsoleWebviewFootnote(blockReason)
      : blockReason;
  }

  function buildFeishuApprovedReplayContext(params: {
    promptText: string;
    requesterOuId?: string;
    conversationId?: string;
  }): string {
    return [
      "[Lynx Guardian] 当前用户消息是一次已验证通过的 Feishu 审批回复。",
      "不要解释审批命令，不要要求重新发送请求，也不要把当前用户消息当作真实业务请求来回答。",
      `现在请直接继续执行刚刚已经批准的原始请求：${params.promptText}`,
      params.requesterOuId ? `该原始请求对应的 requester ou_id: ${params.requesterOuId}` : "",
      params.conversationId ? `该原始请求对应的会话标识: ${params.conversationId}` : "",
      "如果后续动作命中了新的、更高风险或不同模块的审批条件，继续按照正常安全策略处理。",
      "在可以完成时，直接输出该原始请求的正常结果，不要再讨论审批过程。",
    ].filter(Boolean).join("\n");
  }

  async function handleFeishuLocalToolApproval(params: {
    ctx: any;
    channelProfile?: "webchat" | "feishu" | "other";
    channelId?: string;
    requesterOuId?: string;
    conversationId?: string;
    accountId?: string;
    approverOuIds: string[];
    approvalId: string;
    toolName: string;
    module: string;
    riskLevel: "L2" | "L3";
    promptText?: string;
    protectedTargetSummary?: string;
    timeoutMs: number;
    grantWindowMs: number;
    approvalSessionKey?: string;
  }): Promise<{ handled: boolean; blockReason?: string }> {
    if (params.channelProfile !== "feishu") {
      return { handled: false };
    }

    const requestFingerprint = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: params.accountId,
      conversationId: params.conversationId,
      requesterOuId: params.requesterOuId,
      promptText: params.promptText,
      toolName: params.toolName,
      module: params.module,
      protectedTargetSummary: params.protectedTargetSummary,
    });

    const continuation = matchFeishuRunContinuation({
      runId: normalizeString(params.ctx?.runId) || undefined,
      channelProfile: "feishu",
      requesterOuId: params.requesterOuId,
      module: params.module,
      riskLevel: params.riskLevel,
    });
    if (continuation) {
      log.info(
        `[lynx-guardian] feishu continuation hit run=${continuation.runId} module=${params.module} risk=${params.riskLevel}`,
      );
      return { handled: true };
    }

    const grant = consumeFeishuLocalApprovalGrant({
      channelProfile: "feishu",
      channelId: params.channelId,
      accountId: params.accountId,
      conversationId: params.conversationId,
      requesterOuId: params.requesterOuId,
      module: params.module,
      riskLevel: params.riskLevel,
      requestFingerprint,
    });
    if (grant) {
      const runId = normalizeString(params.ctx?.runId) || undefined;
      if (runId) {
        const createdAt = Date.now();
        saveFeishuRunContinuation({
          runId,
          channelProfile: "feishu",
          requesterOuId: params.requesterOuId,
          module: params.module,
          maxRiskLevel: grant.maxRiskLevel,
          createdAt,
          expiresAt: createdAt + params.grantWindowMs,
        });
      }
      log.info(
        `[lynx-guardian] feishu retry grant consumed module=${params.module} risk=${params.riskLevel} fingerprint=${requestFingerprint.slice(0, 12)}`,
      );
      return { handled: true };
    }

    if (params.approverOuIds.length === 0) {
      return {
        handled: true,
        blockReason: "[Lynx Guardian] 飞书审批人未配置，无法放行本次操作。",
      };
    }

    const localApproval = registerLocalToolApproval({
      pendingId: params.approvalId,
      sessionKey: params.approvalSessionKey,
      channelProfile: "feishu",
      channelId: params.channelId,
      accountId: params.accountId,
      requesterOuId: params.requesterOuId,
      requestFingerprint,
      approverOuIds: params.approverOuIds,
      conversationId: params.conversationId,
      module: params.module,
      riskLevel: params.riskLevel,
      toolName: params.toolName,
      promptText: params.promptText,
      timeoutMs: params.timeoutMs,
      onResolution: (_resolution) => {},
    });

    if (!localApproval.approval) {
      return {
        handled: true,
        blockReason: "[Lynx Guardian] 当前飞书审批不可用，已拒绝本次操作。",
      };
    }

    return {
      handled: true,
      blockReason: buildFeishuLocalApprovalPendingBlockReason({
        approvalToken: localApproval.approval.approvalToken,
        toolName: params.toolName,
        module: params.module,
        riskLevel: params.riskLevel,
      }),
    };
  }

  function buildLocalToolApprovalDeliveryRouteHint(params: {
    ctx: any;
    approvalId: string;
    preferredTransport?: "native" | "local-chat" | "none";
    requesterOuId?: string;
    conversationId?: string;
    accountId?: string;
    threadId?: string | number;
  }): RecentActiveDeliverySnapshot | null {
    const channelId = normalizeString(params.ctx?.channelId ?? params.ctx?.channel)
      || (params.preferredTransport === "local-chat" ? "feishu" : undefined);
    const messageProvider = normalizeString(params.ctx?.messageProvider ?? params.ctx?.source)
      || channelId
      || undefined;
    const senderId = normalizeString(
      params.requesterOuId
      ?? params.ctx?.senderId
      ?? params.ctx?.senderOpenId
      ?? params.ctx?.userId,
    ) || undefined;
    const rawTo = normalizeString(
      params.conversationId
      ?? params.ctx?.conversationId
      ?? params.ctx?.to
      ?? params.ctx?.recipientId,
    ) || undefined;
    const channelProfile = resolveChannelProfile(messageProvider ?? channelId);
    const to = channelProfile === "feishu"
      ? normalizeFeishuConversationId(
          rawTo,
          normalizeOuId(senderId ?? params.requesterOuId),
          params.ctx?.isGroup === true,
        )
      : rawTo;
    const accountId = normalizeString(params.accountId ?? params.ctx?.accountId) || undefined;
    const threadId = params.threadId ?? resolveDeliveryThreadId(params.ctx);
    const sessionKey = normalizeString(params.ctx?.sessionKey) || undefined;
    const targetToken = to ?? senderId ?? sessionKey;

    if (!targetToken || (!channelId && !messageProvider)) {
      return null;
    }

    return {
      targetKey: [
        messageProvider ?? channelId,
        channelId ?? messageProvider,
        targetToken,
      ].filter(Boolean).join(":") || `tool-approval:${params.approvalId}`,
      sessionKey: to ? undefined : sessionKey,
      channelId,
      messageProvider,
      senderId,
      to,
      accountId,
      threadId,
      updatedAtMs: Date.now(),
    };
  }

  function matchesApprovalDeliveryRoute(
    target: RecentActiveDeliveryTarget,
    routeHint: RecentActiveDeliverySnapshot | null,
    ctx: any,
  ): boolean {
    const sessionKey = normalizeString(routeHint?.sessionKey ?? ctx?.sessionKey);
    if (sessionKey && normalizeString(target.sessionKey) === sessionKey) {
      return true;
    }

    const targetKey = normalizeString(routeHint?.targetKey);
    if (targetKey && normalizeString(target.targetKey) === targetKey) {
      return true;
    }

    const routeChannelId = normalizeString(routeHint?.channelId ?? ctx?.channelId ?? ctx?.channel);
    const routeProvider = normalizeString(routeHint?.messageProvider ?? ctx?.messageProvider ?? ctx?.source);
    const matchesChannel = !routeChannelId || normalizeString(target.channelId) === routeChannelId;
    const matchesProvider = !routeProvider || normalizeString(target.messageProvider) === routeProvider;
    if (!matchesChannel || !matchesProvider) {
      return false;
    }

    const routeTo = normalizeString(routeHint?.to ?? ctx?.to ?? ctx?.recipientId ?? ctx?.conversationId);
    if (routeTo && normalizeString(target.to) === routeTo) {
      return true;
    }

    const routeSenderId = normalizeString(routeHint?.senderId ?? ctx?.senderId ?? ctx?.senderOpenId ?? ctx?.userId);
    if (routeSenderId && normalizeString(target.senderId) === routeSenderId) {
      return true;
    }

    const routeAccountId = normalizeString(routeHint?.accountId ?? ctx?.accountId);
    const routeThreadId = normalizeString(routeHint?.threadId ?? ctx?.threadId ?? ctx?.messageThreadId);
    if (
      routeAccountId
      && routeThreadId
      && normalizeString(target.accountId) === routeAccountId
      && normalizeString(target.threadId) === routeThreadId
    ) {
      return true;
    }

    return false;
  }

  async function sendAssistantMessageWithRetry(options: {
    ctx: any;
    tag: string;
    message: {
      role: "assistant";
      content: any;
    };
    attempts?: number;
    routeHint?: RecentActiveDeliverySnapshot | null;
    allowSameSessionFallback?: boolean;
    useSessionStoreFallback?: boolean;
  }): Promise<{
    delivered: boolean;
    transport: string;
    deliveryAttempts: LynxReportDeliveryAttempt[];
  }> {
    const attempts = Math.max(1, options.attempts ?? 1);
    const target = describeDeliveryTarget(options.ctx);
    const payloadSummary = summarizeOutgoingMessage(options.message);
    let lastSendResult: {
      delivered: boolean;
      transport: string;
      deliveryAttempts: LynxReportDeliveryAttempt[];
    } = {
      delivered: false,
      transport: "none",
      deliveryAttempts: [],
    };

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      log.info(
        `[lynx-guardian] 【📌】${options.tag} attempt=${attempt}/${attempts} target=${target} payload=${payloadSummary}`,
      );

      lastSendResult = await deliverLynxReport({
        log,
        ctx: options.ctx,
        tag: options.tag,
        attempts: 1,
        routeHint: options.routeHint,
        allowSameSessionFallback: options.allowSameSessionFallback !== false,
        useSessionStoreFallback: options.useSessionStoreFallback === true,
        message: options.message,
      });

      if (lastSendResult.delivered) {
        log.info(
          `[lynx-guardian] 【📌】${options.tag} success attempt=${attempt}/${attempts} target=${target} transport=${lastSendResult.transport}`,
        );
        return lastSendResult;
      }

      if (attempt < attempts) {
        log.warn(
          `[lynx-guardian] 【📌】${options.tag} failed attempt=${attempt}/${attempts} target=${target} payload=${payloadSummary}`,
        );
      } else {
        log.error(
          `[lynx-guardian] 【📌】${options.tag} exhausted attempt=${attempt}/${attempts} target=${target} payload=${payloadSummary}`,
        );
      }
    }

    return lastSendResult;
  }

  async function sendLocalToolApprovalPrompt(params: {
    ctx: any;
    approvalId: string;
    preferredTransport?: "native" | "local-chat" | "none";
    requesterOuId?: string;
    conversationId?: string;
    accountId?: string;
    threadId?: string | number;
    content: string;
  }): Promise<boolean> {
    if (params.content.trim().length === 0) {
      log.warn(`[lynx-guardian] Local tool approval prompt skipped because content is empty approvalId=${params.approvalId}`);
      return false;
    }

    log.info(
      `[lynx-guardian] Local tool approval prompt start approvalId=${params.approvalId} preferredTransport=${params.preferredTransport ?? "auto"} hasCtxSendMessage=${String(typeof params.ctx?.sendMessage === "function")}`,
    );

    if (typeof params.ctx?.sendMessage === "function") {
      try {
        await params.ctx.sendMessage({
          role: "assistant",
          content: params.content,
        });
        return true;
      } catch (err: any) {
        log.warn(`[lynx-guardian] Failed to send local tool approval prompt via ctx.sendMessage: ${err.message}`);
      }
    }

    const promptChannelProfile = resolveChannelProfile(
      normalizeString(params.ctx?.messageProvider ?? params.ctx?.channelId ?? params.ctx?.channel)
      || (params.preferredTransport === "local-chat" ? "feishu" : "other"),
    );
    if (promptChannelProfile === "feishu" && params.preferredTransport === "local-chat") {
      const directConversationId = normalizeFeishuConversationId(
        params.conversationId
        ?? normalizeString(params.ctx?.conversationId)
        ?? normalizeString(params.ctx?.to)
        ?? normalizeString(params.ctx?.recipientId),
        normalizeOuId(params.requesterOuId ?? params.ctx?.senderId ?? params.ctx?.senderOpenId ?? params.ctx?.userId),
        params.ctx?.isGroup === true,
      );
      const directSendResult = await deliverLynxFeishuApprovalPromptDirectly({
        conversationId: directConversationId,
        content: params.content,
        logger: log,
      });
      log.info(
        `[lynx-guardian] Local tool approval prompt direct feishu result approvalId=${params.approvalId} delivered=${String(directSendResult.delivered)} transport=${directSendResult.transport} reason=${directSendResult.reason ?? "none"}`,
      );
      if (directSendResult.delivered) {
        return true;
      }
      return false;
    }

    const routeHint = buildLocalToolApprovalDeliveryRouteHint(params);
    if (!routeHint) {
      log.warn(`[lynx-guardian] Local tool approval prompt has no delivery route approvalId=${params.approvalId}`);
      return false;
    }
    log.info(`[lynx-guardian] Local tool approval prompt routeHint approvalId=${params.approvalId} route=${JSON.stringify(routeHint)}`);

    const sendResult = await sendAssistantMessageWithRetry({
      ctx: {
        ...params.ctx,
        channelId: routeHint.channelId ?? params.ctx?.channelId ?? params.ctx?.channel,
        messageProvider: routeHint.messageProvider ?? params.ctx?.messageProvider ?? params.ctx?.source,
        senderId: routeHint.senderId ?? params.ctx?.senderId ?? params.ctx?.userId,
        to: routeHint.to ?? params.ctx?.to ?? params.ctx?.recipientId,
        accountId: routeHint.accountId ?? params.ctx?.accountId,
        threadId: routeHint.threadId ?? params.ctx?.threadId,
      },
      tag: `tool-approval-local-prompt-${params.approvalId}`,
      attempts: 1,
      routeHint,
      allowSameSessionFallback: false,
      useSessionStoreFallback: false,
      message: {
        role: "assistant",
        content: params.content,
      },
    });

    log.info(
      `[lynx-guardian] Local tool approval prompt delivery result approvalId=${params.approvalId} delivered=${String(sendResult.delivered)} transport=${sendResult.transport}`,
    );
    return sendResult.delivered;
  }

  async function sendFeishuNativeToolApprovalPrompt(params: {
    ctx: any;
    approvalId: string;
    requesterOuId?: string;
    conversationId?: string;
    accountId?: string;
    threadId?: string | number;
    content: string;
  }): Promise<boolean> {
    return await sendLocalToolApprovalPrompt({
      ctx: params.ctx,
      approvalId: params.approvalId,
      preferredTransport: "native",
      requesterOuId: params.requesterOuId,
      conversationId: params.conversationId,
      accountId: params.accountId,
      threadId: params.threadId,
      content: params.content,
    });
  }

  function resolveOutboundPromptChannel(
    event: any,
    ctx: any,
    routeHint?: RecentActiveDeliverySnapshot | null,
  ): "webchat" | "feishu" | "generic" {
    const outboundTarget = buildOutboundDeliveryTarget(event, ctx);
    const candidates = [
      normalizeString(event?.metadata?.channel),
      normalizeString(event?.channel),
      normalizeString(outboundTarget.messageProvider),
      normalizeString(outboundTarget.channelId),
      normalizeString(ctx?.messageProvider),
      normalizeString(ctx?.channelId),
      normalizeString(ctx?.source),
      normalizeString(routeHint?.messageProvider),
      normalizeString(routeHint?.channelId),
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

  async function prepareToolApprovalHandlers(params: {
    ctx: any;
    channelProfile?: "webchat" | "feishu" | "other";
    channelId?: string;
    requesterOuId?: string;
    conversationId?: string;
    accountId?: string;
    threadId?: string | number;
    preferredTransport?: "native" | "local-chat" | "none";
    approverOuIds: string[];
    approvalId: string;
    toolName: string;
    module: string;
    riskLevel: "L2" | "L3";
    promptText?: string;
    protectedTargetSummary?: string;
    timeoutMs: number;
    grantWindowMs: number;
    pendingApproval?: {
      pending?: {
        settle: (resolution: ToolApprovalResolution) => void;
      };
    };
  }): Promise<{
    resolveApproval: (resolution: ToolApprovalResolution) => void;
    transport: "native" | "local" | "blocked";
    blockReason?: string;
  }> {
    let resolved = false;
    const resolveApproval = (resolution: ToolApprovalResolution) => {
      if (resolved) {
        return;
      }

      resolved = true;
      params.pendingApproval?.pending?.settle(resolution);
      persistGrantFromApproval({
        decision: resolution,
        approvalId: params.approvalId,
        channelProfile: params.channelProfile,
        channelId: params.channelId,
        accountId: params.accountId,
        conversationId: params.conversationId,
        requesterOuId: params.requesterOuId,
        module: params.module,
        riskLevel: params.riskLevel,
        grantWindowMs: params.grantWindowMs,
      });
    };

    if (shouldPreferNativeToolApproval(params.ctx, params.preferredTransport)) {
      return {
        resolveApproval,
        transport: "native",
      };
    }

    if (params.approverOuIds.length === 0) {
      if (params.preferredTransport === "local-chat") {
        return {
          resolveApproval,
          transport: "blocked",
          blockReason: "[Lynx Guardian] 飞书审批人未配置，无法放行本次操作。",
        };
      }
      return {
        resolveApproval,
        transport: "native",
      };
    }

    const requestFingerprint = params.channelProfile === "feishu"
      ? buildApprovalRequestFingerprint({
          channelProfile: params.channelProfile,
          accountId: params.accountId,
          conversationId: params.conversationId,
          requesterOuId: params.requesterOuId,
          promptText: params.promptText,
          toolName: params.toolName,
          module: params.module,
          protectedTargetSummary: params.protectedTargetSummary,
        })
      : undefined;

    const localApproval = registerLocalToolApproval({
      pendingId: params.approvalId,
      sessionKey: normalizeString(params.ctx?.sessionKey) || undefined,
      channelProfile: params.channelProfile,
      channelId: normalizeString(params.ctx?.channelId ?? params.ctx?.channel) || undefined,
      accountId: params.accountId,
      requesterOuId: params.requesterOuId,
      requestFingerprint,
      approverOuIds: params.approverOuIds,
      conversationId: params.conversationId,
      module: params.module,
      riskLevel: params.riskLevel,
      toolName: params.toolName,
      promptText: params.promptText,
      timeoutMs: params.timeoutMs,
      onResolution: resolveApproval,
    });

    if (localApproval.created && localApproval.approval) {
      const promptContent = buildFeishuLocalToolApprovalPrompt({
        approvalToken: localApproval.approval.approvalToken,
        module: params.module,
        riskLevel: params.riskLevel,
        toolName: params.toolName,
        timeoutMs: params.timeoutMs,
      });
      const promptDelivered = await sendLocalToolApprovalPrompt({
        ctx: params.ctx,
        approvalId: params.approvalId,
        preferredTransport: params.preferredTransport,
        requesterOuId: params.requesterOuId,
        conversationId: params.conversationId,
        accountId: params.accountId,
        threadId: params.threadId,
        content: promptContent,
      });
      if (!promptDelivered) {
        discardLocalToolApproval(localApproval.approval.approvalToken);
        resolveApproval("cancelled");
        log.warn(
          `[lynx-guardian] Local tool approval prompt delivery failed approvalId=${params.approvalId} preferredTransport=${params.preferredTransport ?? "auto"}`,
        );
        if (params.preferredTransport === "local-chat") {
          return {
            resolveApproval,
            transport: "blocked",
            blockReason: "[Lynx Guardian] 审批提示发送失败，已拒绝本次操作。",
          };
        }
        return {
          resolveApproval,
          transport: "native",
        };
      }
    }

    if (localApproval.approval) {
      return {
        resolveApproval,
        transport: "blocked",
        blockReason: buildFeishuLocalApprovalPendingBlockReason({
          approvalToken: localApproval.approval.approvalToken,
          toolName: params.toolName,
          module: params.module,
          riskLevel: params.riskLevel,
        }),
      };
    }

    if (params.preferredTransport === "local-chat") {
      return {
        resolveApproval,
        transport: "blocked",
        blockReason: "[Lynx Guardian] 当前飞书审批不可用，已拒绝本次操作。",
      };
    }

    return {
      resolveApproval,
      transport: "native",
    };
  }

  function resolveManagedLynxCheckRouteHint(
    ctx: any,
    source: "manual" | "scheduled",
  ): RecentActiveDeliverySnapshot | null {
    if (source === "manual") {
      return rememberRecentActiveDeliveryTarget(ctx) ?? readRecentActiveDeliverySnapshot();
    }

    return readRecentActiveDeliverySnapshot();
  }

  function isScheduledManagedLynxCheckCronContext(ctx: any): boolean {
    const trigger = normalizeString(ctx?.trigger).toLowerCase();
    const sessionKey = normalizeString(ctx?.sessionKey).toLowerCase();
    return trigger === "cron" || sessionKey.includes(":cron:");
  }

  function resolveActiveManagedLynxCheckState(ctx: any): {
    activeRunIntent: ReturnType<typeof readLatestPendingLynxCheckRunIntent>;
    managedLynxCheckRun: boolean;
    managedLynxCheckPreauthorized: boolean;
  } {
    const sessionKey = normalizeString(ctx?.sessionKey);
    const activeRunIntent = sessionKey
      ? readLatestPendingLynxCheckRunIntent(sessionKey)
      : null;
    const managedLynxCheckRun = activeRunIntent != null;
    const managedLynxCheckPreauthorized = activeRunIntent != null
      ? isManagedLynxCheckPreauthorized(activeRunIntent.source)
      : false;

    return {
      activeRunIntent,
      managedLynxCheckRun,
      managedLynxCheckPreauthorized,
    };
  }

  function buildManagedGuardContext(event: any, ctx: any) {
    const managedState = resolveActiveManagedLynxCheckState(ctx);
    return {
      ...managedState,
      guardContext: buildGuardContext(config, event, {
        ...ctx,
        managedLynxCheckRun: managedState.managedLynxCheckRun,
        managedLynxCheckPreauthorized: managedState.managedLynxCheckPreauthorized,
      }),
    };
  }

  return {
    appendFeishuNativeApprovalGuidance,
    appendLifecycleProbe,
    buildFeishuApprovedReplayContext,
    buildManagedGuardContext,
    buildScheduledLynxCheckSyncConfig,
    handleFeishuLocalToolApproval,
    isManagedLynxCheckPreauthorized,
    isScheduledManagedLynxCheckCronContext,
    prepareToolApprovalHandlers,
    resolveFeishuLocalToolApprovalReply,
    resolveManagedLynxCheckRouteHint,
    resolveOutboundPromptChannel,
    sendAssistantMessageWithRetry,
    sendFeishuNativeToolApprovalPrompt,
    sendHookFeedback,
    tryResolveFeishuLocalToolApprovalReply,
    tryResolveLocalToolApprovalReply,
  };
}

export {
  clearRecentActiveDeliveryTargetForContext,
  getRecentActiveDeliveryTargets,
  readRecentActiveDeliverySnapshot,
  rememberRecentActiveDeliveryTarget,
};
