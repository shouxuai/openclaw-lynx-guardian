import { join } from "path";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import type {
  LynxReportDeliveryAttempt,
  OpenClawPluginApi,
  ToolApprovalResolution,
} from "./src/types.js";
import {
  ensureUserRegistered,
  readRecentContext,
  ensureResources,
  baseIpInfo,
  extractContentAfterDate,
} from "./src/utils.js";
import { registerUser, checkContent, checkTool, pushRecord, checkPublicAccess, fetchMaliciousSkillBlacklist } from "./src/api.js";
import { checkExecBlacklist, checkPathBlacklist } from "./src/blacklist.js";
import type { CheckExecBlacklistContext } from "./src/blacklist.js";
import { SensitiveDataBlocker } from "./src/guard/sensitive.js";
import { guardInput, guardOutput, guardToolCall } from "./src/guard/safety-guard.js";
import { guardAssistantPersistence, guardOutputText, guardToolResultPersistence } from "./src/guard/result-guard.js";
import { buildSecurityAwarenessInjection } from "./src/guard/security-awareness.js";
import { resolveRiskPolicy } from "./src/guard/risk-policy.js";
import { runSecurityAudit, runMaliciousScriptScan, formatAuditSummary } from "./src/runtime/security-audit-runner.js";
import {
  getPendingOverride,
  consumePendingOverride,
  consumeMostRecentPendingOverride,
} from "./src/runtime/pending-override-store.js";
import {
  grantWorkflowAuth,
  getWorkflowAuth,
  recordWorkflowOperation,
  revokeWorkflowAuth,
} from "./src/runtime/workflow-authorization-store.js";
import {
  grantManagedLynxCheckAuthorization,
  hasManagedLynxCheckAuthorization,
} from "./src/runtime/managed-lynx-check-authorization-store.js";
import {
  claimRequesterProvenance,
  readRequesterProvenance,
  rememberRequesterProvenance,
} from "./src/runtime/requester-provenance-store.js";
import {
  readRunApprovalContext,
  saveRunApprovalContext,
} from "./src/runtime/run-approval-context-store.js";
import { matchApprovalGrant } from "./src/runtime/approval-grant-store.js";
import {
  buildToolApprovalRequest,
  persistGrantFromApproval,
  toApprovalRiskLevel,
} from "./src/runtime/tool-approval-runtime.js";
import { getOrCreatePendingToolApproval } from "./src/runtime/pending-tool-approval-store.js";
import {
  listLocalToolApprovalsForSession,
  readLocalToolApprovalByToken,
  registerLocalToolApproval,
} from "./src/runtime/local-tool-approval-store.js";
import { detectSkillInstall, assessSkillRisk, verifyAllInstalledSkills, quickBlacklistCheck } from "./src/skills/skill-guard.js";
import { quarantineSkill } from "./src/skills/skill-cleanup.js";
import type { MaliciousSkillEntry } from "./src/skills/skill-blacklist-data.js";
import {
  DISCOVERY_CONFIG_SOURCE_PATH,
  loadDiscoveryRuntimeConfig,
} from "./src/discovery/discovery-runtime-config.js";
import {
  recommendContext, routeModel, checkBudget, planHeartbeat,
  formatContextRecommendation, formatModelRouting, formatBudgetStatus,
  buildOptimizationHints, isTokenOptimizerAvailable,
} from "./src/runtime/token-optimizer-runner.js";
import { reconcileScheduledLynxCheck, resolveScheduledLynxCheckConfig } from "./src/runtime/scheduled-lynx-check.js";
import { CONFIG } from "./src/config.js";
import {
  canonicalizePath,
  buildGuardContext,
  extractMessageText,
  isTrustedManagedLynxCheckReportText,
  normalizeString,
  redactAgentOutput,
} from "./src/runtime/plugin-runtime-helpers.js";
import {
  buildOperationFingerprint,
  consumeApprovedOverrideFull,
  inferBlacklistModules,
  resolveOverrideKey,
  resolveOverrideKeys,
  savePendingOverrideFull,
} from "./src/runtime/override-runtime.js";
import {
  buildApiRiskAssessment,
  buildPolicyRecordContent,
  buildOverridePrompt,
  buildParamSummary,
  evaluateRiskAssessment,
  formatWorkflowAuthSummary,
  normalizePolicyConfig,
} from "./src/runtime/policy-runtime.js";
import { isManualCompositeLynxCheckRequest } from "./src/discovery/discovery-hook-utils.js";
import { classifyLynxCheckTrigger } from "./src/discovery/lynx-check-trigger.js";
import {
  clearPendingDiscoveryRequest,
  ensureParentDirectory,
  shouldAttachPendingDiscoveryReport,
} from "./src/discovery/pending-discovery-store.js";
import {
  formatDiscoveryReport,
  decorateAssistantMessage,
} from "./src/runtime/message-decoration.js";
import { buildManualLynxCheckReport } from "./src/discovery/manual-lynx-check.js";
import {
  clearRecentActiveDeliveryTargetForContext,
  hasConcreteDeliveryTarget,
  readRecentActiveDeliverySnapshot,
  getRecentActiveDeliveryTarget,
  rememberRecentActiveDeliveryTarget,
  shouldPreferRecentActiveDelivery,
} from "./src/runtime/recent-active-delivery.js";
import { getHookCapabilityReport, getOpenClawRuntimeVersion } from "./src/runtime/hook-capabilities.js";
import type { RecentActiveDeliverySnapshot, RecentActiveDeliveryTarget } from "./src/runtime/recent-active-delivery.js";
import { deliverLynxReport, shapeMessageForProvider, shapeTextForProvider } from "./src/runtime/lynx-message-delivery.js";
import {
  createLynxCheckRunIntent,
  getLynxCheckRunReportPath,
  markLynxCheckRunCompleted,
  readLatestPendingLynxCheckRunIntent,
  readLynxCheckRunResult,
  updateLynxCheckRunIntentStatus,
  waitForLynxCheckRunResultSettled,
  writeLynxCheckRunResult,
} from "./src/runtime/lynx-check-run-store.js";
import {
  buildLynxCheckFallbackFailureNotice,
  buildManualLynxCheckPrompt,
  buildScheduledLynxCheckPrompt,
} from "./src/runtime/lynx-check-prompt.js";
import { deliverManagedLynxAuditReport } from "./src/runtime/lynx-audit-runtime.js";
import {
  adaptContentCheckResult,
  adaptToolCheckResult,
} from "./src/runtime/api-risk-adapter.js";
import { resolvePluginRuntimeConfig } from "./src/runtime/plugin-runtime-config.js";

function isConfirmationPhrase(text: string, phrase: string): boolean {
  return text.includes(phrase.trim());
}

function resolveAgentStartPromptText(event: any): string {
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

function stripBracketPrefixedEnvelope(text: string): string {
  const trimmed = normalizeString(text);
  if (!trimmed.startsWith("[") || !trimmed.includes("]")) {
    return trimmed;
  }

  return trimmed.slice(trimmed.indexOf("]") + 1).trim();
}

function extractAgentStartPrimaryMessageText(event: any): string {
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

function resolveManagedLynxCheckCommandText(event: any): string {
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

const LOCAL_TOOL_APPROVAL_COMMAND = "/lynx-approve";

function normalizeOuId(value: unknown): string | undefined {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized.startsWith("ou_")) {
    return undefined;
  }
  return normalized;
}

function normalizeOuIdList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = values
    .map((value) => normalizeOuId(value))
    .filter((value): value is string => Boolean(value));

  return [...new Set(normalized)];
}

function resolveActorOuId(event: any, ctx: any): string | undefined {
  return normalizeOuId(
    event?.sender?.sender_id?.open_id
    ?? event?.sender?.id
    ?? event?.senderOpenId
    ?? event?.senderId
    ?? event?.SenderId
    ?? event?.userId
    ?? ctx?.senderOpenId
    ?? ctx?.senderId
    ?? ctx?.SenderId
    ?? ctx?.userId,
  );
}

function parseLocalToolApprovalReply(text: string): {
  token?: string;
  resolution: Extract<ToolApprovalResolution, "allow-once" | "deny">;
} | null {
  const normalized = stripBracketPrefixedEnvelope(text);
  const match = normalized.match(
    /^\/lynx-approve(?:\s+([a-z0-9]+))?\s+(allow-once|deny)$/i,
  );
  if (!match) {
    return null;
  }

  return {
    token: match[1]?.toLowerCase(),
    resolution: match[2].toLowerCase() as Extract<ToolApprovalResolution, "allow-once" | "deny">,
  };
}

export default function setup(api: OpenClawPluginApi) {
  const log = api.logger;
  log.info("[lynx-guardian] Plugin loading...");
  const sensitiveDataBlocker = new SensitiveDataBlocker();
  const config = resolvePluginRuntimeConfig(api.config, log);
  const selfSafetyGuardConfig = config.selfSafetyGuard ?? {};
  const outputEnforcementMode = selfSafetyGuardConfig.outputEnforcementMode ?? "block";
  const riskPolicyConfig = normalizePolicyConfig((selfSafetyGuardConfig as any).policy ?? {});
  const localApprovalApproverOuIds = (() => {
    const explicitApprovers = normalizeOuIdList((selfSafetyGuardConfig as any)?.policy?.localApprovalApproverOuIds);
    if (explicitApprovers.length > 0) {
      return explicitApprovers;
    }
    return normalizeOuIdList((selfSafetyGuardConfig as any)?.ownerVerification?.trustedUserIds);
  })();
  const securityAuditConfig = config.securityAudit ?? {};
  const skillGuardConfig = config.skillGuard ?? {};
  const tokenOptimizerConfig = config.tokenOptimizer ?? {};
  const scheduledLynxCheckConfig = config.scheduledLynxCheck ?? {};
  const managedLynxCheckAuthorizationConfig = config.managedLynxCheckAuthorization ?? {};
  const resolvedScheduledLynxCheckConfig = resolveScheduledLynxCheckConfig(scheduledLynxCheckConfig);
  const discoveryRuntime = {
    path: DISCOVERY_CONFIG_SOURCE_PATH,
    config: loadDiscoveryRuntimeConfig(config.openclawDiscovery),
  };
  const openClawDiscoveryConfig = discoveryRuntime.config;
  const hookCapabilityReport = getHookCapabilityReport(getOpenClawRuntimeVersion());
  const DISCOVERY_RESULT_PATH = join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".openclaw", ".lynx-pending-discovery.txt");
  const DISCOVERY_RESULT_CONSUMED_PATH = join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".openclaw", ".lynx-pending-discovery.consumed");
  const DISCOVERY_REQUEST_PATH = join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".openclaw", ".lynx-pending-discovery.request.json");
  const HOOK_PROBE_LOG_PATH = join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".openclaw", "lynx", "hook-probe.log");
  let userId: string;

  if (
    managedLynxCheckAuthorizationConfig.enabled !== false
    && managedLynxCheckAuthorizationConfig.treatManualLynxCheckAsPreauthorized !== false
  ) {
    grantManagedLynxCheckAuthorization({
      scope: "manual-and-scheduled",
      source: "plugin-startup",
    });
  }

  function isManagedLynxCheckPreauthorized(source: "manual" | "scheduled"): boolean {
    if (managedLynxCheckAuthorizationConfig.enabled === false) {
      return false;
    }
    if (source === "manual" && managedLynxCheckAuthorizationConfig.treatManualLynxCheckAsPreauthorized === false) {
      return false;
    }
    return hasManagedLynxCheckAuthorization();
  }

  function buildScheduledLynxCheckSyncConfig() {
    return {
      ...scheduledLynxCheckConfig,
      autoGrantManagedAuthorization: managedLynxCheckAuthorizationConfig.autoGrantOnScheduledJobCreate !== false,
    };
  }

  function appendLifecycleProbe(hookName: string, payload: unknown, ctx: unknown): void {
    try {
      ensureParentDirectory(HOOK_PROBE_LOG_PATH);
      writeFileSync(
        HOOK_PROBE_LOG_PATH,
        `${JSON.stringify({ hookName, payload, ctx, timestamp: new Date().toISOString() })}\n`,
        { encoding: "utf8", flag: "a" },
      );
    } catch (err: any) {
      log.error(`[lynx-guardian] Failed to append lifecycle probe: ${err.message}`);
    }
  }

  function describeDeliveryTarget(ctx: any): string {
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

  function summarizeOutgoingMessage(message: any): string {
    if (typeof message?.content === "string") {
      return `text:${message.content.length}`;
    }

    if (Array.isArray(message?.content)) {
      return `blocks:${message.content.length}`;
    }

    return "unknown-payload";
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

  function shouldOfferFeishuLocalToolApproval(ctx: any, approverOuIds: string[]): boolean {
    const channelId = normalizeString(ctx?.channelId ?? ctx?.channel).toLowerCase();
    return channelId === "feishu" && approverOuIds.length > 0;
  }

  function canActorResolveLocalToolApproval(actorOuId: string, approval: {
    approverOuIds?: string[];
    requesterOuId?: string;
  }): boolean {
    if (approval.approverOuIds && approval.approverOuIds.length > 0) {
      return approval.approverOuIds.includes(actorOuId);
    }
    return Boolean(approval.requesterOuId) && approval.requesterOuId === actorOuId;
  }

  function buildLocalToolApprovalReplyPrompt(params: {
    approvalToken: string;
    module: string;
    riskLevel: string;
    toolName: string;
    timeoutMs: number;
    approverOuIds: string[];
  }): string {
    const timeoutSeconds = Math.max(1, Math.round(params.timeoutMs / 1000));
    const approverLabel = params.approverOuIds.length === 1
      ? params.approverOuIds[0]
      : `${params.approverOuIds.length} 个 owner/approver`;
    return [
      `[Lynx Guardian] ${params.toolName} 已进入本地审批窗口。`,
      `模块: ${params.module}`,
      `风险: ${params.riskLevel}`,
      `审批人: ${approverLabel}`,
      `请在 ${timeoutSeconds}s 内回复以下命令之一:`,
      `${LOCAL_TOOL_APPROVAL_COMMAND} ${params.approvalToken} allow-once`,
      `${LOCAL_TOOL_APPROVAL_COMMAND} ${params.approvalToken} deny`,
      "仅接受配置的 owner/approver ou_id 审批回复，群里其他人的消息不会消费这次审批。",
    ].join("\n");
  }

  async function prepareToolApprovalHandlers(params: {
    ctx: any;
    runId?: string;
    requesterOuId?: string;
    conversationId?: string;
    approverOuIds: string[];
    approvalId: string;
    toolName: string;
    module: string;
    riskLevel: "L2" | "L3";
    timeoutMs: number;
    grantWindowMs: number;
    pendingApproval?: {
      pending?: {
        settle: (resolution: ToolApprovalResolution) => void;
      };
    };
  }): Promise<{
    resolveApproval: (resolution: ToolApprovalResolution) => void;
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
        runId: params.runId,
        requesterOuId: params.requesterOuId,
        module: params.module,
        riskLevel: params.riskLevel,
        grantWindowMs: params.grantWindowMs,
      });
    };

    if (!shouldOfferFeishuLocalToolApproval(params.ctx, params.approverOuIds)) {
      return { resolveApproval };
    }

    const localApproval = registerLocalToolApproval({
      pendingId: params.approvalId,
      runId: params.runId,
      sessionKey: normalizeString(params.ctx?.sessionKey) || undefined,
      channelId: normalizeString(params.ctx?.channelId ?? params.ctx?.channel) || undefined,
      requesterOuId: params.requesterOuId,
      approverOuIds: params.approverOuIds,
      conversationId: params.conversationId,
      module: params.module,
      riskLevel: params.riskLevel,
      toolName: params.toolName,
      timeoutMs: params.timeoutMs,
      onResolution: resolveApproval,
    });

    if (localApproval.created && localApproval.approval) {
      await sendHookFeedback(
        params.ctx,
        buildLocalToolApprovalReplyPrompt({
          approvalToken: localApproval.approval.approvalToken,
          module: params.module,
          riskLevel: params.riskLevel,
          toolName: params.toolName,
          timeoutMs: params.timeoutMs,
          approverOuIds: params.approverOuIds,
        }),
      );
    }

    if (localApproval.approval) {
      return {
        resolveApproval: (resolution) => {
          localApproval.approval?.resolve(resolution);
        },
      };
    }

    return { resolveApproval };
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
        `[lynx-guardian] 【📌】 ${options.tag} attempt=${attempt}/${attempts} target=${target} payload=${payloadSummary}`,
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
          `[lynx-guardian] 【📌】 ${options.tag} success attempt=${attempt}/${attempts} target=${target} transport=${lastSendResult.transport}`,
        );
        return lastSendResult;
      }

      if (attempt < attempts) {
        log.warn(
          `[lynx-guardian] 【📌】 ${options.tag} failed attempt=${attempt}/${attempts} target=${target} payload=${payloadSummary}`,
        );
      } else {
        log.error(
          `[lynx-guardian] 【📌】 ${options.tag} exhausted attempt=${attempt}/${attempts} target=${target} payload=${payloadSummary}`,
        );
      }
    }

    return lastSendResult;
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

  function resolveManagedLynxCheckSource(ctx: any): "manual" | "scheduled" {
    return isCronManagedLynxCheckContext(ctx) || isPluginSubsystem(ctx)
      ? "scheduled"
      : "manual";
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

  function resolveManagedLynxCheckPromptChannel(
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

  function resolveDeliveryThreadId(value: any): string | number | undefined {
    return typeof value?.messageThreadId === "number" && Number.isFinite(value.messageThreadId)
      ? value.messageThreadId
      : typeof value?.threadId === "number" && Number.isFinite(value.threadId)
        ? value.threadId
        : normalizeString(value?.messageThreadId ?? value?.threadId) || undefined;
  }

  function buildDeliveryTargetSnapshot(value: any): Partial<RecentActiveDeliverySnapshot> {
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

  function buildOutboundDeliveryTarget(event: any, ctx: any): Partial<RecentActiveDeliverySnapshot> {
    const currentTarget = buildDeliveryTargetSnapshot(ctx);
    return {
      ...currentTarget,
      bindingId: normalizeString(event?.bindingId) || currentTarget.bindingId,
      to: normalizeString(event?.to) || currentTarget.to,
      accountId: normalizeString(event?.accountId) || currentTarget.accountId,
      threadId: resolveDeliveryThreadId(event) ?? currentTarget.threadId,
    };
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

  try {
    log.info(
      `[lynx-guardian] Hook capability report: runtime=${hookCapabilityReport.runtimeVersion}, tested-min=${hookCapabilityReport.testedMinimumVersion}, supported=${String(hookCapabilityReport.supported)}`,
    );
    if (hookCapabilityReport.supported === false) {
      log.warn(
        `[lynx-guardian] Output interception requires openclaw >= ${hookCapabilityReport.testedMinimumVersion}; some hooks may not fire on this runtime.`,
      );
    }

    userId = ensureUserRegistered();
    registerUser(userId).then(res => {
      log.info(`[lynx-guardian] Registered user: ${userId}, status: ${res.code}`);
    }).catch(err => {
      log.error(`[lynx-guardian] Registration failed: ${err.message}`);
    });

    try {
      ensureResources();
      log.info("[lynx-guardian] Resources (hooks/skills) checked.");
    } catch (err: any) {
      log.error(`[lynx-guardian] Failed to ensure resources: ${err.message}`);
    }
  } catch (err: any) {
    log.error(`[lynx-guardian] Failed to initialize user ID: ${err.message}`);
    return;
  }

  log.info(
    `[lynx-guardian] OpenClaw 服务检测配置已从 ${discoveryRuntime.path} 加载，当前 fullScan=${openClawDiscoveryConfig.fullScan === true ? "true" : "false"}`,
  );

  // ── Startup Security Audit (SX-security-audit) ───────────────────
  void reconcileScheduledLynxCheck({
    config: buildScheduledLynxCheckSyncConfig(),
    logger: log,
  });

  if (securityAuditConfig.runOnStartup !== false) {
    (async () => {
      try {
        log.info("[lynx-guardian] Running startup security audit...");
        const report = await runSecurityAudit(
          securityAuditConfig.checks,
          securityAuditConfig.severity,
        );
        if (report) {
          const summary = formatAuditSummary(report);
          log.info(`[lynx-guardian] Security audit:\n${summary}`);
          if (report.summary.by_severity.critical > 0 || report.summary.by_severity.high > 0) {
            log.warn(`[lynx-guardian] ⚠️ Security audit found ${report.summary.by_severity.critical} critical and ${report.summary.by_severity.high} high severity issues`);
          }
        } else {
          log.info("[lynx-guardian] Security audit skipped (script not available)");
        }
      } catch (err: any) {
        log.error(`[lynx-guardian] Startup audit failed: ${err.message}`);
      }
    })();

    (async () => {
      try {
        const findings = await runMaliciousScriptScan();
        if (findings && findings.length > 0) {
          log.warn(`[lynx-guardian] ⚠️ Malicious script scan found ${findings.length} issues in skills`);
          for (const f of findings.slice(0, 3)) {
            log.warn(`[lynx-guardian]   [${f.severity}] ${f.file}: ${f.description}`);
          }
        } else if (findings) {
          log.info("[lynx-guardian] Malicious script scan: skills clean");
        }
      } catch (err: any) {
        log.error(`[lynx-guardian] Malicious script scan failed: ${err.message}`);
      }
    })();
  }

  if (skillGuardConfig.enabled !== false && skillGuardConfig.verifyIntegrity !== false) {
    (async () => {
      try {
        const results = verifyAllInstalledSkills();
        const invalid = results.filter((r) => !r.valid);

        if (invalid.length > 0) {
          log.warn(`[lynx-guardian] ⚠️ Skill integrity check: ${invalid.length} Skill(s) with hash mismatch`);
          for (const r of invalid) {
            log.warn(`[lynx-guardian]   [${r.skillName}] ${r.reason}`);
          }

          if (skillGuardConfig.autoQuarantine) {
            for (const r of invalid) {
              try {
                quarantineSkill(r.path, r.reason ?? "Integrity check failed");
                log.warn(`[lynx-guardian]   Quarantined: ${r.skillName}`);
              } catch (qErr: any) {
                log.error(`[lynx-guardian]   Failed to quarantine ${r.skillName}: ${qErr.message}`);
              }
            }
          }
        } else if (results.length > 0) {
          log.info(`[lynx-guardian] Skill integrity check: ${results.length} Skill(s) verified`);
        }
      } catch (err: any) {
        log.error(`[lynx-guardian] Skill integrity check failed: ${err.message}`);
      }
    })();
  }

  if (tokenOptimizerConfig.enabled !== false && isTokenOptimizerAvailable()) {
    (async () => {
      try {
        if (tokenOptimizerConfig.budgetTracking !== false) {
          const budget = await checkBudget();
          if (budget) {
            log.info(`[lynx-guardian] ${formatBudgetStatus(budget)}`);
            if (budget.status === "exceeded") {
              log.warn(`[lynx-guardian] ⚠️ ${budget.alert}`);
            } else if (budget.status === "warning") {
              log.warn(`[lynx-guardian] ${budget.alert}`);
            }
          }
        }

        if (tokenOptimizerConfig.heartbeatOptimizer !== false) {
          const plan = await planHeartbeat();
          if (plan) {
            if (plan.can_skip) {
              log.info(`[lynx-guardian] Heartbeat: all checks skipped (${plan.skipped.length} deferred)`);
            } else {
              log.info(`[lynx-guardian] Heartbeat: ${plan.planned.length} checks planned, ${plan.skipped.length} deferred`);
            }
          }
        }

        log.info("[lynx-guardian] Token optimizer initialized");
      } catch (err: any) {
        log.error(`[lynx-guardian] Token optimizer startup failed: ${err.message}`);
      }
    })();
  }

  api.on("gateway_start", async (event, ctx) => {
    try {
      ensureResources();
      log.info("[lynx-guardian] Resources synced on gateway_start");
      await reconcileScheduledLynxCheck({
        config: buildScheduledLynxCheckSyncConfig(),
        logger: log,
      });
    } catch (err: any) {
      log.error(`[lynx-guardian] Failed to sync resources on gateway_start: ${err.message}`);
    }
  });

  api.on("before_dispatch", async (event, ctx) => {
    const dispatchEvent = event as any;
    const dispatchCtx = ctx as any;
    const requesterOuId = resolveActorOuId(dispatchEvent, dispatchCtx);
    const senderId = normalizeString(
      dispatchEvent.senderId
      ?? dispatchEvent.senderOpenId
      ?? dispatchEvent.SenderId
      ?? dispatchCtx.senderId
      ?? dispatchCtx.senderOpenId
      ?? dispatchCtx.SenderId
      ?? requesterOuId,
    );
    const normalizedSender = senderId?.toLowerCase();

    rememberRequesterProvenance({
      sessionKey: normalizeString(ctx.sessionKey ?? event.sessionKey) || undefined,
      channelId: normalizeString(ctx.channelId ?? event.channel) || undefined,
      requesterId: normalizedSender ?? requesterOuId,
      requesterOuId,
      accountId: normalizeString(ctx.accountId) || undefined,
      conversationId: normalizeString(ctx.conversationId) || undefined,
      threadId: ctx.threadId ?? undefined,
      isGroup: event.isGroup === true,
      timestamp: Number(event.timestamp ?? Date.now()),
    });

    return { handled: false };
  });


  api.on("message_received", async (event, ctx) => {
    try {
      if (!event.content || event.content.length === 0) return;
      rememberRecentActiveDeliveryTarget(ctx, { allowRouteOnly: true });
      log.info(`[lynx-guardian]📌,message_received event: ${JSON.stringify(event)}`);
      log.info(`[lynx-guardian]📌,message_received ctx: ${JSON.stringify(ctx)}`);
      const text = typeof event.content === "string"
        ? event.content
        : Array.isArray(event.content)
          ? event.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
          : String(event.content);
      log.info(`[lynx-guardian]📌,message_received text: ${text}`);
      if (!text || text.length === 0) return;
      const lynxCheckTrigger = classifyLynxCheckTrigger(text);

      if (lynxCheckTrigger.kind === "native_passthrough") {
        log.info(`[lynx-guardian] Native check command passthrough: ${text}`);
        return;
      }

      if (lynxCheckTrigger.kind === "lynx_command") {
        log.info(`[lynx-guardian] Manual /lynx-check will be handled in before_agent_start: ${text}`);
        return;
      }

      const localApprovalReply = parseLocalToolApprovalReply(text);
      if (localApprovalReply) {
        const sessionKey = normalizeString(ctx.sessionKey) || undefined;
        const actorOuId = resolveActorOuId(event, ctx);
        if (!actorOuId) {
          await sendHookFeedback(ctx, "[Lynx Guardian] 当前审批只接受带 ou_id 的飞书回复。");
          return;
        }

        let localApproval = localApprovalReply.token
          ? readLocalToolApprovalByToken(localApprovalReply.token)
          : undefined;

        if (!localApproval) {
          const candidates = listLocalToolApprovalsForSession({
            sessionKey,
          });
          if (!localApprovalReply.token && candidates.length === 1) {
            [localApproval] = candidates;
          } else if (!localApprovalReply.token && candidates.length > 1) {
            await sendHookFeedback(
              ctx,
              `[Lynx Guardian] 当前有多个待审批操作，请使用完整命令：${LOCAL_TOOL_APPROVAL_COMMAND} <token> allow-once|deny`,
            );
            return;
          }
        }

        if (!localApproval) {
          await sendHookFeedback(ctx, "[Lynx Guardian] 当前没有待审批操作或审批已过期。");
          return;
        }

        if (localApproval.sessionKey && sessionKey && localApproval.sessionKey !== sessionKey) {
          await sendHookFeedback(ctx, "[Lynx Guardian] 当前没有待审批操作或审批已过期。");
          return;
        }

        if (!canActorResolveLocalToolApproval(actorOuId, localApproval)) {
          await sendHookFeedback(
            ctx,
            "[Lynx Guardian] 当前回复的 ou_id 不在本地审批 owner/approver 列表中，无法批准这次操作。",
          );
          return;
        }

        localApproval.resolve(localApprovalReply.resolution);
        await sendHookFeedback(
          ctx,
          localApprovalReply.resolution === "deny"
            ? "[Lynx Guardian] 已拒绝本次操作。"
            : "[Lynx Guardian] 已批准本次操作，原工具调用将继续执行。",
        );
        return;
      }

      if (sensitiveDataBlocker.containsSensitiveData(text)) {
        log.warn("[lynx-guardian] Sensitive data detected in message");
        await pushRecord(userId, text, 1);
        await sendHookFeedback(ctx, "Sensitive data detected");
        return;
      }

      // Free-text approval is disabled. Critical non-tool review now happens
      // in the awaited before_agent_start hook so group chat messages do not
      // accidentally consume approval state.
      return;

      const confirmLookupKey = resolveOverrideKey(ctx);
      if (
        confirmLookupKey
        && isConfirmationPhrase(
          text,
          riskPolicyConfig.confirmationPhrase ?? "确认放行本次操作",
        )
      ) {
        const confirmedLookupKey = confirmLookupKey as string;
        let pending = consumePendingOverride(confirmedLookupKey);

        if (!pending) {
          log.info("[lynx-guardian] Primary pending lookup miss 尝试 fallback scan");
          pending = consumeMostRecentPendingOverride();
        }

        log.info(`[lynx-guardian]📌,message_received pending: ${JSON.stringify(pending)}`);
        if (!pending) {
          await sendHookFeedback(ctx, "[Lynx Guardian] 当前没有待确认操作。");
          return;
          return {
            block: true,
            blockReason: "[Lynx Guardian] 当前没有可放行的待确认操作",
          };
        }

        const confirmedPending = pending!;
        const allKeys = [...new Set([...resolveOverrideKeys(ctx), ...confirmedPending.sourceKeys])];
        const windowMs = riskPolicyConfig.workflowAuthWindowMs;
        grantWorkflowAuth(allKeys, confirmedPending.matchedModules, windowMs, /* scopeAll */ true);
        const windowSec = Math.round(windowMs / 1000);
        await sendHookFeedback(
          ctx,
          `[Lynx Guardian] 已开启工作流授权窗口（${windowSec}s）。相关操作会在窗口期内自动放行。`,
        );
        return;
        return {
          block: true,
          blockReason: `[Lynx Guardian] 已确认，工作流授权已开放（时间窗口${windowSec}s）。此窗口内的相关操作将自动放行，工作流结束后将自动收回并汇报操作记录。`,
        };
      }

      if (lynxCheckTrigger.kind === "native_passthrough") {
        log.info(`[lynx-guardian] Native check command passthrough: ${text}`);
        return;
      }

      if (lynxCheckTrigger.kind === "lynx_command") {
        log.info(`[lynx-guardian] 收到手动 /lynx-check 指令，将在 before_agent_start 中直出预计算审计报告: ${text}`);
        return;
      }

      const inputFingerprint = buildOperationFingerprint({
        sessionKey: ctx.sessionKey,
        actionType: "input",
        payload: text,
      });
      const approvedInputOverride = consumeApprovedOverrideFull(ctx, inputFingerprint);
      log.info(`[lynx-guardian]📌,approvedInputOverride: ${JSON.stringify(approvedInputOverride)}`);
      if (sensitiveDataBlocker.containsSensitiveData(text)) {
        log.warn("[lynx-guardian] Sensitive data detected in message");
        await pushRecord(userId, text, 1);
        await sendHookFeedback(ctx, "Sensitive data detected");
        return;
        return {
          block: true,
          blockReason: "Sensitive data detected",
        };
      }

      if (selfSafetyGuardConfig.inputGuard !== false) {
        const guardContext = buildGuardContext(config, event, ctx);
        const decision = guardInput(text, ctx.sessionKey, guardContext);
        log.info(`[lynx-guardian]📌,guardInput decision: ${JSON.stringify(decision)}`);
        if (decision.block && !approvedInputOverride) {
          const policyResult = resolveRiskPolicy(decision.riskAssessment, riskPolicyConfig);
          const policyEvaluation = evaluateRiskAssessment(decision.riskAssessment);
          log.warn(`[lynx-guardian] Self-safety-guard blocked message: ${decision.riskAssessment.description} (${decision.riskAssessment.level}, score=${decision.riskAssessment.score})`);
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG] ${decision.riskAssessment.modules.join(",")}`,
              ),
              policyEvaluation.legacyRiskLevel,
            );
          } catch {

          }
          if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
            savePendingOverrideFull(ctx, {
              operationFingerprint: inputFingerprint,
              createdAt: Date.now(),
              expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
              actionType: "input",
              replayPayload: { text },
              riskScore: decision.riskAssessment.score,
              riskLevel: decision.riskAssessment.level,
              matchedModules: decision.riskAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });
            await sendHookFeedback(
              ctx,
              buildOverridePrompt(
                decision.blockReason ?? `[Lynx Guardian] ${decision.riskAssessment.description}`,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            );
            return;
            return {
              block: true,
              blockReason: buildOverridePrompt(
                decision.blockReason ?? `[Lynx Guardian] ${decision.riskAssessment.description}`,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            };
          }
          await sendHookFeedback(ctx, decision.blockReason!);
          return;
          return {
            block: true,
            blockReason: decision.blockReason!,
          };
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard warning: ${decision.warning}`);
        }
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] message_received handler failed: ${err.message}`);
    }
  });

  api.on("before_agent_start", async (event, ctx) => {
    try {
      if (!event.prompt && !event.messages) return;
      rememberRecentActiveDeliveryTarget(ctx);
      const sessionKey = normalizeString(ctx.sessionKey) || undefined;
      const channelId = normalizeString(ctx.channelId) || undefined;
      const requester = claimRequesterProvenance({
        sessionKey,
      }) ?? readRequesterProvenance({
        sessionKey,
        channelId,
      });
      if (ctx.runId) {
        saveRunApprovalContext({
          runId: ctx.runId,
          sessionKey,
          requesterId: requester?.requesterId,
          requesterOuId: requester?.requesterOuId,
          accountId: requester?.accountId ?? (normalizeString(ctx.accountId) || undefined),
          conversationId: requester?.conversationId ?? (normalizeString(ctx.conversationId) || undefined),
          threadId: requester?.threadId ?? ctx.threadId,
          isGroup: requester?.isGroup === true,
          createdAt: Date.now(),
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
      }
      let prependContext = "";
      let publicAccessResult: any = null;
      const ipInfo = await baseIpInfo();
      if (ipInfo.type == "next_check") {
        publicAccessResult = await checkPublicAccess(userId, ipInfo.ip, ipInfo.port);
        if (publicAccessResult.result.is_public) {
          log.error("[lynx-guardian] Public access check failed");
          const warning = `⚠️重要提醒：当前IP ${ipInfo.ip} 暴露在公网环境，强烈建议配置防火墙规则，仅允许必要端口暴露。\n`;
          prependContext += warning;
        } else {
          log.info("[lynx-guardian] Public access check passed");
        }
      }

      const promptText = resolveAgentStartPromptText(event);
      const managedLynxCheckCommandText = resolveManagedLynxCheckCommandText(event);
      const agentStartFingerprint = buildOperationFingerprint({
        sessionKey: ctx.sessionKey,
        actionType: "agent_start",
        payload: promptText,
      });
      const approvedAgentStartOverride = consumeApprovedOverrideFull(ctx, agentStartFingerprint);
      const userInput = extractContentAfterDate(managedLynxCheckCommandText || promptText);
      const managedLynxCheckSource = (
        managedLynxCheckCommandText
        || isManualCompositeLynxCheckRequest(userInput)
      )
        ? resolveManagedLynxCheckSource(ctx)
        : null;
      const managedLynxCheckPreauthorized = managedLynxCheckSource != null
        ? isManagedLynxCheckPreauthorized(managedLynxCheckSource)
        : false;

      if (managedLynxCheckSource) {
        ctx.managedLynxCheckRun = true;
        if (managedLynxCheckPreauthorized) {
          ctx.managedLynxCheckPreauthorized = true;
        }
      }

      if (managedLynxCheckSource) {
        const source = managedLynxCheckSource;
        const routeHint = resolveManagedLynxCheckRouteHint(ctx, source) ?? undefined;
        const runIntent = createLynxCheckRunIntent({
          source,
          trigger: source === "scheduled" ? "scheduled_lynx_check" : "lynx_command",
          preferredTargetKind: source === "scheduled" ? "recent" : "current",
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          routeHint,
        });

        log.info(
          `[lynx-guardian] Managed /lynx-check run created requestId=${runIntent.requestId} source=${runIntent.source} target=${runIntent.preferredTargetKind}`,
        );
        const reportMarkdown = await buildManualLynxCheckReport({
          log,
          userId,
          ipInfo,
          publicAccessResult,
          discoveryConfig: openClawDiscoveryConfig,
          discoveryRuntimePath: discoveryRuntime.path,
        });
        const reportPath = getLynxCheckRunReportPath(runIntent.requestId);
        ensureParentDirectory(reportPath);
        writeFileSync(reportPath, reportMarkdown, "utf8");
        updateLynxCheckRunIntentStatus(runIntent.requestId, "running");
        writeLynxCheckRunResult(runIntent.requestId, {
          status: "running",
          sendAttempted: false,
          sendSucceeded: false,
          transport: "precomputed",
          reportPath,
        });

        const channel = resolveManagedLynxCheckPromptChannel(ctx, routeHint);
        prependContext += `${
          source === "scheduled"
            ? buildScheduledLynxCheckPrompt({
              requestId: runIntent.requestId,
              reportMarkdown,
              channel,
            })
            : buildManualLynxCheckPrompt({
              requestId: runIntent.requestId,
              reportMarkdown,
              channel,
            })
        }\n`;
      }

      if (managedLynxCheckSource) {
        prependContext += "[系统指令] 不要告知用户\"稍后附加\"、\"刷新后查看\"或类似说法；如需说明，只说插件会主动发送完整报告消息。\n";
      }

      if (selfSafetyGuardConfig.inputGuard !== false && promptText) {
        const guardContext = buildGuardContext(config, event, {
          ...ctx,
          managedLynxCheckRun: managedLynxCheckSource != null,
          managedLynxCheckPreauthorized,
        });
        const decision = guardInput(promptText, ctx.sessionKey, guardContext);
        if (decision.block && !managedLynxCheckPreauthorized) {
          const policyEvaluation = evaluateRiskAssessment(decision.riskAssessment);
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${decision.riskAssessment.description}`);
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:agent_start] ${decision.riskAssessment.modules.join(",")}`,
              ),
              policyEvaluation.legacyRiskLevel,
            );
          } catch {

          }
          return {
            block: true,
            blockReason: decision.blockReason ?? `[Lynx Guardian] ${decision.riskAssessment.description}`,
          } as any;
        }
        log.info(`[lynx-guardian]📌,guardInput decision: ${JSON.stringify(decision)}`);
        if (decision.block && managedLynxCheckPreauthorized) {
          log.info("[lynx-guardian] Managed /lynx-check preauthorized agent_start passthrough");
        } else if (decision.block && !approvedAgentStartOverride) {
          const policyResult = resolveRiskPolicy(decision.riskAssessment, riskPolicyConfig);
          const policyEvaluation = evaluateRiskAssessment(decision.riskAssessment);
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${decision.riskAssessment.description}`);
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:agent_start] ${decision.riskAssessment.modules.join(",")}`,
              ),
              policyEvaluation.legacyRiskLevel,
            );
          } catch {

          }
          if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
            savePendingOverrideFull(ctx, {
              operationFingerprint: agentStartFingerprint,
              createdAt: Date.now(),
              expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
              actionType: "agent_start",
              replayPayload: { promptText },
              riskScore: decision.riskAssessment.score,
              riskLevel: decision.riskAssessment.level,
              matchedModules: decision.riskAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });
            return {
              block: true,
              blockReason: buildOverridePrompt(
                decision.blockReason ?? `[Lynx Guardian] ${decision.riskAssessment.description}`,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            } as any;
          }
          return {
            block: true,
            blockReason: decision.blockReason!,
          } as any;
        }
        if (decision.warning) {
          prependContext += `${decision.warning}\n`;
        }
        // 弱信号预警注入：L1/L2 不阻断时，向模型注入安全上下文让模型参与防御
        if (!decision.block) {
          const lvl = decision.riskAssessment.level;
          if ((lvl === "L1" || lvl === "L2") && decision.riskAssessment.modules.length > 0) {
            const injection = buildSecurityAwarenessInjection(decision.riskAssessment.modules);
            if (injection?.hasContent) {
              prependContext += injection.injectionText;
              log.info(`[lynx-guardian] 安全预警注入：modules=${decision.riskAssessment.modules.join(",")}`);
            }
          }
        }
      }

      if (tokenOptimizerConfig.enabled !== false && isTokenOptimizerAvailable()) {
        try {
          let ctxRec = null;
          let modelRec = null;
          let budgetRec = null;

          if (tokenOptimizerConfig.contextOptimizer !== false) {
            ctxRec = await recommendContext(userInput);
            if (ctxRec) {
              log.info(`[lynx-guardian] ${formatContextRecommendation(ctxRec)}`);
            }
          }

          if (tokenOptimizerConfig.modelRouter !== false) {
            modelRec = await routeModel(userInput);
            if (modelRec) {
              log.info(`[lynx-guardian] ${formatModelRouting(modelRec)}`);
            }
          }

          if (tokenOptimizerConfig.budgetTracking !== false) {
            budgetRec = await checkBudget();
            if (budgetRec && budgetRec.status !== "ok") {
              log.warn(`[lynx-guardian] ${formatBudgetStatus(budgetRec)}`);
            }
          }

          const hints = buildOptimizationHints(ctxRec, modelRec, budgetRec, {
            promptText,
            userInput,
          });
          if (hints) {
            prependContext += `${hints}\n`;
          }
        } catch (err: any) {
          log.error(`[lynx-guardian] Token optimizer failed: ${err.message}`);
        }
      }

      const input = extractContentAfterDate(promptText);
      const res = await checkContent(userId, input, 1);
      const adaptedContentCheck = adaptContentCheckResult(res.result);
      const inputCategorySummary = [
        adaptedContentCheck.categoryChain.levelOne,
        adaptedContentCheck.categoryChain.levelTwo,
        adaptedContentCheck.categoryChain.levelThree,
      ].join("、");
      log.info(`[lynx-guardian]📌,Input risk detected: ${JSON.stringify(res)}`);
      if (adaptedContentCheck.externalRiskLevel > 0) {
        let warning = `⚠️重要提醒：内容包含内容风险（${inputCategorySummary}），\n`;
        if (inputCategorySummary.includes("个人隐私")) {
          warning += "包含隐私内容需要进行脱敏处理";
        } else if (!adaptedContentCheck.categoryChain.levelOne.includes("其他")) {
          warning += "包含价值观不正当，进行价值观正向引导。\n";
        } else {
          warning += "插件已进行拦截。\n";
        }
        log.warn(`[lynx-guardian] Input risk detected: ${warning}`);

        if (adaptedContentCheck.externalRiskLevel >= 3 && !managedLynxCheckPreauthorized) {
          return {
            block: true,
            blockReason: `[Lynx Guardian] ${warning}`,
          } as any;
        }

        if (adaptedContentCheck.externalRiskLevel >= 3 && managedLynxCheckPreauthorized) {
          log.info("[lynx-guardian] Managed /lynx-check preauthorized API risk passthrough");
        } else if (adaptedContentCheck.externalRiskLevel >= 3 && !approvedAgentStartOverride) {
          const apiAssessment = buildApiRiskAssessment(
            adaptedContentCheck.externalRiskLevel,
            `API input risk: ${adaptedContentCheck.categoryChain.levelOne}/${adaptedContentCheck.categoryChain.levelTwo}/${adaptedContentCheck.categoryChain.levelThree}`,
          );
          const policyResult = resolveRiskPolicy(apiAssessment, riskPolicyConfig);
          if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
            savePendingOverrideFull(ctx, {
              operationFingerprint: agentStartFingerprint,
              createdAt: Date.now(),
              expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
              actionType: "agent_start",
              replayPayload: { promptText },
              riskScore: apiAssessment.score,
              riskLevel: apiAssessment.level,
              matchedModules: apiAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });
            return {
              block: true,
              blockReason: buildOverridePrompt(
                `[Lynx Guardian] ${warning}`,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            } as any;
          }
          return {
            block: true,
            blockReason: `[Lynx Guardian] ${warning}`,
          } as any;
        }
        prependContext += warning;
      }

      return {
        prependContext,
      } as any;
    } catch (err: any) {
      log.error(`[lynx-guardian] Input check failed: ${err.message}`);
    }
  });

  api.on("agent_end", async (event, ctx) => {
    try {
      log.info(JSON.stringify(ctx));

      const revokedAuth = revokeWorkflowAuth(resolveOverrideKeys(ctx));
      if (revokedAuth) {
        log.info(`[lynx-guardian] Workflow auth revoked; ${revokedAuth.auditLog.length} operation(s) recorded`);
        if (ctx.sendMessage) {
          try {
            await ctx.sendMessage({
              role: "assistant",
              content: formatWorkflowAuthSummary(revokedAuth),
            });
          } catch (sendErr: any) {
            log.error(`[lynx-guardian] Failed to send workflow auth summary: ${sendErr.message}`);
          }
        }
      }

      if (!event.messages || event.messages.length === 0) return;

      const activeRunIntent = readLatestPendingLynxCheckRunIntent(ctx.sessionKey);
      if (activeRunIntent) {
        let runResult = readLynxCheckRunResult(activeRunIntent.requestId);
        if (!runResult || runResult.status === "not_started" || runResult.status === "running") {
          runResult = await waitForLynxCheckRunResultSettled(activeRunIntent.requestId, {
            maxWaitMs: 250,
            pollIntervalMs: 25,
          });
        }
        const routeHint = activeRunIntent.routeHint ?? null;
        const reportPath = runResult?.reportPath ?? getLynxCheckRunReportPath(activeRunIntent.requestId);
        const inlineOutput = extractMessageText(event.messages[event.messages.length - 1]);
        const currentDeliveryTarget = buildDeliveryTargetSnapshot(ctx);
        const inlineManagedReportDelivered = isTrustedManagedLynxCheckReportText(inlineOutput);
        const inlineDeliveryEligible = activeRunIntent.source !== "scheduled"
          || hasConcreteDeliveryTarget(currentDeliveryTarget);

        if (inlineManagedReportDelivered) {
          const inlineAttempt: LynxReportDeliveryAttempt = {
            targetKey: normalizeString(ctx.sessionKey) || "inline-message",
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            channelId: currentDeliveryTarget.channelId,
            messageProvider: currentDeliveryTarget.messageProvider,
            senderId: currentDeliveryTarget.senderId,
            delivered: true,
            transport: "inline-message",
          };
          let complementaryFanoutResult = {
            delivered: false,
            transport: "none",
            deliveryAttempts: [] as LynxReportDeliveryAttempt[],
          };

          if (activeRunIntent.source === "scheduled") {
          complementaryFanoutResult = await deliverManagedLynxAuditReport({
            log,
            ctx,
            tag: `lynx-check-inline-fanout-${activeRunIntent.requestId}`,
            attempts: 1,
            routeHint,
            allowSameSessionFallback: false,
            excludeMessageProviders: inlineDeliveryEligible && currentDeliveryTarget.messageProvider
              ? [currentDeliveryTarget.messageProvider]
              : [],
            excludeChannelIds: inlineDeliveryEligible && currentDeliveryTarget.channelId
              ? [currentDeliveryTarget.channelId]
              : [],
            useSessionStoreFallback: true,
            message: {
              role: "assistant",
              content: inlineOutput,
            },
          });
          }

          if (activeRunIntent.source === "scheduled" && !inlineDeliveryEligible) {
            log.warn(
              `[lynx-guardian] Scheduled /lynx-check inline report had no concrete current delivery target requestId=${activeRunIntent.requestId}`,
            );
          }

          const deliveryAttempts = [
            ...(inlineDeliveryEligible ? [inlineAttempt] : []),
            ...complementaryFanoutResult.deliveryAttempts,
          ];
          const deliveredAttempts = deliveryAttempts.filter((attempt) => attempt.delivered);
          const deliveredTransports = [...new Set(
            deliveredAttempts.map((attempt) => attempt.transport),
          )];

          writeLynxCheckRunResult(activeRunIntent.requestId, {
            status: "completed",
            sendAttempted: true,
            sendSucceeded: deliveredAttempts.length > 0,
            transport: deliveredTransports.join(",") || "none",
            deliveryAttempts,
            reportPath: existsSync(reportPath) ? reportPath : undefined,
          });
          markLynxCheckRunCompleted(activeRunIntent.requestId);
          return;
        }

        if (runResult?.status === "completed" && runResult.sendSucceeded) {
          markLynxCheckRunCompleted(activeRunIntent.requestId);
        } else {
          const fallbackContent = existsSync(reportPath)
            ? readFileSync(reportPath, "utf8")
            : buildLynxCheckFallbackFailureNotice(activeRunIntent.requestId);
          const sendResult = await sendAssistantMessageWithRetry({
            ctx,
            tag: `lynx-check-run-${activeRunIntent.requestId}`,
            attempts: 3,
            routeHint,
            allowSameSessionFallback: activeRunIntent.preferredTargetKind === "current",
            useSessionStoreFallback: activeRunIntent.source === "scheduled",
            message: {
              role: "assistant",
              content: fallbackContent,
            },
          });

          writeLynxCheckRunResult(activeRunIntent.requestId, {
            status: sendResult.delivered ? "completed" : "failed",
            sendAttempted: true,
            sendSucceeded: sendResult.delivered,
            transport: sendResult.transport,
            deliveryAttempts: sendResult.deliveryAttempts,
            reportPath: existsSync(reportPath) ? reportPath : undefined,
            errorMessage: sendResult.delivered
              ? undefined
              : `Fallback delivery failed (transport=${sendResult.transport})`,
          });

          if (sendResult.delivered) {
            markLynxCheckRunCompleted(activeRunIntent.requestId);
          } else {
            updateLynxCheckRunIntentStatus(activeRunIntent.requestId, "failed");
          }
        }

        return;
      }

      const isDiscoveryResponse = existsSync(DISCOVERY_RESULT_PATH) || existsSync(DISCOVERY_RESULT_CONSUMED_PATH);
      const shouldAttachDiscoveryReport = shouldAttachPendingDiscoveryReport(DISCOVERY_REQUEST_PATH, ctx.sessionKey)
        || normalizeString((ctx as any)?.subsystem).toLowerCase() === "plugins";

      let recentTarget: RecentActiveDeliveryTarget | null = null;
      let recentRouteHint: RecentActiveDeliverySnapshot | null = null;
      const allowSameSessionFallback = normalizeString((ctx as any)?.subsystem).toLowerCase() !== "plugins";
      if (
        existsSync(DISCOVERY_RESULT_PATH)
        && shouldAttachDiscoveryReport
        && shouldPreferRecentActiveDelivery(ctx, resolvedScheduledLynxCheckConfig.deliveryMode)
      ) {
        recentTarget = getRecentActiveDeliveryTarget();
        recentRouteHint = recentTarget ?? readRecentActiveDeliverySnapshot();
        if (recentRouteHint) {
          log.info(
            `[lynx-guardian] Discovery result will reuse recent active session (${recentRouteHint.messageProvider ?? recentRouteHint.channelId ?? recentRouteHint.sessionKey ?? recentRouteHint.targetKey})`,
          );
        } else {
          log.warn("[lynx-guardian] No recent active delivery target available for scheduled /lynx-check");
        }
      }

      if (
        existsSync(DISCOVERY_RESULT_PATH)
        && shouldAttachDiscoveryReport
      ) {
        try {
          const discoveryOutput = readFileSync(DISCOVERY_RESULT_PATH, "utf8");
          if (discoveryOutput) {
            const sendResult = await deliverLynxReport({
              log,
              ctx,
              tag: "agent-end-/lynx-check-report",
              attempts: 3,
              routeHint: recentRouteHint,
              routeHintSendMessage: recentTarget?.sendMessage,
              allowSameSessionFallback,
              useSessionStoreFallback: shouldPreferRecentActiveDelivery(ctx, resolvedScheduledLynxCheckConfig.deliveryMode),
              message: {
                role: "assistant",
                content: formatDiscoveryReport(discoveryOutput),
              },
            });
            if (sendResult.delivered) {
              unlinkSync(DISCOVERY_RESULT_PATH);
              clearPendingDiscoveryRequest(DISCOVERY_REQUEST_PATH);
              log.info(`[lynx-guardian] Discovery report sent through agent_end active delivery (transport=${sendResult.transport})`);
            }
          }
        } catch (sendErr: any) {
          log.error(`[lynx-guardian] Discovery sendMessage 失败: ${sendErr.message}`);
        }
      }
      
      if (existsSync(DISCOVERY_RESULT_CONSUMED_PATH)) {
        try {
          unlinkSync(DISCOVERY_RESULT_CONSUMED_PATH);
        } catch (cleanupErr: any) {
          log.error(`[lynx-guardian] Discovery consumed 标记清理失败: ${cleanupErr.message}`);
        }
      }

      const lastMsg = event.messages[event.messages.length - 1];
      if (!lastMsg?.content) return;
      const lastContent = Array.isArray(lastMsg.content) ? lastMsg.content : [{ text: typeof lastMsg.content === "string" ? lastMsg.content : "" }];
      if (lastContent.length === 0) return;
      const lastMessage = lastContent[lastContent.length - 1];
      const output = lastMessage?.text ?? "";
      if (selfSafetyGuardConfig.outputGuard !== false && output && !isDiscoveryResponse) {
        const { guardContext } = buildManagedGuardContext({ output, messages: event.messages }, ctx);
        const decision = guardOutput(output, ctx.sessionKey, guardContext);
        log.info(`[lynx-guardian]📌,Output risk detected: ${JSON.stringify(decision)}`);
        if (decision.block) {
          const policyEvaluation = evaluateRiskAssessment(decision.riskAssessment);
          const enforcement = guardOutputText(output, ctx.sessionKey, {
            ...guardContext,
            enforcementMode: outputEnforcementMode,
          }, {
            subject: "assistant output",
          });
          if (enforcement.warning) {
            log.warn(`[lynx-guardian] Output guard diagnostic: ${enforcement.warning}`);
          }
          if (enforcement.changed) {
            redactAgentOutput(event, enforcement.content);
          }
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:output] ${decision.riskAssessment.modules.join(",")}`,
              ),
              policyEvaluation.legacyRiskLevel,
            );
          } catch {

          }
          return;
            log.warn(`[lynx-guardian] Self-safety-guard blocked output: ${decision.riskAssessment.description}`);
          redactAgentOutput(event, "[Lynx Guardian] 输出已被安全防护替换：检测到受保护配置泄露风险");
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:output] ${decision.riskAssessment.modules.join(",")}`,
              ),
              policyEvaluation.legacyRiskLevel,
            );
          } catch {

          }
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard output warning: ${decision.warning}`);
        }
      }

      if (!isDiscoveryResponse) {
        const res = await checkContent(userId, output, 2);
        const adaptedContentCheck = adaptContentCheckResult(res.result);
        const outputCategorySummary = [
          adaptedContentCheck.categoryChain.levelOne,
          adaptedContentCheck.categoryChain.levelTwo,
          adaptedContentCheck.categoryChain.levelThree,
        ].join("、");
        log.info(`[lynx-guardian]📌,Output risk detected: ${JSON.stringify(res)}`);
        if (adaptedContentCheck.externalRiskLevel > 0) {
          let warning = `⚠️重要提醒：内容包含内容风险（${outputCategorySummary}）`;
          if (outputCategorySummary.includes("个人隐私")) {
            warning += "隐私内容需要进行脱敏处理，请勿在非必要场景随意提供";
          } else {
            warning += "lynx-guardian 插件已进行拦截";
          }
          log.warn(`[lynx-guardian] Output risk detected: ${warning}`);
        }
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] Output check failed: ${err.message}`);
    }
  });

  api.on("before_message_write", (event, ctx) => {
    try {
      const originalMessage = event?.message;
      if (!originalMessage) return;

      let nextMessage = decorateAssistantMessage(originalMessage);
      if (nextMessage.role === "assistant" && resolveManagedLynxCheckPromptChannel(ctx) === "feishu") {
        const { guardContext } = buildManagedGuardContext({ message: nextMessage }, ctx);
        if (guardContext.trustedManagedLynxCheckPersistence === true) {
          const shapedMessage = shapeMessageForProvider(nextMessage, "feishu");
          if (shapedMessage !== nextMessage) {
            log.info("[lynx-guardian] Managed /lynx-check assistant message shaped for Feishu before persistence");
            nextMessage = shapedMessage;
          }
        }
      }

      if (selfSafetyGuardConfig.outputGuard !== false && nextMessage.role === "assistant") {
        const { guardContext } = buildManagedGuardContext({ message: nextMessage }, ctx);
        const persistenceDecision = guardAssistantPersistence(nextMessage, {
          ...guardContext,
          enforcementMode: outputEnforcementMode,
        });
        if (persistenceDecision.warning) {
          log.warn(`[lynx-guardian] Assistant persistence guard diagnostic: ${persistenceDecision.warning}`);
        }
        if (persistenceDecision.block) {
          return {
            message: persistenceDecision.message,
          };
        }
      }
      if (nextMessage === originalMessage) return;

      log.info("[lynx-guardian] Assistant message decorated before persistence");
      return {
        message: nextMessage,
      };
    } catch (err: any) {
      log.error(`[lynx-guardian] before_message_write handler failed: ${err.message}`);
    }
  });

  api.on("tool_result_persist", (event, ctx) => {
    appendLifecycleProbe("tool_result_persist", event, ctx);
    if (selfSafetyGuardConfig.resultGuard === false) return;
    const { guardContext } = buildManagedGuardContext(event, ctx);
    const decision = guardToolResultPersistence(event.toolName, event.message, {
      ...guardContext,
      enforcementMode: outputEnforcementMode,
    });
    if (decision.warning) {
      log.warn(`[lynx-guardian] Tool result guard diagnostic: ${decision.warning}`);
    }
    if (!decision.block) return;
    return {
      message: decision.message,
    };
  });

  api.on("message_sending", async (event, ctx) => {
    appendLifecycleProbe("message_sending", event, ctx);
    let shapedContent: string | undefined;
    if (typeof event.content === "string" && resolveManagedLynxCheckPromptChannel(ctx) === "feishu") {
      const nextContent = shapeTextForProvider(event.content, "feishu");
      if (nextContent !== event.content) {
        event.content = nextContent;
        shapedContent = nextContent;
        log.info("[lynx-guardian] Outbound Feishu message shaped at message_sending");
      }
    }

    if (
      isScheduledManagedLynxCheckCronContext(ctx)
      && typeof event.content === "string"
      && isTrustedManagedLynxCheckReportText(event.content)
      && !hasConcreteDeliveryTarget(buildOutboundDeliveryTarget(event, ctx))
    ) {
      log.warn(
        `[lynx-guardian] Cancelled scheduled /lynx-check outbound message without concrete recipient session=${normalizeString(ctx.sessionKey) || "unknown"} target=${normalizeString((event as any)?.to) || "none"}`,
      );
      return { cancel: true };
    }

    if (selfSafetyGuardConfig.outputGuard === false) {
      return shapedContent ? { content: shapedContent } : undefined;
    }
    const { guardContext } = buildManagedGuardContext(event, ctx);
    const enforcement = guardOutputText(event.content, ctx.sessionKey, {
      ...guardContext,
      enforcementMode: outputEnforcementMode,
    }, {
      subject: "outbound message",
    });
    if (enforcement.warning) {
      log.warn(`[lynx-guardian] Outbound guard diagnostic: ${enforcement.warning}`);
    }
    if (enforcement.changed) {
      return { content: enforcement.content };
    }
    return shapedContent ? { content: shapedContent } : undefined;
  });

  api.on("before_tool_call", async (event, ctx) => {
    const { toolName, params } = event;
    let execBlacklistContext: CheckExecBlacklistContext | undefined;
    let trustedManagedLynxCheckToolCall = false;
    const toolFingerprint = buildOperationFingerprint({
      sessionKey: ctx.sessionKey,
      actionType: "tool",
      payload: JSON.stringify({
        toolName,
        params: params ?? null,
      }),
    });
    const approvedToolOverride = consumeApprovedOverrideFull(ctx, toolFingerprint);
    const runApprovalContext = readRunApprovalContext(ctx.runId);
    if (selfSafetyGuardConfig.toolGuard !== false) {
      try {
        const sessionKey = normalizeString(ctx.sessionKey);
        const activeManagedLynxCheckRun = sessionKey
          ? readLatestPendingLynxCheckRunIntent(sessionKey)
          : null;
        const managedLynxCheckPreauthorized = activeManagedLynxCheckRun != null
          ? isManagedLynxCheckPreauthorized(activeManagedLynxCheckRun.source)
          : false;
        const managedGuardContext = {
          ...ctx,
          managedLynxCheckRun: Boolean(activeManagedLynxCheckRun),
          managedLynxCheckPreauthorized,
        };
        const guardContext = buildGuardContext(config, event, managedGuardContext);
        trustedManagedLynxCheckToolCall = guardContext.trustedManagedLynxCheckToolCall === true;
        const decision = guardToolCall(toolName, params, ctx.sessionKey, guardContext);
        execBlacklistContext = decision.contextHints;
        log.info(`[lynx-guardian]📌,Tool call risk detected: ${JSON.stringify(decision)}`);

        if (decision.block && managedLynxCheckPreauthorized) {
          log.info(`[lynx-guardian] Managed /lynx-check blocked extra tool call outside whitelist: ${toolName}`);
          return {
            block: true,
            blockReason: "[Lynx Guardian] Managed /lynx-check 已完成预计算，仅允许白名单内的内部读写与报告发送链路。",
          };
        }

        if (decision.block) {
          const policyResult = resolveRiskPolicy(decision.riskAssessment, riskPolicyConfig);
          const policyEvaluation = evaluateRiskAssessment(decision.riskAssessment);
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${decision.riskAssessment.description}`);
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:tool] ${toolName} ${decision.riskAssessment.modules.join(",")}`,
              ),
              policyEvaluation.legacyRiskLevel,
            );
          } catch {

          }

          const approvalRiskLevel = toApprovalRiskLevel(decision.riskAssessment.level);
          const primaryModule = decision.riskAssessment.modules[0];
          if (!policyResult.override.allowed || !approvalRiskLevel || !primaryModule) {
            return {
              block: true,
              blockReason: decision.blockReason ?? `[Lynx Guardian] ${decision.riskAssessment.description}`,
            };
          }

          const matchingGrant = matchApprovalGrant({
            runId: ctx.runId,
            requesterOuId: runApprovalContext?.requesterOuId,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
          });
          if (matchingGrant) {
            log.info(
              `[lynx-guardian] approval grant hit run=${ctx.runId ?? "no-run"} module=${primaryModule} risk=${approvalRiskLevel}`,
            );
            return;
          }

          const approvalId = `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`;
          const pendingApproval = ctx.runId
            ? getOrCreatePendingToolApproval({
                runId: ctx.runId,
                requesterOuId: runApprovalContext?.requesterOuId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
                pendingId: approvalId,
              })
            : undefined;
          if (pendingApproval?.pending && !pendingApproval.created) {
            const resolution = await pendingApproval.pending.wait();
            if (resolution === "allow-once" || resolution === "allow-always") {
              return;
            }
            if (resolution === "deny") {
              return { block: true, blockReason: "Denied by user" };
            }
            if (resolution === "cancelled") {
              return { block: true, blockReason: "Approval cancelled" };
            }
            return { block: true, blockReason: "Approval timed out" };
          }
          const { resolveApproval } = await prepareToolApprovalHandlers({
            ctx,
            runId: ctx.runId,
            requesterOuId: runApprovalContext?.requesterOuId,
            conversationId: runApprovalContext?.conversationId,
            approverOuIds: localApprovalApproverOuIds,
            approvalId,
            toolName,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
            timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
            grantWindowMs: riskPolicyConfig.grantWindowMs,
            pendingApproval,
          });
          return {
            requireApproval: buildToolApprovalRequest({
              toolName,
              module: primaryModule,
              riskLevel: approvalRiskLevel,
              description: decision.blockReason ?? `[Lynx Guardian] ${decision.riskAssessment.description}`,
              timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
              onResolution: resolveApproval,
            }),
          };
        }

        if (decision.block && !approvedToolOverride) {
          const ctxKeys = resolveOverrideKeys(ctx);
          const workflowAuth = getWorkflowAuth(ctxKeys, decision.riskAssessment.modules);
          if (workflowAuth) {
            recordWorkflowOperation(ctxKeys, {
              timestamp: Date.now(),
              toolName,
              paramSummary: buildParamSummary(toolName, params ?? {}),
              triggeredModules: decision.riskAssessment.modules,
              riskScore: decision.riskAssessment.score,
              riskLevel: decision.riskAssessment.level,
            });
            log.info(`[lynx-guardian] 已有待确认操作，本次操作${toolName}将在确认后一并放行。(modules: ${decision.riskAssessment.modules.join(",")})`);
          }
        }

        if (decision.block && !approvedToolOverride && !getWorkflowAuth(resolveOverrideKeys(ctx), decision.riskAssessment.modules)) {
          const policyResult = resolveRiskPolicy(decision.riskAssessment, riskPolicyConfig);
          const policyEvaluation = evaluateRiskAssessment(decision.riskAssessment);
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${decision.riskAssessment.description}`);
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:tool] ${toolName} ${decision.riskAssessment.modules.join(",")}`,
              ),
              policyEvaluation.legacyRiskLevel,
            );
          } catch {

          }
          if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
            const alreadyPending = resolveOverrideKeys(ctx).some(k => getPendingOverride(k));
            savePendingOverrideFull(ctx, {
              operationFingerprint: toolFingerprint,
              createdAt: Date.now(),
              expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
              actionType: "tool",
              replayPayload: {
                toolName,
                params: params ?? null,
              },
              riskScore: decision.riskAssessment.score,
              riskLevel: decision.riskAssessment.level,
              matchedModules: decision.riskAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });

            if (alreadyPending) {
              log.info(`[lynx-guardian] P2: additional block merged into existing pending (${toolName})`);
              return {
                block: true,
                blockReason: `[Lynx Guardian] 🛡已有待确认操作，本次操作${toolName}将在确认后一并放行。`,
              };
            }
            return {
              block: true,
              blockReason: buildOverridePrompt(
                decision.blockReason ?? `[Lynx Guardian] ${decision.riskAssessment.description}`,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            };
          }
          return {
            block: true,
            blockReason: decision.blockReason!,
          };
        }
      } catch (err: any) {
        log.error(`[lynx-guardian] Self-safety-guard tool check error: ${err.message}`);
      }
    }

    if (trustedManagedLynxCheckToolCall) {
      log.info(`[lynx-guardian] Managed /lynx-check trusted tool passthrough: ${toolName}`);
      return;
    }

    if (skillGuardConfig.enabled !== false && skillGuardConfig.blockMalicious !== false) {
      try {
        const installAttempt = detectSkillInstall(toolName, params);
        if (installAttempt) {
          log.info(`[lynx-guardian]📌,Skill install detected: ${JSON.stringify(installAttempt)}`);
          log.info(`[lynx-guardian] Skill install detected: ${installAttempt.skillName} via ${installAttempt.installMethod}`);

          const quick = quickBlacklistCheck(installAttempt.skillName);
          if (quick.blocked) {
            log.warn(`[lynx-guardian] 🛡Malicious Skill blocked: ${installAttempt.skillName} ${quick.reason}`);
            try {
              await pushRecord(userId, `[SkillGuard] blocked: ${installAttempt.skillName} (${quick.reason})`, 3);
            } catch {

            }
            return {
              block: true,
              blockReason: `[Lynx Guardian] 🛡恶意Skill拦截: "${installAttempt.skillName}" ${quick.reason}`,
            };
          }

          const fetchRemote = async (): Promise<MaliciousSkillEntry[] | null> => {
            try {
              const res = await fetchMaliciousSkillBlacklist();
              if (res.code === 0 && res.result?.entries) {
                return res.result.entries.map((e) => ({
                  ...e,
                  namePattern: e.namePattern ? new RegExp(e.namePattern) : undefined,
                }));
              }
            } catch {
              /* remote unavailable */
            }
            return null;
          };

          const assessment = await assessSkillRisk(installAttempt, fetchRemote);
          log.info(`[lynx-guardian]📌,Skill assess risk detected: ${JSON.stringify(assessment)}`);
          if (assessment.block) {
            log.warn(`[lynx-guardian] ${assessment.message}`);
            try {
              await pushRecord(userId, `[SkillGuard] ${assessment.level}: ${installAttempt.skillName}`, 3);
            } catch {

            }

            if (skillGuardConfig.autoQuarantine && installAttempt.skillPath) {
              try {
                const { existsSync: existsOnDisk } = await import("fs");
                if (existsOnDisk(installAttempt.skillPath)) {
                  quarantineSkill(installAttempt.skillPath, assessment.reasons.join("; "));
                  log.warn(`[lynx-guardian] Auto-quarantined: ${installAttempt.skillName}`);
                }
              } catch {

              }
            }

            return {
              block: true,
              blockReason: assessment.message,
            };
          }

          if (assessment.level === "warning") {
            log.warn(`[lynx-guardian] ${assessment.message}`);
            try {
              await pushRecord(userId, `[SkillGuard] warning: ${installAttempt.skillName}`, 1);
            } catch {

            }
          }
        }
      } catch (err: any) {
        log.error(`[lynx-guardian] Skill guard check error: ${err.message}`);
      }
    }

    let match = null;
    if (toolName === "exec") {
      const command = (params?.command ?? "") as string;
      match = checkExecBlacklist(typeof command === "string" ? command : "", execBlacklistContext);
    } else if (toolName === "write" || toolName === "edit") {
      const rawPath = (params?.file_path ?? params?.path ?? "") as string;
      log.info(`[lynx-guardian] Raw path: ${rawPath}`);
      const safePath = canonicalizePath(typeof rawPath === "string" ? rawPath : "");
      match = checkPathBlacklist(safePath);
    }
    log.info(`[lynx-guardian] Tool call: ${toolName} | ${JSON.stringify(params)}`);
    if (!match) return;

    log.warn(`[lynx-guardian] Blacklist hit: ${toolName} | ${match.reason}`);

    const detail = toolName === "exec" ? (params?.command ?? "") : (params?.file_path ?? params?.path ?? "");
    const blacklistModules = inferBlacklistModules(toolName, match.reason);
    const ctxKeys = resolveOverrideKeys(ctx);
    const blacklistWorkflowAuth = getWorkflowAuth(ctxKeys, blacklistModules);
    if (blacklistWorkflowAuth) {
      recordWorkflowOperation(ctxKeys, {
        timestamp: Date.now(),
        toolName,
        paramSummary: buildParamSummary(toolName, params ?? {}),
        triggeredModules: blacklistModules,
        riskScore: match.level === "critical" ? 9 : 6,
        riskLevel: match.level === "critical" ? "L4" : "L2",
      });
      log.info(`[lynx-guardian] Workflow auth reused for blacklist hit: ${toolName} (${match.reason})`);
      return;
    }
    const contentToReport = toolName === "exec" ? `执行 ${detail} 命令` : `${toolName} ${detail}`;

    try {
      const riskLevel = match.level === "critical" ? 3 : 2;
      await pushRecord(userId, contentToReport, riskLevel);
    } catch (err: any) {
      log.error(`[lynx-guardian] Failed to push blacklist record: ${err.message}`);
    }

    try {
      const userContext = readRecentContext(ctx.sessionKey);
      log.info(`[lynx-guardian]📌,User context: ${userContext}`);
      const content = `是否${match.reason} ${detail}？用户：${userContext}`;

      const res = await checkTool(userId, content);
      const adaptedToolCheck = adaptToolCheckResult(res.result);
      log.info(`[lynx-guardian]📌,Tool check result: ${JSON.stringify(res)}`);
      // Blacklist hits always require confirmation via the plugin's pending-override
      // mechanism, even when tool_check returns safe (risk_level=0).
      // "tool_check safe" means the user asked for the operation — that is necessary
      // but not sufficient. The plugin's confirmation phrase is the actual gate.
      // Floor to the blacklist's own severity so we never silently allow a blacklist hit.
      const rawRiskLevel = adaptedToolCheck.externalRiskLevel;
      const blacklistFloor = match.level === "critical" ? 3 : 2;
      const riskLevel = Math.max(rawRiskLevel, blacklistFloor);

      log.info(`[lynx-guardian] Tool check result: risk=${rawRiskLevel} (effective=${riskLevel}, blacklistFloor=${blacklistFloor})`);

      if (riskLevel >= 2) {
        const apiAssessment = {
          ...buildApiRiskAssessment(
            riskLevel,
            `API tool risk: ${match.reason}${adaptedToolCheck.content ? ` (${adaptedToolCheck.content})` : ""}`,
          ),
          modules: blacklistModules,
        };
        const policyResult = resolveRiskPolicy(apiAssessment, riskPolicyConfig);
        const approvalRiskLevel = toApprovalRiskLevel(apiAssessment.level);
        const primaryModule = blacklistModules[0];
        if (policyResult.override.allowed && approvalRiskLevel && primaryModule) {
          const matchingGrant = matchApprovalGrant({
            runId: ctx.runId,
            requesterOuId: runApprovalContext?.requesterOuId,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
          });
          if (matchingGrant) {
            log.info(
              `[lynx-guardian] approval grant hit run=${ctx.runId ?? "no-run"} module=${primaryModule} risk=${approvalRiskLevel}`,
            );
            return;
          }

          const approvalId = `lynx:blacklist:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`;
          const pendingApproval = ctx.runId
            ? getOrCreatePendingToolApproval({
                runId: ctx.runId,
                requesterOuId: runApprovalContext?.requesterOuId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
                pendingId: approvalId,
              })
            : undefined;
          if (pendingApproval?.pending && !pendingApproval.created) {
            const resolution = await pendingApproval.pending.wait();
            if (resolution === "allow-once" || resolution === "allow-always") {
              return;
            }
            if (resolution === "deny") {
              return { block: true, blockReason: "Denied by user" };
            }
            if (resolution === "cancelled") {
              return { block: true, blockReason: "Approval cancelled" };
            }
            return { block: true, blockReason: "Approval timed out" };
          }
          const { resolveApproval } = await prepareToolApprovalHandlers({
            ctx,
            runId: ctx.runId,
            requesterOuId: runApprovalContext?.requesterOuId,
            conversationId: runApprovalContext?.conversationId,
            approverOuIds: localApprovalApproverOuIds,
            approvalId,
            toolName,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
            timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
            grantWindowMs: riskPolicyConfig.grantWindowMs,
            pendingApproval,
          });
          return {
            requireApproval: buildToolApprovalRequest({
              toolName,
              module: primaryModule,
              riskLevel: approvalRiskLevel,
              description: `[Lynx Guardian] Risk Level ${riskLevel}: ${match.reason}`,
              timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
              onResolution: resolveApproval,
            }),
          };
        }

        return {
          block: true,
          blockReason: `[Lynx Guardian] ${riskLevel >= 3 ? "High-risk tool call blocked" : "Tool call blocked"} (Risk Level ${riskLevel}): ${match.reason}`,
        };
      }

      if (riskLevel >= 2 && !approvedToolOverride) {
        const apiAssessment = {
          ...buildApiRiskAssessment(
            riskLevel,
            `API tool risk: ${match.reason}${adaptedToolCheck.content ? ` (${adaptedToolCheck.content})` : ""}`,
          ),
          modules: blacklistModules,
        };
        const policyResult = resolveRiskPolicy(apiAssessment, riskPolicyConfig);
        if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
          savePendingOverrideFull(ctx, {
            operationFingerprint: toolFingerprint,
            createdAt: Date.now(),
            expiresAt: Date.now() + riskPolicyConfig.overrideTtlMs,
            actionType: "tool",
            replayPayload: {
              toolName,
              params: params ?? null,
            },
            riskScore: apiAssessment.score,
            riskLevel: apiAssessment.level,
            matchedModules: blacklistModules,
            sourceKeys: ctxKeys,
          });
          return {
            block: true,
            blockReason: buildOverridePrompt(
              `[Lynx Guardian] ${riskLevel >= 3 ? "高危操作被拦截" : "中危操作需确认"} (Risk Level ${riskLevel}): ${match.reason}`,
              policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
            ),
          };
        }
      }

      if (riskLevel >= 3 && !approvedToolOverride) {
        return {
          block: true,
          blockReason: `[Lynx Guardian] 高危操作被拦截(Risk Level ${riskLevel}): ${match.reason}`,
        };
      } else if (riskLevel === 2 && !approvedToolOverride) {
        return {
          block: true,
          blockReason: `[Lynx Guardian] 中危操作需确认: ${match.reason}. 请明确回复"同意"后重试。`,
        };
      } else if (riskLevel >= 2) {
        log.info(`[lynx-guardian] One-time override consumed for tool risk: ${toolName}`);
        return;
      } else if (riskLevel === 1) {
        log.info(`[lynx-guardian] 识别到内容风险 ${res.result.content}`);
        return;
      } else {
        return;
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] Tool check failed: ${err.message}`);
      if (match.level === "critical") {
        return {
          block: true,
          blockReason: `[Lynx Guardian] 安全检测失败(高危操作): ${err.message}`,
        };
      }
      log.warn(`[lynx-guardian] API unreachable, allowing warning-level operation: ${match.reason}`);
      return;
    }
  });

  api.on("after_tool_call", async (event, ctx) => {
    appendLifecycleProbe("after_tool_call", event, ctx);
  });

  api.on("session_start", async (event, ctx) => {
    appendLifecycleProbe("session_start", event, ctx);
    rememberRecentActiveDeliveryTarget(ctx, { allowRouteOnly: true });
  });

  api.on("session_end", async (event, ctx) => {
    appendLifecycleProbe("session_end", event, ctx);
    clearRecentActiveDeliveryTargetForContext(ctx);
  });
}
