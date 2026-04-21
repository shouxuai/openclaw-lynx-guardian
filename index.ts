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
import type { GuardDecision } from "./src/guard/safety-guard.js";
import {
  enforceGuardDecisionText,
  guardAssistantPersistence,
  guardOutputText,
  guardToolResultPersistence,
} from "./src/guard/result-guard.js";
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
import { buildApprovalRequestFingerprint } from "./src/runtime/approval-request-fingerprint.js";
import {
  consumeFeishuLocalApprovalGrant,
  saveFeishuLocalApprovalGrant,
} from "./src/runtime/feishu-local-approval-grant-store.js";
import {
  consumeFeishuLocalApprovalReplay,
  saveFeishuLocalApprovalReplay,
} from "./src/runtime/feishu-local-approval-replay-store.js";
import {
  buildToolApprovalRequest,
  persistGrantFromApproval,
  toApprovalRiskLevel,
} from "./src/runtime/tool-approval-runtime.js";
import { resolvePluginApprovalCompat } from "./src/runtime/plugin-approval-compat.js";
import { getOrCreatePendingToolApproval } from "./src/runtime/pending-tool-approval-store.js";
import {
  discardLocalToolApproval,
  listLocalToolApprovalsForSession,
  readLocalToolApprovalByToken,
  registerLocalToolApproval,
} from "./src/runtime/local-tool-approval-store.js";
import {
  matchFeishuRunContinuation,
  saveFeishuRunContinuation,
} from "./src/runtime/feishu-run-continuation-store.js";
import { deliverLynxFeishuApprovalPromptDirectly } from "./src/runtime/lynx-feishu-direct-delivery.js";
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
  evaluateGuardDecisionPolicy,
  evaluateRiskAssessment,
  formatWorkflowAuthSummary,
  normalizePolicyConfig,
} from "./src/runtime/policy-runtime.js";
import {
  LOCAL_TOOL_APPROVAL_COMMAND,
  buildForcedAgentStartDenyContext,
  buildToolApprovalRoute,
  isConfirmationPhrase,
  mergeApprovalContextSeed,
  normalizeFeishuConversationId,
  normalizeOuIdList,
  parseLocalToolApprovalReply,
  recoverFeishuDmApprovalContextFromRecentRoute,
  rememberInboundRequesterProvenance,
  resolveActorOuId,
  resolveAgentStartPromptText,
  resolveChannelApprovalTransport,
  resolveChannelProfile,
  resolveGuardPolicyState,
  resolveManagedLynxCheckCommandText,
} from "./src/runtime/plugin-entry-helpers.js";
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
  getRecentActiveDeliveryTargets,
  readRecentActiveDeliverySnapshots,
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
import {
  buildDeliveryTargetSnapshot,
  buildFeishuNativeToolApprovalReplyPrompt,
  buildOutboundDeliveryTarget,
  createPluginSetupHelpers,
  resolveManagedLynxCheckPromptChannel,
  resolveManagedLynxCheckSource,
  resolveToolApprovalProtectedTargetSummary,
} from "./src/runtime/plugin-setup-helpers.js";

export default function setup(api: OpenClawPluginApi) {
  const log = api.logger;
  log.info("[lynx-guardian] Plugin loading...");
  const sensitiveDataBlocker = new SensitiveDataBlocker();
  const config = resolvePluginRuntimeConfig(api.config, log);
  const selfSafetyGuardConfig = config.selfSafetyGuard ?? {};
  const outputEnforcementMode = selfSafetyGuardConfig.outputEnforcementMode ?? "block";
  const riskPolicyConfig = normalizePolicyConfig((selfSafetyGuardConfig as any).policy ?? {});
  const trustedOwnerOuIds = normalizeOuIdList((selfSafetyGuardConfig as any)?.ownerVerification?.trustedUserIds);
  const localApprovalApproverOuIds = trustedOwnerOuIds;
  log.info(
    `[lynx-guardian] Approval identity config trustedOwnerOuIds=${JSON.stringify(trustedOwnerOuIds)} localApprovalOwnerOuIds=${JSON.stringify(localApprovalApproverOuIds)}`,
  );
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
  const runtimeVersion = getOpenClawRuntimeVersion();
  const hookCapabilityReport = getHookCapabilityReport(runtimeVersion);
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

  const {
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
  } = createPluginSetupHelpers({
    config,
    hookProbeLogPath: HOOK_PROBE_LOG_PATH,
    localApprovalApproverOuIds,
    log,
    managedLynxCheckAuthorizationConfig,
    riskPolicyConfig,
    scheduledLynxCheckConfig,
  });

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
    `[lynx-guardian] OpenClaw 服务探测配置已从 ${discoveryRuntime.path} 加载，当前 fullScan=${openClawDiscoveryConfig.fullScan === true ? "true" : "false"}`,
  );

  // Startup Security Audit (SX-security-audit)
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
            log.warn(`[lynx-guardian] Security audit found ${report.summary.by_severity.critical} critical and ${report.summary.by_severity.high} high severity issues`);
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
          log.warn(`[lynx-guardian] Malicious script scan found ${findings.length} issues in skills`);
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
          log.warn(`[lynx-guardian] Skill integrity check: ${invalid.length} Skill(s) with hash mismatch`);
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
              log.warn(`[lynx-guardian] ${budget.alert}`);
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
    const text = normalizeString(event?.content) || "";
    const localApprovalReply = parseLocalToolApprovalReply(text);
    if (localApprovalReply) {
      const channelProfile = resolveChannelProfile(
        ctx?.messageProvider ?? ctx?.channelId ?? ctx?.channel ?? event?.channel,
      );
      if (channelProfile !== "feishu") {
        return { handled: false };
      }
      log.info(
        `[lynx-guardian] before_dispatch local approval reply token=${localApprovalReply.token ?? "none"} resolution=${localApprovalReply.resolution}`,
      );
      const resolution = resolveFeishuLocalToolApprovalReply({
        event,
        ctx,
        localApprovalReply,
      });
      if (resolution.handled) {
        log.info(
          `[lynx-guardian] before_dispatch consumed local approval reply token=${localApprovalReply.token ?? "none"}`,
        );
        return {
          handled: true,
          text: resolution.replyText,
        };
      }
      log.info(
        `[lynx-guardian] before_dispatch staged local approval replay token=${localApprovalReply.token ?? "none"}`,
      );
      return {
        handled: false,
        text: resolution.replyText,
      };
    }

    rememberInboundRequesterProvenance(event, ctx);

    const channelProfile = resolveChannelProfile(
      ctx?.messageProvider ?? ctx?.channelId ?? ctx?.channel ?? event?.channel,
    );
    if (channelProfile !== "feishu") {
      return { handled: false };
    }

    return { handled: false };
  });


  api.on("message_received", async (event, ctx) => {
    try {
      if (!event.content || event.content.length === 0) return;
      rememberRecentActiveDeliveryTarget(ctx, { allowRouteOnly: true });
      log.info(`[lynx-guardian] message_received event: ${JSON.stringify(event)}`);
      log.info(`[lynx-guardian] message_received ctx: ${JSON.stringify(ctx)}`);
      const text = typeof event.content === "string"
        ? event.content
        : Array.isArray(event.content)
          ? event.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
          : String(event.content);
      log.info(`[lynx-guardian] message_received text: ${text}`);
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
        log.info(
          `[lynx-guardian] message_received observed approval command=${localApprovalReply.command} token=${localApprovalReply.token ?? "none"}; awaiting before_dispatch/native handler`,
        );
        return;
      }
      /*
      if (localApprovalReply?.command === "lynx-approve") {
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

      */
      if (sensitiveDataBlocker.containsSensitiveData(text)) {
        log.warn("[lynx-guardian] Sensitive data detected in message");
        await pushRecord(userId, text, 1);
        await sendHookFeedback(ctx, "Sensitive data detected");
        return;
      }

      rememberInboundRequesterProvenance(event, ctx);

      if (selfSafetyGuardConfig.inputGuard !== false) {
        const inputFingerprint = buildOperationFingerprint({
          sessionKey: ctx.sessionKey,
          actionType: "input",
          payload: text,
        });
        const approvedInputOverride = consumeApprovedOverrideFull(ctx, inputFingerprint);
        log.info(`[lynx-guardian] approvedInputOverride: ${JSON.stringify(approvedInputOverride)}`);
        const guardContext = buildGuardContext(config, event, ctx);
        const decision = guardInput(text, ctx.sessionKey, guardContext);
        const { guardActionRequired, policyEvaluation, effectiveAssessment, blockReason } = resolveGuardPolicyState(decision);
        log.info(`[lynx-guardian] guardInput decision: ${JSON.stringify(decision)}`);
        if (guardActionRequired && !approvedInputOverride) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked message: ${effectiveAssessment.description} (${effectiveAssessment.level}, score=${effectiveAssessment.score})`);
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG] ${effectiveAssessment.modules.join(",")}`,
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
              riskScore: effectiveAssessment.score,
              riskLevel: effectiveAssessment.level,
              matchedModules: effectiveAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });
            await sendHookFeedback(
              ctx,
              buildOverridePrompt(
                blockReason,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            );
            return;
          }
          await sendHookFeedback(ctx, blockReason);
          return;
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard warning: ${decision.warning}`);
        }
      }

      // Free-text approval is disabled. Critical non-tool review now happens
      // in the awaited before_agent_start hook so group chat messages do not
      // accidentally consume approval state.
      return;
      if (false) {

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
          log.info("[lynx-guardian] Primary pending lookup miss，尝试 fallback scan");
          pending = consumeMostRecentPendingOverride();
        }

        log.info(`[lynx-guardian] message_received pending: ${JSON.stringify(pending)}`);
        if (!pending) {
          await sendHookFeedback(ctx, "[Lynx Guardian] 当前没有待确认操作。");
          return;
          return {
            block: true,
            blockReason: "[Lynx Guardian] 当前没有可放行的待确认操作。",
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
          blockReason: `[Lynx Guardian] 已确认，工作流授权已开启（时间窗口 ${windowSec}s）。此窗口内的相关操作将自动放行，工作流结束后会自动收回并汇总操作记录。`,
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
      log.info(`[lynx-guardian] approvedInputOverride: ${JSON.stringify(approvedInputOverride)}`);
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
        const { guardActionRequired, policyEvaluation, effectiveAssessment, blockReason } = resolveGuardPolicyState(decision);
        log.info(`[lynx-guardian] guardInput decision: ${JSON.stringify(decision)}`);
        if (guardActionRequired && !approvedInputOverride) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked message: ${effectiveAssessment.description} (${effectiveAssessment.level}, score=${effectiveAssessment.score})`);
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG] ${effectiveAssessment.modules.join(",")}`,
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
              riskScore: effectiveAssessment.score,
              riskLevel: effectiveAssessment.level,
              matchedModules: effectiveAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });
            await sendHookFeedback(
              ctx,
              buildOverridePrompt(
                blockReason,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            );
            return;
            return {
              block: true,
              blockReason: buildOverridePrompt(
                blockReason,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            };
          }
          await sendHookFeedback(ctx, blockReason);
          return;
          return {
            block: true,
            blockReason,
          };
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard warning: ${decision.warning}`);
        }
      }
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] message_received handler failed: ${err.message}`);
    }
  });

  api.on("before_agent_start", async (event, ctx) => {
    try {
      if (!event.prompt && !event.messages) return;
      const sessionKey = normalizeString(ctx.sessionKey) || undefined;
      const channelId = normalizeString(ctx.channelId) || undefined;
      const promptText = resolveAgentStartPromptText(event);
      const normalizedConversationIdInput = resolveChannelProfile(channelId) === "feishu"
        ? normalizeFeishuConversationId(normalizeString((ctx as any).conversationId) || undefined)
        : (normalizeString((ctx as any).conversationId) || undefined);
      const requester = claimRequesterProvenance({
        sessionKey,
      }) ?? readRequesterProvenance({
        sessionKey,
        channelId,
        accountId: normalizeString((ctx as any).accountId) || undefined,
        conversationId: normalizedConversationIdInput,
      });
      const approvalContextSeed = mergeApprovalContextSeed(
        {
          channelProfile: requester?.channelProfile ?? resolveChannelProfile(channelId),
          approvalTransport: requester?.approvalTransport,
          requesterId: requester?.requesterId,
          requesterOuId: requester?.requesterOuId,
          accountId: requester?.accountId ?? (normalizeString(ctx.accountId) || undefined),
          conversationId: requester?.conversationId ?? (normalizeString(ctx.conversationId) || undefined),
          threadId: requester?.threadId ?? ctx.threadId,
          isGroup: requester?.isGroup === true,
        },
        recoverFeishuDmApprovalContextFromRecentRoute(),
      );
      const channelProfile = approvalContextSeed.channelProfile ?? resolveChannelProfile(channelId);
      const approvalTransport = approvalContextSeed.approvalTransport ?? resolveChannelApprovalTransport(channelProfile);
      const normalizedApprovalConversationId = channelProfile === "feishu"
        ? normalizeFeishuConversationId(
            approvalContextSeed.conversationId,
            approvalContextSeed.requesterOuId,
            approvalContextSeed.isGroup,
          )
        : approvalContextSeed.conversationId;
      if (!requester?.requesterOuId && approvalContextSeed.requesterOuId) {
        log.info(
          `[lynx-guardian] Recovered Feishu approval context before_agent_start run=${ctx.runId ?? "no-run"} requester=${approvalContextSeed.requesterOuId} conversation=${normalizedApprovalConversationId ?? approvalContextSeed.conversationId ?? "none"}`,
        );
      }
      if (ctx.runId) {
        saveRunApprovalContext({
          runId: ctx.runId,
          sessionKey,
          channelProfile,
          approvalTransport,
          requesterId: approvalContextSeed.requesterId,
          requesterOuId: approvalContextSeed.requesterOuId,
          accountId: approvalContextSeed.accountId,
          conversationId: normalizedApprovalConversationId,
          promptText,
          threadId: approvalContextSeed.threadId,
          isGroup: approvalContextSeed.isGroup,
          createdAt: Date.now(),
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
      }
      rememberRecentActiveDeliveryTarget(ctx);
      let prependContext = "";
      const localApprovalReply = parseLocalToolApprovalReply(promptText);
      if (
        localApprovalReply
        && (approvalContextSeed.channelProfile ?? resolveChannelProfile(channelId)) === "feishu"
      ) {
        const stagedReplay = consumeFeishuLocalApprovalReplay({
          sessionKey,
          approvalToken: localApprovalReply.token,
        });
        if (stagedReplay) {
          const replayConversationId = normalizeFeishuConversationId(
            stagedReplay.conversationId,
            stagedReplay.requesterOuId,
            approvalContextSeed.isGroup,
          );
          if (ctx.runId) {
            saveRunApprovalContext({
              runId: ctx.runId,
              sessionKey,
              channelProfile: "feishu",
              approvalTransport: "local-chat",
              requesterId: stagedReplay.requesterOuId,
              requesterOuId: stagedReplay.requesterOuId,
              accountId: stagedReplay.accountId ?? approvalContextSeed.accountId,
              conversationId: replayConversationId ?? normalizedApprovalConversationId,
              promptText: stagedReplay.promptText,
              threadId: approvalContextSeed.threadId,
              isGroup: approvalContextSeed.isGroup,
              createdAt: Date.now(),
              expiresAt: Date.now() + 30 * 60 * 1000,
            });
          }
          prependContext += buildFeishuApprovedReplayContext({
            promptText: stagedReplay.promptText,
            requesterOuId: stagedReplay.requesterOuId,
            conversationId: replayConversationId ?? normalizedApprovalConversationId,
          }) + "\n";
        } else {
          const localApprovalResolution = await tryResolveFeishuLocalToolApprovalReply({
            event,
            ctx,
            localApprovalReply,
          });
          if (localApprovalResolution.handled) {
            return {
              block: true,
              blockReason: localApprovalResolution.blockReason ?? "[Lynx Guardian] Local approval reply consumed.",
            };
          }
        }
      }
      let publicAccessResult: any = null;
      const ipInfo = await baseIpInfo();
      if (ipInfo.type == "next_check") {
        publicAccessResult = await checkPublicAccess(userId, ipInfo.ip, ipInfo.port);
        if (publicAccessResult.result.is_public) {
          log.error("[lynx-guardian] Public access check failed");
          const warning = `重要提醒：当前 IP ${ipInfo.ip} 暴露在公网环境，强烈建议配置防火墙规则，仅开放必要端口。\n`;
          prependContext += warning;
        } else {
          log.info("[lynx-guardian] Public access check passed");
        }
      }

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
        prependContext += "[system] Do not tell the user to refresh later or check back after a delay. If needed, only state that the plugin will proactively deliver the full report.\n";
      }

      if (selfSafetyGuardConfig.inputGuard !== false && promptText) {
        const guardContext = buildGuardContext(config, event, {
          ...ctx,
          requesterId: approvalContextSeed.requesterId ?? approvalContextSeed.requesterOuId,
          requesterOuId: approvalContextSeed.requesterOuId,
          senderId: normalizeString(ctx?.senderId) || approvalContextSeed.requesterId || approvalContextSeed.requesterOuId,
          senderOpenId: normalizeString((ctx as any)?.senderOpenId) || approvalContextSeed.requesterOuId,
          channelId: normalizeString(ctx?.channelId) || (channelProfile === "other" ? undefined : channelProfile),
          messageProvider: normalizeString((ctx as any)?.messageProvider ?? ctx?.source) || (channelProfile === "other" ? undefined : channelProfile),
          verifiedOwner: approvalContextSeed.requesterOuId
            ? localApprovalApproverOuIds.includes(approvalContextSeed.requesterOuId)
            : ctx?.verifiedOwner,
          managedLynxCheckRun: managedLynxCheckSource != null,
          managedLynxCheckPreauthorized,
        });
        const decision = guardInput(promptText, ctx.sessionKey, guardContext);
        const { guardActionRequired, policyEvaluation, effectiveAssessment, blockReason } = resolveGuardPolicyState(decision);
        if (guardActionRequired && !managedLynxCheckPreauthorized) {
          const shouldInjectForcedDenyContext = normalizeString(effectiveAssessment.level) === "L4";
          const denyPrependContext = shouldInjectForcedDenyContext
            ? [
              prependContext.trim(),
              buildForcedAgentStartDenyContext({
                riskLevel: effectiveAssessment.level,
                reason: blockReason,
              }),
            ]
              .filter(Boolean)
              .join("\n")
            : prependContext.trim() || undefined;
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${effectiveAssessment.description}`);
          log.info(
            `[lynx-guardian] before_agent_start denyContext injected=${String(shouldInjectForcedDenyContext)} risk=${effectiveAssessment.level}`,
          );
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:agent_start] ${effectiveAssessment.modules.join(",")}`,
              ),
              policyEvaluation.legacyRiskLevel,
            );
          } catch {

          }
          return {
            block: true,
            blockReason,
            prependContext: denyPrependContext,
          } as any;
        }
        log.info(`[lynx-guardian] guardInput decision: ${JSON.stringify(decision)}`);
        if (guardActionRequired && managedLynxCheckPreauthorized) {
          log.info("[lynx-guardian] Managed /lynx-check preauthorized agent_start passthrough");
        } else if (guardActionRequired && !approvedAgentStartOverride) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${effectiveAssessment.description}`);
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:agent_start] ${effectiveAssessment.modules.join(",")}`,
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
              riskScore: effectiveAssessment.score,
              riskLevel: effectiveAssessment.level,
              matchedModules: effectiveAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });
            return {
              block: true,
              blockReason: buildOverridePrompt(
                blockReason,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            } as any;
          }
          return {
            block: true,
            blockReason,
          } as any;
        }
        if (decision.warning) {
          prependContext += `${decision.warning}\n`;
        }
        // 弱信号预警注入：L1/L2 不阻断时，向模型注入安全上下文让模型参与防御
        if (!guardActionRequired) {
          const lvl = effectiveAssessment.level;
          if ((lvl === "L1" || lvl === "L2") && effectiveAssessment.modules.length > 0) {
            const injection = buildSecurityAwarenessInjection(effectiveAssessment.modules);
            if (injection?.hasContent) {
              prependContext += injection.injectionText;
              log.info(`[lynx-guardian] 安全预警注入：modules=${effectiveAssessment.modules.join(",")}`);
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
      log.info(`[lynx-guardian] Input risk detected: ${JSON.stringify(res)}`);
      if (adaptedContentCheck.externalRiskLevel > 0) {
        let warning = `重要提醒：内容包含内容风险（${inputCategorySummary}），\n`;
        if (inputCategorySummary.includes("个人隐私")) {
          warning += "包含隐私内容，需要先进行脱敏处理。";
        } else if (!adaptedContentCheck.categoryChain.levelOne.includes("其他")) {
          warning += "包含价值观相关风险，请进行正向引导。";
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
        const { guardActionRequired, policyEvaluation, effectiveAssessment } = resolveGuardPolicyState(decision);
        log.info(`[lynx-guardian] Output risk detected: ${JSON.stringify(decision)}`);
        if (guardActionRequired) {
          const enforcement = enforceGuardDecisionText(
            output,
            {
              block: true,
              warning: decision.warning,
              riskAssessment: effectiveAssessment,
            },
            {
              ...guardContext,
              enforcementMode: outputEnforcementMode,
            },
            {
              subject: "assistant output",
            },
          );
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
                `[SSG:output] ${effectiveAssessment.modules.join(",")}`,
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
        log.info(`[lynx-guardian] Output risk detected: ${JSON.stringify(res)}`);
        if (adaptedContentCheck.externalRiskLevel > 0) {
          let warning = `重要提醒：内容包含内容风险（${outputCategorySummary}）。`;
          if (outputCategorySummary.includes("个人隐私")) {
            warning += "隐私内容需要先进行脱敏处理，请勿在非必要场景直接提供。";
          } else {
            warning += "lynx-guardian 插件已进行拦截。";
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
    if (typeof event.content === "string" && resolveOutboundPromptChannel(event, ctx) === "feishu") {
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
    log.info(`[lynx-guardian] before_tool_call tool=${JSON.stringify(toolName)} params=${JSON.stringify(params)}`);
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
    const fallbackFeishuApprovalContext = recoverFeishuDmApprovalContextFromRecentRoute();
    const effectiveRunApprovalContext = mergeApprovalContextSeed(
      {
        channelProfile: runApprovalContext?.channelProfile,
        approvalTransport: runApprovalContext?.approvalTransport,
        requesterId: runApprovalContext?.requesterId,
        requesterOuId: runApprovalContext?.requesterOuId,
        accountId: runApprovalContext?.accountId,
        conversationId: runApprovalContext?.conversationId,
        threadId: runApprovalContext?.threadId,
        isGroup: runApprovalContext?.isGroup === true,
      },
      fallbackFeishuApprovalContext,
    );
    const approvalRoute = buildToolApprovalRoute({
      ctx,
      currentApprovalContext: effectiveRunApprovalContext,
      recoveredFeishuApprovalContext: fallbackFeishuApprovalContext,
      approverOuIds: localApprovalApproverOuIds,
    });
    log.info(`[lynx-guardian] before_tool_call runApprovalContext=${JSON.stringify(runApprovalContext)}`);
    log.info(`[lynx-guardian] before_tool_call effectiveRunApprovalContext=${JSON.stringify(effectiveRunApprovalContext)}`);
    log.info(`[lynx-guardian] before_tool_call approvalRoute=${JSON.stringify({
      compatMode: approvalRoute.compatMode,
      runtimeVersion: approvalRoute.runtimeVersion,
      runtimeTier: approvalRoute.runtimeTier,
      channelProfile: approvalRoute.channelProfile,
      approvalTransport: approvalRoute.approvalTransport,
      requesterOuId: approvalRoute.requesterOuId,
      conversationId: approvalRoute.conversationId,
    })}`);
    if (!runApprovalContext?.requesterOuId && effectiveRunApprovalContext.requesterOuId) {
      log.info(
        `[lynx-guardian] Recovered Feishu approval context before_tool_call run=${ctx.runId ?? "no-run"} requester=${effectiveRunApprovalContext.requesterOuId} conversation=${effectiveRunApprovalContext.conversationId ?? "none"}`,
      );
    }
    log.info(`[lynx-guardian] before_tool_call toolGuardEnabled=${String(selfSafetyGuardConfig.toolGuard !== false)}`);
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
          requesterId: effectiveRunApprovalContext.requesterId ?? effectiveRunApprovalContext.requesterOuId,
          requesterOuId: effectiveRunApprovalContext.requesterOuId,
          senderId: normalizeString(ctx?.senderId) || effectiveRunApprovalContext.requesterId || effectiveRunApprovalContext.requesterOuId,
          senderOpenId: normalizeString((ctx as any)?.senderOpenId) || effectiveRunApprovalContext.requesterOuId,
          channelId: normalizeString(ctx?.channelId ?? ctx?.channel) || (effectiveRunApprovalContext.channelProfile === "other" ? undefined : effectiveRunApprovalContext.channelProfile),
          messageProvider: normalizeString((ctx as any)?.messageProvider ?? ctx?.source) || (effectiveRunApprovalContext.channelProfile === "other" ? undefined : effectiveRunApprovalContext.channelProfile),
          verifiedOwner: effectiveRunApprovalContext.requesterOuId
            ? localApprovalApproverOuIds.includes(effectiveRunApprovalContext.requesterOuId)
            : ctx?.verifiedOwner,
          managedLynxCheckRun: Boolean(activeManagedLynxCheckRun),
          managedLynxCheckPreauthorized,
        };
        log.info(`[lynx-guardian] before_tool_call managedGuardContext=${JSON.stringify(managedGuardContext)}`);
        log.info(`[lynx-guardian] before_tool_call managedLynxCheckPreauthorized=${JSON.stringify(managedLynxCheckPreauthorized)}`);
        const guardContext = buildGuardContext(config, event, managedGuardContext);
        log.info(`[lynx-guardian] before_tool_call guardContext=${JSON.stringify(guardContext)}`);
        trustedManagedLynxCheckToolCall = guardContext.trustedManagedLynxCheckToolCall === true;
        const decision = guardToolCall(toolName, params, ctx.sessionKey, guardContext);
        const { guardActionRequired, policyEvaluation, effectiveAssessment, blockReason } = resolveGuardPolicyState(decision);
        log.info(`[lynx-guardian] before_tool_call decision=${JSON.stringify(decision)}`);
        execBlacklistContext = decision.contextHints;
        log.info(`[lynx-guardian] before_tool_call execBlacklistContext=${JSON.stringify(execBlacklistContext)}`);
        log.info(`[lynx-guardian] Tool call risk detected: ${JSON.stringify(decision)}`);

        if (guardActionRequired && managedLynxCheckPreauthorized) {
          log.info(`[lynx-guardian] Managed /lynx-check blocked extra tool call outside whitelist: ${toolName}`);
          return {
            block: true,
            blockReason: "[Lynx Guardian] Managed /lynx-check 已完成预计算，仅允许白名单内的内部读写与报告发送链路。",
          };
        }

        if (guardActionRequired) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${effectiveAssessment.description}`);
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:tool] ${toolName} ${effectiveAssessment.modules.join(",")}`,
              ),
              policyEvaluation.legacyRiskLevel,
            );
          } catch {

          }

          const approvalRiskLevel = toApprovalRiskLevel(effectiveAssessment.level);
          const primaryModule = effectiveAssessment.modules[0];
          if (!policyResult.override.allowed || !approvalRiskLevel || !primaryModule) {
            return {
              block: true,
              blockReason,
            };
          }

          if (approvalRoute.compatMode === "deny-no-route") {
            return {
              block: true,
              blockReason: approvalRoute.blockReason ?? "Approval unavailable",
            };
          }

          const feishuLocalApproval = await handleFeishuLocalToolApproval({
            ctx: approvalRoute.approvalCtx,
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            requesterOuId: approvalRoute.requesterOuId,
            conversationId: approvalRoute.conversationId,
            accountId: approvalRoute.accountId,
            approverOuIds: localApprovalApproverOuIds,
            approvalId: `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`,
            toolName,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
            promptText: runApprovalContext?.promptText,
            protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(toolName, params),
            timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
            grantWindowMs: riskPolicyConfig.grantWindowMs,
            approvalSessionKey: approvalRoute.sessionKey,
          });
          if (feishuLocalApproval.handled) {
            if (feishuLocalApproval.blockReason) {
              return {
                block: true,
                blockReason: feishuLocalApproval.blockReason,
              };
            }
            return;
          }

          const matchingGrant = matchApprovalGrant({
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            accountId: approvalRoute.accountId,
            conversationId: approvalRoute.conversationId,
            requesterOuId: approvalRoute.requesterOuId,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
          });
          if (matchingGrant) {
            log.info(
              `[lynx-guardian] approval grant hit source=${approvalRoute.conversationId ?? "none"} module=${primaryModule} risk=${approvalRiskLevel}`,
            );
            return;
          }

          const approvalId = `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`;
          const pendingApproval = approvalRoute.approvalTransport === "local-chat"
            ? undefined
            : ctx.runId
            ? getOrCreatePendingToolApproval({
                runId: ctx.runId,
                requesterOuId: approvalRoute.requesterOuId,
                module: primaryModule,
                riskLevel: approvalRiskLevel ?? "L2",
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
          const { resolveApproval, transport, blockReason: approvalBlockReason } = await prepareToolApprovalHandlers({
            ctx: approvalRoute.approvalCtx,
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            requesterOuId: approvalRoute.requesterOuId,
            conversationId: approvalRoute.conversationId,
            accountId: approvalRoute.accountId,
            threadId: approvalRoute.threadId,
            preferredTransport: approvalRoute.approvalTransport,
            approverOuIds: localApprovalApproverOuIds,
            approvalId,
            toolName,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
            promptText: runApprovalContext?.promptText,
            protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(toolName, params),
            timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
            grantWindowMs: riskPolicyConfig.grantWindowMs,
            pendingApproval,
          });
          if (transport === "blocked") {
            return {
              block: true,
              blockReason: approvalBlockReason ?? "Approval unavailable",
            };
          }
          if (false && ((
            approvalRoute.channelProfile === "feishu"
          ))) {
            await sendFeishuNativeToolApprovalPrompt({
              ctx: approvalRoute.approvalCtx,
              approvalId,
              requesterOuId: approvalRoute.requesterOuId,
              conversationId: approvalRoute.conversationId,
              accountId: approvalRoute.accountId,
              threadId: approvalRoute.threadId,
              content: buildFeishuNativeToolApprovalReplyPrompt({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel ?? "L2",
                toolName,
                timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
                confirmationPhrase: riskPolicyConfig.confirmationPhrase ?? "确认放行本次操作",
              }),
            });
          }
          return {
            requireApproval: buildToolApprovalRequest({
              toolName,
              module: primaryModule,
              riskLevel: approvalRiskLevel,
              description: blockReason,
              timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
              onResolution: resolveApproval,
            }),
          };
        }

        if (guardActionRequired && !approvedToolOverride) {
          const ctxKeys = resolveOverrideKeys(ctx);
          const workflowAuth = getWorkflowAuth(ctxKeys, effectiveAssessment.modules);
          if (workflowAuth) {
            recordWorkflowOperation(ctxKeys, {
              timestamp: Date.now(),
              toolName,
              paramSummary: buildParamSummary(toolName, params ?? {}),
              triggeredModules: effectiveAssessment.modules,
              riskScore: effectiveAssessment.score,
              riskLevel: effectiveAssessment.level,
            });
            log.info(`[lynx-guardian] 已有待确认操作，本次操作${toolName}将在确认后一并放行。modules: ${effectiveAssessment.modules.join(",")})`);
          }
        }

        if (guardActionRequired && !approvedToolOverride && !getWorkflowAuth(resolveOverrideKeys(ctx), effectiveAssessment.modules)) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${effectiveAssessment.description}`);
          try {
            await pushRecord(
              userId,
              buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:tool] ${toolName} ${effectiveAssessment.modules.join(",")}`,
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
              riskScore: effectiveAssessment.score,
              riskLevel: effectiveAssessment.level,
              matchedModules: effectiveAssessment.modules,
              sourceKeys: resolveOverrideKeys(ctx),
            });

            if (alreadyPending) {
              log.info(`[lynx-guardian] P2: additional block merged into existing pending (${toolName})`);
              return {
                block: true,
                blockReason: `[Lynx Guardian] 已有待确认操作，本次操作${toolName}将在确认后一并放行。`,
              };
            }
            return {
              block: true,
              blockReason: buildOverridePrompt(
                blockReason,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            };
          }
          return {
            block: true,
            blockReason,
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
          log.info(`[lynx-guardian] Skill install detected: ${JSON.stringify(installAttempt)}`);
          log.info(`[lynx-guardian] Skill install detected: ${installAttempt.skillName} via ${installAttempt.installMethod}`);

          const quick = quickBlacklistCheck(installAttempt.skillName);
          if (quick.blocked) {
            log.warn(`[lynx-guardian] Malicious Skill blocked: ${installAttempt.skillName} ${quick.reason}`);
            try {
              await pushRecord(userId, `[SkillGuard] blocked: ${installAttempt.skillName} (${quick.reason})`, 3);
            } catch {

            }
            return {
              block: true,
              blockReason: `[Lynx Guardian] 恶意 Skill 拦截: "${installAttempt.skillName}" ${quick.reason}`,
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
          log.info(`[lynx-guardian] Skill assess risk detected: ${JSON.stringify(assessment)}`);
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
      log.info(`[lynx-guardian] blacklist workflow auth hit=${JSON.stringify(blacklistWorkflowAuth)}`);
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
      log.info(`[lynx-guardian] User context: ${userContext}`);
      const content = `是否${match.reason} ${detail}？用户：${userContext}`;

      const res = await checkTool(userId, content);
      const adaptedToolCheck = adaptToolCheckResult(res.result);
      log.info(`[lynx-guardian] Tool check result: ${JSON.stringify(res)}`);
      // Blacklist hits always require confirmation via the plugin's pending-override
      // mechanism, even when tool_check returns safe (risk_level=0).
      // "tool_check safe" means the user asked for the operation - that is necessary
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
          if (approvalRoute.compatMode === "deny-no-route") {
            return {
              block: true,
              blockReason: approvalRoute.blockReason ?? "Approval unavailable",
            };
          }

          const approvalId = `lynx:blacklist:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`;
          const feishuLocalApproval = await handleFeishuLocalToolApproval({
            ctx: approvalRoute.approvalCtx,
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            requesterOuId: approvalRoute.requesterOuId,
            conversationId: approvalRoute.conversationId,
            accountId: approvalRoute.accountId,
            approverOuIds: localApprovalApproverOuIds,
            approvalId,
            toolName,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
            promptText: runApprovalContext?.promptText,
            protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(toolName, params),
            timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
            grantWindowMs: riskPolicyConfig.grantWindowMs,
            approvalSessionKey: approvalRoute.sessionKey,
          });
          if (feishuLocalApproval.handled) {
            if (feishuLocalApproval.blockReason) {
              return {
                block: true,
                blockReason: feishuLocalApproval.blockReason,
              };
            }
            return;
          }

          const matchingGrant = matchApprovalGrant({
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            accountId: approvalRoute.accountId,
            conversationId: approvalRoute.conversationId,
            requesterOuId: approvalRoute.requesterOuId,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
          });
          if (matchingGrant) {
            log.info(
              `[lynx-guardian] approval grant hit source=${approvalRoute.conversationId ?? "none"} module=${primaryModule} risk=${approvalRiskLevel}`,
            );
            return;
          }

          log.info(`[lynx-guardian] blacklist approval approvalId=${approvalId}`);
          const pendingApproval = approvalRoute.approvalTransport === "local-chat"
            ? undefined
            : ctx.runId
            ? getOrCreatePendingToolApproval({
                runId: ctx.runId,
                requesterOuId: approvalRoute.requesterOuId,
                module: primaryModule,
                riskLevel: approvalRiskLevel ?? "L2",
                timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
                pendingId: approvalId,
              })
            : undefined;
          log.info(`[lynx-guardian] blacklist approval pending=${JSON.stringify(pendingApproval)}`);
          if (pendingApproval?.pending && !pendingApproval.created) {
            const resolution = await pendingApproval.pending.wait();
            log.info(`[lynx-guardian] blacklist approval reused resolution=${JSON.stringify(resolution)}`);
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
          log.info(`[lynx-guardian] blacklist approval prepare handlers`);
          const { resolveApproval, transport, blockReason } = await prepareToolApprovalHandlers({
            ctx: approvalRoute.approvalCtx,
            channelProfile: approvalRoute.channelProfile,
            channelId: approvalRoute.channelId,
            requesterOuId: approvalRoute.requesterOuId,
            conversationId: approvalRoute.conversationId,
            accountId: approvalRoute.accountId,
            threadId: approvalRoute.threadId,
            preferredTransport: approvalRoute.approvalTransport,
            approverOuIds: localApprovalApproverOuIds,
            approvalId,
            toolName,
            module: primaryModule,
            riskLevel: approvalRiskLevel,
            promptText: runApprovalContext?.promptText,
            protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(toolName, params),
            timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
            grantWindowMs: riskPolicyConfig.grantWindowMs,
            pendingApproval,
          });
          log.info(`[lynx-guardian] blacklist approval transport=${JSON.stringify(transport)}`);
          if (transport === "blocked") {
            return {
              block: true,
              blockReason: blockReason ?? "Approval unavailable",
            };
          }
          if (false && ((
            approvalRoute.channelProfile === "feishu"
          ))) {
            await sendFeishuNativeToolApprovalPrompt({
              ctx: approvalRoute.approvalCtx,
              approvalId,
              requesterOuId: approvalRoute.requesterOuId,
              conversationId: approvalRoute.conversationId,
              accountId: approvalRoute.accountId,
              threadId: approvalRoute.threadId,
              content: buildFeishuNativeToolApprovalReplyPrompt({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel ?? "L2",
                toolName,
                timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
                confirmationPhrase: riskPolicyConfig.confirmationPhrase ?? "确认放行本次操作",
              }),
            });
          }
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
              `[Lynx Guardian] ${riskLevel >= 3 ? "High-risk tool call blocked" : "Confirmation required"} (Risk Level ${riskLevel}): ${match.reason}`,
              policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
            ),
          };
        }
      }

      if (riskLevel >= 3 && !approvedToolOverride) {
        return {
          block: true,
          blockReason: `[Lynx Guardian] 高危操作被拦截 (Risk Level ${riskLevel}): ${match.reason}`,
        };
      } else if (riskLevel === 2 && !approvedToolOverride) {
        return {
          block: true,
          blockReason: `[Lynx Guardian] Confirmation required: ${match.reason}. Reply with "同意" and retry.`,
        };
      } else if (riskLevel >= 2) {
        log.info(`[lynx-guardian] One-time override consumed for tool risk: ${toolName}`);
        return;
      } else if (riskLevel === 1) {
        log.info(`[lynx-guardian] 识别到内容风险：${res.result.content}`);
        return;
      } else {
        return;
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] Tool check failed: ${err.message}`);
      if (match.level === "critical") {
        return {
          block: true,
          blockReason: `[Lynx Guardian] 安全检测失败（高危操作）: ${err.message}`,
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
