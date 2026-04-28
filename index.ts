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
} from "./src/runtime/pending-override-store.js";
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
import {
  assessSkillRisk,
  configureSkillInventoryControlPlane,
  detectSkillInstall,
  quickBlacklistCheck,
  verifyAllInstalledSkills,
} from "./src/skills/skill-guard.js";
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
  checkContentWeighted,
  checkPublicAccessWeighted,
  checkToolWeighted,
  fetchMaliciousSkillBlacklistWeighted,
  getWeightedRiskLevel,
  isRemoteAvailable,
  pushRecordBestEffort,
  registerUserBestEffort,
} from "./src/runtime/remote-weighting-service.js";
import {
  canonicalizePath,
  buildGuardContext,
  createReplacementMessage,
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
  buildGuardPolicyTrace,
  buildApiRiskAssessment,
  buildPolicyRecordContent,
  buildOverridePrompt,
  buildParamSummary,
  evaluateGuardDecisionPolicy,
  evaluateRiskAssessment,
  normalizePolicyConfig,
} from "./src/runtime/policy-runtime.js";
import {
  LOCAL_TOOL_APPROVAL_COMMAND,
  buildForcedAgentStartDenyContext,
  buildToolApprovalRoute,
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
  configureLynxCheckTaskControlPlane,
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
import {
  createLocalConsoleTokenProvider,
  ensureLocalConsoleToken,
} from "./src/runtime/local-console-auth.js";
import { createLocalConsoleIngestClient } from "./src/runtime/local-console-client.js";
import { resolveLocalConsoleRuntimeConfig } from "./src/runtime/local-console-config.js";
import { DecisionBroker } from "./src/runtime/decision-broker.js";
import { DecisionClient } from "./src/runtime/decision-client.js";
import {
  handleBeforeAgentStartDecision,
  handleBeforeDispatchDecision,
  handleBeforeInstallEventDecision,
  handleBeforeMessageWriteDecision,
  handleBeforeToolCallDecision,
  handleLlmOutputDecision,
  handleMessageReceivedDecision,
  handleMessageSendingDecision,
  handleToolResultPersistDecision,
} from "./src/runtime/hook-decision-handlers.js";
import { createLocalConsoleGatewayRouteRegistrations } from "./src/runtime/local-console-gateway-routes.js";
import { createLocalConsoleHookHandlers } from "./src/runtime/local-console-hook-handlers.js";
import { buildLocalConsoleLynxCheckSnapshot } from "./src/runtime/local-console-lynx-check-snapshot.js";
import { createLocalConsoleSupervisor } from "./src/runtime/local-console-supervisor.js";
import { createLocalConsoleTokenHook } from "./src/runtime/local-console-token-hook.js";
import {
  appendLocalConsoleWebviewFootnote,
  appendLocalConsoleWebviewFootnoteForL4Reply,
} from "./src/runtime/local-console-webview-note.js";
import {
  buildVisibleInputGuardModelContext,
  buildVisibleInputGuardWarning,
} from "./src/runtime/visible-input-warning.js";
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

function logGuardPolicyTrace(
  log: { warn: (message: string) => void },
  stage: string,
  decision: GuardDecision,
  policyResolution: ReturnType<typeof resolveGuardPolicyState>["policyResolution"],
): void {
  const trace = buildGuardPolicyTrace({
    stage,
    assessment: decision.riskAssessment,
    resolution: policyResolution,
  });
  if (trace.shouldWarn) {
    log.warn(`[lynx-guardian] Guard policy trace: ${JSON.stringify(trace)}`);
  }
}

export default function setup(api: OpenClawPluginApi) {
  const log = api.logger;
  log.info("[lynx-guardian] Plugin loading...");
  const sensitiveDataBlocker = new SensitiveDataBlocker();
  const config = resolvePluginRuntimeConfig(api.config, log);
  const localConsoleRuntimeConfig = resolveLocalConsoleRuntimeConfig(config.localConsole);
  const localConsoleRuntime = (() => {
    if (!localConsoleRuntimeConfig.enabled) {
      return null;
    }

    try {
      ensureLocalConsoleToken(localConsoleRuntimeConfig.paths.tokenPath);
      return {
        config: localConsoleRuntimeConfig,
        client: createLocalConsoleIngestClient({
          config: localConsoleRuntimeConfig,
          logger: log,
          getToken: createLocalConsoleTokenProvider(localConsoleRuntimeConfig.paths.tokenPath),
        }),
        supervisor: createLocalConsoleSupervisor({
          config: localConsoleRuntimeConfig,
          logger: log,
        }),
      };
    } catch (error: any) {
      log.error(`[lynx-guardian] Failed to initialize local console runtime: ${error.message}`);
      return null;
    }
  })();
  if (localConsoleRuntime) {
    log.info(
      `[lynx-guardian] Local console configured host=${localConsoleRuntime.config.host} port=${localConsoleRuntime.config.port} autoStart=${String(localConsoleRuntime.config.autoStart)}`,
    );
    for (const route of createLocalConsoleGatewayRouteRegistrations({
      config: localConsoleRuntime.config,
      supervisor: localConsoleRuntime.supervisor,
      logger: log,
    })) {
      api.registerHttpRoute(route);
    }
    log.info("[lynx-guardian] Local console gateway routes registered at /webview and /lynx");
  }
  const localConsoleHooks = localConsoleRuntime
    ? createLocalConsoleHookHandlers({
      client: localConsoleRuntime.client,
      logger: log,
    })
    : null;
  configureLynxCheckTaskControlPlane(localConsoleRuntime
    ? {
      baseUrl: localConsoleRuntime.config.baseUrl,
      getToken: createLocalConsoleTokenProvider(localConsoleRuntime.config.paths.tokenPath),
      logger: log,
    }
    : undefined);
  const decisionBroker = localConsoleRuntime
    ? new DecisionBroker(new DecisionClient({
      config: localConsoleRuntime.config,
      getToken: createLocalConsoleTokenProvider(localConsoleRuntime.config.paths.tokenPath),
    }))
    : null;
  if (localConsoleRuntime) {
    configureSkillInventoryControlPlane({
      baseUrl: localConsoleRuntime.config.baseUrl,
      getToken: createLocalConsoleTokenProvider(localConsoleRuntime.config.paths.tokenPath),
      logger: log,
    });
  } else {
    configureSkillInventoryControlPlane(null);
  }
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
  const localConsoleTokenHook = localConsoleRuntime && hookCapabilityReport.supported === true
    ? createLocalConsoleTokenHook({
      client: localConsoleRuntime.client,
      logger: log,
    })
    : null;
  const appendLogWebviewNoteForL4 = (message: string, riskLevel?: string): string =>
    riskLevel === "L4" ? appendLocalConsoleWebviewFootnote(message) : message;
  const appendLogWebviewNoteForL3Approval = (message: string, riskLevel?: string): string =>
    riskLevel === "L3" ? appendLocalConsoleWebviewFootnote(message) : message;
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
    grantControlPlane: localConsoleRuntime
      ? {
        baseUrl: localConsoleRuntime.config.baseUrl,
        getToken: createLocalConsoleTokenProvider(localConsoleRuntime.config.paths.tokenPath),
      }
      : undefined,
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

    if (localConsoleRuntime) {
      process.env.LYNX_LOCAL_CONSOLE_TOKEN_USAGE_ENABLED = localConsoleTokenHook ? "true" : "false";
      if (localConsoleRuntime.config.autoStart) {
        void localConsoleRuntime.supervisor.ensureRunning("plugin-startup");
      }
    }

    userId = ensureUserRegistered();
    void registerUserBestEffort(userId, log);

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
      const backendHealthy = localConsoleRuntime
        ? await localConsoleRuntime.supervisor.probeHealth()
        : undefined;
      if (localConsoleRuntime?.config.autoStart) {
        void localConsoleRuntime.supervisor.ensureRunning("gateway_start");
      }
      localConsoleHooks?.gatewayStart({
        occurredAtMs: Date.now(),
        summary: "Gateway startup hook executed and local console startup was checked.",
        payloadJson: {
          port: event?.port,
          autoStart: localConsoleRuntime?.config.autoStart,
        },
        port: event?.port,
        autoStart: localConsoleRuntime?.config.autoStart,
        backendHealthy,
        startReason: "gateway_start",
      });
    } catch (err: any) {
      log.error(`[lynx-guardian] Failed to sync resources on gateway_start: ${err.message}`);
    }
  });

  api.on("before_dispatch", async (event, ctx) => {
    if (decisionBroker) {
      const decisionResult = await handleBeforeDispatchDecision(decisionBroker, event, ctx);
      if ((decisionResult as any)?.block) {
        return {
          handled: true,
          text: (decisionResult as any).blockReason ?? "Blocked by Lynx Guardian decision control plane.",
        };
      }
    }
    const text = normalizeString(event?.content) || "";
    const localApprovalReply = parseLocalToolApprovalReply(text);
    if (localApprovalReply) {
      const channelProfile = resolveChannelProfile(
        ctx?.messageProvider ?? ctx?.channelId ?? ctx?.channel ?? event?.channel,
      );
      if (channelProfile !== "feishu") {
        localConsoleHooks?.beforeDispatch({
          occurredAtMs: Date.now(),
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Observed local approval reply outside Feishu route.",
          localApprovalReply: true,
          specialRoute: "local_approval_reply_non_feishu",
          payloadJson: {
            resolution: localApprovalReply.resolution,
            token: localApprovalReply.token,
            channelProfile,
          },
        });
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
        localConsoleHooks?.beforeDispatch({
          occurredAtMs: Date.now(),
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Local approval reply was consumed in before_dispatch.",
          localApprovalReply: true,
          specialRoute: "local_approval_reply_consumed",
          payloadJson: {
            resolution: localApprovalReply.resolution,
            token: localApprovalReply.token,
            handled: true,
          },
        });
        return {
          handled: true,
          text: resolution.replyText,
        };
      }
      log.info(
        `[lynx-guardian] before_dispatch staged local approval replay token=${localApprovalReply.token ?? "none"}`,
      );
      localConsoleHooks?.beforeDispatch({
        occurredAtMs: Date.now(),
        sessionKey: normalizeString(ctx.sessionKey) || undefined,
        summary: "Local approval reply was staged for later replay handling.",
        localApprovalReply: true,
        specialRoute: "local_approval_reply_staged",
        payloadJson: {
          resolution: localApprovalReply.resolution,
          token: localApprovalReply.token,
          handled: false,
        },
      });
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
      if (decisionBroker) {
        handleMessageReceivedDecision(decisionBroker, event, ctx);
      }
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
      const localConsoleOccurredAtMs = Date.now();
      const lynxCheckTrigger = classifyLynxCheckTrigger(text);

      if (lynxCheckTrigger.kind === "native_passthrough") {
        log.info(`[lynx-guardian] Native check command passthrough: ${text}`);
        localConsoleHooks?.messageReceived({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Inbound native check command passed through without extra interception.",
          contentExcerpt: text,
          contentKind: "text",
          payloadJson: {
            triggerKind: lynxCheckTrigger.kind,
          },
        });
        return;
      }

      if (lynxCheckTrigger.kind === "lynx_command") {
        log.info(`[lynx-guardian] Manual /lynx-check will be handled in before_agent_start: ${text}`);
        localConsoleHooks?.messageReceived({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Manual /lynx-check command observed and deferred to before_agent_start.",
          contentExcerpt: text,
          contentKind: "text",
          payloadJson: {
            triggerKind: lynxCheckTrigger.kind,
          },
        });
        return;
      }

      const localApprovalReply = parseLocalToolApprovalReply(text);
      if (localApprovalReply) {
        log.info(
          `[lynx-guardian] message_received observed approval command=${localApprovalReply.command} token=${localApprovalReply.token ?? "none"}; awaiting before_dispatch/native handler`,
        );
        localConsoleHooks?.messageReceived({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Local approval reply observed at message_received and deferred to dispatch handling.",
          contentExcerpt: text,
          contentKind: "text",
          payloadJson: {
            command: localApprovalReply.command,
            token: localApprovalReply.token,
            resolution: localApprovalReply.resolution,
          },
        });
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
        await pushRecordBestEffort(
          {
            id: userId,
            content: text,
            riskLevel: 1,
          },
          {
            log,
            context: "message sensitive data",
          },
        );
        localConsoleHooks?.messageReceived({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Sensitive data blocker detected protected content in inbound message.",
          contentExcerpt: text,
          contentKind: "text",
          enforcementAction: "block",
          payloadJson: {
            source: "sensitive_data_blocker",
          },
        });
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
        const {
          guardActionRequired,
          policyEvaluation,
          policyResolution,
          effectiveAssessment,
          blockReason,
        } = resolveGuardPolicyState(decision);
        log.info(`[lynx-guardian] guardInput decision: ${JSON.stringify(decision)}`);
        logGuardPolicyTrace(log, "message_received", decision, policyResolution);
        const visibleInputWarning = buildVisibleInputGuardWarning({
          assessment: effectiveAssessment,
          policyDecisionKind: policyResolution.finalDecision.kind,
          warning: decision.warning,
        });
        if (guardActionRequired && !approvedInputOverride && !visibleInputWarning) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          const userFacingBlockReason = appendLogWebviewNoteForL4(blockReason, effectiveAssessment.level);
          localConsoleHooks?.messageReceived({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            summary: blockReason,
            contentExcerpt: text,
            contentKind: "text",
            primaryModule: effectiveAssessment.modules[0],
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResolution.finalDecision.kind,
            enforcementAction: "block",
            payloadJson: {
              approvedInputOverride: Boolean(approvedInputOverride),
              warning: decision.warning,
              legacyRiskLevel: policyEvaluation.legacyRiskLevel,
            },
          });
          log.warn(`[lynx-guardian] Self-safety-guard blocked message: ${effectiveAssessment.description} (${effectiveAssessment.level}, score=${effectiveAssessment.score})`);
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG] ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "message guard block",
            },
          );
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
                userFacingBlockReason,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            );
            return;
          }
          await sendHookFeedback(ctx, userFacingBlockReason);
          return;
        }
        if (visibleInputWarning) {
          log.warn(`[lynx-guardian] Self-safety-guard visible warning: ${effectiveAssessment.description} (${effectiveAssessment.level}, score=${effectiveAssessment.score})`);
          await sendHookFeedback(ctx, visibleInputWarning);
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard warning: ${decision.warning}`);
        }
        localConsoleHooks?.messageReceived({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: visibleInputWarning ?? decision.warning ?? "Inbound message passed input guard evaluation.",
          contentExcerpt: text,
          contentKind: "text",
          primaryModule: effectiveAssessment.modules[0],
          modules: effectiveAssessment.modules,
          riskLevel: effectiveAssessment.level,
          riskScore: effectiveAssessment.score,
          policyDecision: policyResolution.finalDecision.kind,
          enforcementAction: visibleInputWarning || decision.warning ? "warn" : "allow",
          payloadJson: {
            approvedInputOverride: Boolean(approvedInputOverride),
            warning: decision.warning,
            visibleInputWarning,
            guardActionRequired,
          },
        });
      }

      // Free-text approval is disabled. Critical non-tool review now happens
      // in the awaited before_agent_start hook so group chat messages do not
      // accidentally consume approval state.
      return;
    } catch (err: any) {
      log.error(`[lynx-guardian] message_received handler failed: ${err.message}`);
    }
  });

  api.on("before_agent_start", async (event, ctx) => {
    try {
      if (!event.prompt && !event.messages) return;
      if (decisionBroker) {
        const decisionResult = await handleBeforeAgentStartDecision(decisionBroker, event, ctx);
        if (decisionResult?.block) {
          return decisionResult;
        }
      }
      const sessionKey = normalizeString(ctx.sessionKey) || undefined;
      const channelId = normalizeString(ctx.channelId) || undefined;
      const promptText = resolveAgentStartPromptText(event);
      const localConsoleOccurredAtMs = Date.now();
      let localConsoleLynxCheckSnapshot: Record<string, unknown> | undefined;
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
            localConsoleHooks?.beforeAgentStart({
              occurredAtMs: localConsoleOccurredAtMs,
              sessionKey,
              runId: normalizeString(ctx.runId) || undefined,
              promptText,
              summary: localApprovalResolution.blockReason ?? "Local approval reply was consumed before agent start.",
              contentExcerpt: promptText,
              contentKind: "text",
              enforcementAction: "block",
              payloadJson: {
                localApprovalReply: true,
              },
            });
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
        const publicAccessCheck = await checkPublicAccessWeighted(userId, ipInfo.ip, ipInfo.port);
        if (!isRemoteAvailable(publicAccessCheck)) {
          log.warn(`[lynx-guardian] Public access weighting unavailable: ${publicAccessCheck.errorMessage}`);
        } else {
          publicAccessResult = publicAccessCheck.value;
          if (publicAccessResult.result.is_public) {
            log.error("[lynx-guardian] Public access check failed");
            const warning = `重要提醒：当前 IP ${ipInfo.ip} 暴露在公网环境，强烈建议配置防火墙规则，仅开放必要端口。\n`;
            prependContext += warning;
          } else {
            log.info("[lynx-guardian] Public access check passed");
          }
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
        localConsoleLynxCheckSnapshot = {
          requestId: runIntent.requestId,
          source: runIntent.source,
          trigger: runIntent.trigger,
          preferredTargetKind: runIntent.preferredTargetKind,
          sessionKey: runIntent.sessionKey,
          targetKey: runIntent.routeHint?.targetKey,
          channelId: runIntent.routeHint?.channelId,
          messageProvider: runIntent.routeHint?.messageProvider,
          status: "running",
          sendAttempted: false,
          sendSucceeded: false,
          transport: "precomputed",
          reportPath,
          createdAtMs: runIntent.createdAtMs,
        };

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
        const {
          guardActionRequired,
          policyEvaluation,
          policyResolution,
          effectiveAssessment,
          blockReason,
        } = resolveGuardPolicyState(decision);
        logGuardPolicyTrace(log, "before_agent_start", decision, policyResolution);
        const visibleInputWarning = buildVisibleInputGuardWarning({
          assessment: effectiveAssessment,
          policyDecisionKind: policyResolution.finalDecision.kind,
          warning: decision.warning,
        });
        const visibleInputWarningContext = buildVisibleInputGuardModelContext({
          assessment: effectiveAssessment,
          policyDecisionKind: policyResolution.finalDecision.kind,
          warning: decision.warning,
        });
        if (visibleInputWarningContext) {
          prependContext += `${visibleInputWarningContext}\n`;
          log.warn(`[lynx-guardian] Self-safety-guard visible agent-start warning: ${effectiveAssessment.description} (${effectiveAssessment.level}, score=${effectiveAssessment.score})`);
          localConsoleHooks?.beforeAgentStart({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey,
            runId: normalizeString(ctx.runId) || undefined,
            promptText,
            summary: visibleInputWarning ?? effectiveAssessment.description,
            contentExcerpt: promptText,
            contentKind: "text",
            primaryModule: effectiveAssessment.modules[0],
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResolution.finalDecision.kind,
            enforcementAction: "warn",
            lynxCheck: localConsoleLynxCheckSnapshot as any,
            payloadJson: {
              managedLynxCheckPreauthorized,
              legacyRiskLevel: policyEvaluation.legacyRiskLevel,
              visibleInputWarning,
            },
          });
        }
        if (guardActionRequired && !managedLynxCheckPreauthorized && !visibleInputWarningContext) {
          const shouldInjectForcedDenyContext = normalizeString(effectiveAssessment.level) === "L4";
          const userFacingBlockReason = appendLogWebviewNoteForL4(blockReason, effectiveAssessment.level);
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
          localConsoleHooks?.beforeAgentStart({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey,
            runId: normalizeString(ctx.runId) || undefined,
            promptText,
            summary: blockReason,
            contentExcerpt: promptText,
            contentKind: "text",
            primaryModule: effectiveAssessment.modules[0],
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResolution.finalDecision.kind,
            enforcementAction: "block",
            lynxCheck: localConsoleLynxCheckSnapshot as any,
            payloadJson: {
              managedLynxCheckPreauthorized,
              legacyRiskLevel: policyEvaluation.legacyRiskLevel,
              forcedDenyContext: shouldInjectForcedDenyContext,
            },
          });
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${effectiveAssessment.description}`);
          log.info(
            `[lynx-guardian] before_agent_start denyContext injected=${String(shouldInjectForcedDenyContext)} risk=${effectiveAssessment.level}`,
          );
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:agent_start] ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "agent_start forced deny",
            },
          );
          return {
            block: true,
            blockReason: userFacingBlockReason,
            prependContext: denyPrependContext,
          } as any;
        }
        log.info(`[lynx-guardian] guardInput decision: ${JSON.stringify(decision)}`);
        logGuardPolicyTrace(log, "before_agent_start", decision, policyResolution);
        if (guardActionRequired && managedLynxCheckPreauthorized) {
          log.info("[lynx-guardian] Managed /lynx-check preauthorized agent_start passthrough");
        } else if (guardActionRequired && !approvedAgentStartOverride && !visibleInputWarningContext) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          const userFacingBlockReason = appendLogWebviewNoteForL4(blockReason, effectiveAssessment.level);
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${effectiveAssessment.description}`);
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:agent_start] ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "agent_start guard block",
            },
          );
          if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
            localConsoleHooks?.beforeAgentStart({
              occurredAtMs: localConsoleOccurredAtMs,
              sessionKey,
              runId: normalizeString(ctx.runId) || undefined,
              promptText,
              summary: blockReason,
              contentExcerpt: promptText,
              contentKind: "text",
              primaryModule: effectiveAssessment.modules[0],
              modules: effectiveAssessment.modules,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResolution.finalDecision.kind,
              enforcementAction: "block",
              lynxCheck: localConsoleLynxCheckSnapshot as any,
              payloadJson: {
                managedLynxCheckPreauthorized,
                approvedAgentStartOverride: Boolean(approvedAgentStartOverride),
                overrideAllowed: true,
              },
            });
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
                userFacingBlockReason,
                policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
              ),
            } as any;
          }
          localConsoleHooks?.beforeAgentStart({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey,
            runId: normalizeString(ctx.runId) || undefined,
            promptText,
            summary: blockReason,
            contentExcerpt: promptText,
            contentKind: "text",
            primaryModule: effectiveAssessment.modules[0],
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResolution.finalDecision.kind,
            enforcementAction: "block",
            lynxCheck: localConsoleLynxCheckSnapshot as any,
            payloadJson: {
              managedLynxCheckPreauthorized,
              approvedAgentStartOverride: Boolean(approvedAgentStartOverride),
              overrideAllowed: false,
            },
          });
          return {
            block: true,
            blockReason: userFacingBlockReason,
          } as any;
        }
        if (decision.warning && !visibleInputWarningContext) {
          prependContext += `${decision.warning}\n`;
        }
        // 弱信号预警注入：L1/L2 不阻断时，向模型注入安全上下文让模型参与防御
        if (!guardActionRequired && !visibleInputWarningContext) {
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
      const remoteInputCheck = await checkContentWeighted(userId, input, 1);
      if (!isRemoteAvailable(remoteInputCheck)) {
        log.warn(`[lynx-guardian] Input weighting unavailable: ${remoteInputCheck.errorMessage}`);
      } else {
        const res = remoteInputCheck.value;
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
              localConsoleHooks?.beforeAgentStart({
                occurredAtMs: localConsoleOccurredAtMs,
                sessionKey,
                runId: normalizeString(ctx.runId) || undefined,
                promptText,
                summary: `[Lynx Guardian] ${warning}`,
                contentExcerpt: promptText,
                contentKind: "text",
                primaryModule: apiAssessment.modules[0],
                modules: apiAssessment.modules,
                riskLevel: apiAssessment.level,
                riskScore: apiAssessment.score,
                policyDecision: "confirm",
                enforcementAction: "block",
                lynxCheck: localConsoleLynxCheckSnapshot as any,
                payloadJson: {
                  apiRiskLevel: adaptedContentCheck.externalRiskLevel,
                  inputCategorySummary,
                  overrideAllowed: true,
                },
              });
              return {
                block: true,
                blockReason: buildOverridePrompt(
                  `[Lynx Guardian] ${warning}`,
                  policyResult.override.confirmationPhrase ?? riskPolicyConfig.confirmationPhrase,
                ),
              } as any;
            }
            localConsoleHooks?.beforeAgentStart({
              occurredAtMs: localConsoleOccurredAtMs,
              sessionKey,
              runId: normalizeString(ctx.runId) || undefined,
              promptText,
              summary: `[Lynx Guardian] ${warning}`,
              contentExcerpt: promptText,
              contentKind: "text",
              primaryModule: apiAssessment.modules[0],
              modules: apiAssessment.modules,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "deny",
              enforcementAction: "block",
              lynxCheck: localConsoleLynxCheckSnapshot as any,
              payloadJson: {
                apiRiskLevel: adaptedContentCheck.externalRiskLevel,
                inputCategorySummary,
                overrideAllowed: false,
              },
            });
            return {
              block: true,
              blockReason: `[Lynx Guardian] ${warning}`,
            } as any;
          }
          prependContext += warning;
        }
      }

      localConsoleHooks?.beforeAgentStart({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey,
        runId: normalizeString(ctx.runId) || undefined,
        promptText,
        summary: managedLynxCheckSource
          ? "Managed /lynx-check agent start prepared successfully."
          : "Agent start evaluation completed.",
        contentExcerpt: promptText,
        contentKind: "text",
        enforcementAction: prependContext.trim().length > 0 ? "warn" : "allow",
        lynxCheck: localConsoleLynxCheckSnapshot as any,
        payloadJson: {
          managedLynxCheckSource: managedLynxCheckSource ?? undefined,
          managedLynxCheckPreauthorized,
          prependContextLength: prependContext.length,
          publicAccessWarning: publicAccessResult?.result?.is_public === true,
        },
      });
      return {
        prependContext,
      } as any;
    } catch (err: any) {
      log.error(`[lynx-guardian] before_agent_start handler failed: ${err.message}`);
    }
  });

  api.on("agent_end", async (event, ctx) => {
    try {
      log.info(JSON.stringify(ctx));

      if (!event.messages || event.messages.length === 0) return;
      const localConsoleOccurredAtMs = Date.now();

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
        let inlineOutput = extractMessageText(event.messages[event.messages.length - 1]);
        const currentDeliveryTarget = buildDeliveryTargetSnapshot(ctx);
        const inlineManagedReportDelivered = isTrustedManagedLynxCheckReportText(inlineOutput);
        const inlineDeliveryEligible = activeRunIntent.source !== "scheduled"
          || hasConcreteDeliveryTarget(currentDeliveryTarget);

        if (inlineManagedReportDelivered) {
          const inlineOutputWithLogNote = appendLocalConsoleWebviewFootnote(inlineOutput);
          if (inlineOutputWithLogNote !== inlineOutput) {
            redactAgentOutput(event, inlineOutputWithLogNote);
            inlineOutput = inlineOutputWithLogNote;
          }
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

          const completedRunResult = writeLynxCheckRunResult(activeRunIntent.requestId, {
            status: "completed",
            sendAttempted: true,
            sendSucceeded: deliveredAttempts.length > 0,
            transport: deliveredTransports.join(",") || "none",
            deliveryAttempts,
            reportPath: existsSync(reportPath) ? reportPath : undefined,
          });
          markLynxCheckRunCompleted(activeRunIntent.requestId);
          localConsoleHooks?.agentEnd({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            runId: normalizeString((ctx as any).runId) || undefined,
            requestId: activeRunIntent.requestId,
            summary: "Managed /lynx-check inline report delivery completed during agent_end.",
            outputText: inlineOutput,
            contentExcerpt: inlineOutput,
            contentKind: "assistant_message",
            enforcementAction: "allow",
            lynxCheck: buildLocalConsoleLynxCheckSnapshot(activeRunIntent, completedRunResult),
            payloadJson: {
              deliveryAttempts: deliveryAttempts.length,
              deliveredTransports,
            },
          });
          return;
        }

        let finalRunResult = runResult;
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

          const fallbackRunResult = writeLynxCheckRunResult(activeRunIntent.requestId, {
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
          finalRunResult = fallbackRunResult;

          if (sendResult.delivered) {
            markLynxCheckRunCompleted(activeRunIntent.requestId);
          } else {
            updateLynxCheckRunIntentStatus(activeRunIntent.requestId, "failed");
          }
        }

        localConsoleHooks?.agentEnd({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          runId: normalizeString((ctx as any).runId) || undefined,
          requestId: activeRunIntent.requestId,
          summary: runResult?.status === "completed" && runResult.sendSucceeded
            ? "Managed /lynx-check run was already completed before agent_end delivery fallback."
            : "Managed /lynx-check delivery fallback was processed during agent_end.",
          outputText: inlineOutput,
          contentExcerpt: inlineOutput,
          contentKind: "assistant_message",
          enforcementAction: (finalRunResult?.status === "failed" || finalRunResult?.sendSucceeded === false) ? "warn" : "allow",
          lynxCheck: finalRunResult
            ? buildLocalConsoleLynxCheckSnapshot(activeRunIntent, finalRunResult)
            : undefined,
          payloadJson: {
            requestId: activeRunIntent.requestId,
            runResultStatus: finalRunResult?.status,
            sendSucceeded: finalRunResult?.sendSucceeded,
            transport: finalRunResult?.transport,
          },
        });
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
      let output = lastMessage?.text ?? "";
      const outputWithL4LogNote = appendLocalConsoleWebviewFootnoteForL4Reply(output);
      if (outputWithL4LogNote !== output.trimEnd()) {
        redactAgentOutput(event, outputWithL4LogNote);
        output = outputWithL4LogNote;
      }
      if (selfSafetyGuardConfig.outputGuard !== false && output && !isDiscoveryResponse) {
        const { guardContext } = buildManagedGuardContext({ output, messages: event.messages }, ctx);
        const decision = guardOutput(output, ctx.sessionKey, guardContext);
        const { guardActionRequired, policyEvaluation, policyResolution, effectiveAssessment } = resolveGuardPolicyState(decision);
        log.info(`[lynx-guardian] Output risk detected: ${JSON.stringify(decision)}`);
        logGuardPolicyTrace(log, "agent_end_output", decision, policyResolution);
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
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:output] ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "output guard block",
            },
          );
          localConsoleHooks?.agentEnd({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            runId: normalizeString((ctx as any).runId) || undefined,
            summary: decision.warning ?? "Assistant output was changed during agent_end enforcement.",
            outputText: enforcement.content,
            contentExcerpt: enforcement.content,
            contentKind: "assistant_message",
            primaryModule: effectiveAssessment.modules[0],
            modules: effectiveAssessment.modules,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            enforcementAction: enforcement.changed ? "redact" : "block",
          });
          return;
            log.warn(`[lynx-guardian] Self-safety-guard blocked output: ${decision.riskAssessment.description}`);
          redactAgentOutput(event, "[Lynx Guardian] 输出已被安全防护替换：检测到受保护配置泄露风险");
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:output] ${decision.riskAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "output guard fallback block",
            },
          );
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard output warning: ${decision.warning}`);
        }
      }

      if (!isDiscoveryResponse) {
        const remoteOutputCheck = await checkContentWeighted(userId, output, 2);
        if (!isRemoteAvailable(remoteOutputCheck)) {
          log.warn(`[lynx-guardian] Output weighting unavailable: ${remoteOutputCheck.errorMessage}`);
        } else {
          const res = remoteOutputCheck.value;
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
      }
      localConsoleHooks?.agentEnd({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: normalizeString(ctx.sessionKey) || undefined,
        runId: normalizeString((ctx as any).runId) || undefined,
        summary: "Agent end completed and assistant output remained available for downstream handling.",
        outputText: output,
        contentExcerpt: output,
        contentKind: "assistant_message",
        enforcementAction: "allow",
      });
    } catch (err: any) {
      log.error(`[lynx-guardian] Output check failed: ${err.message}`);
    }
  });

  if (localConsoleTokenHook) {
    api.on("llm_output", async (event, ctx) => {
      appendLifecycleProbe("llm_output", event, ctx);
      if (decisionBroker) {
        handleLlmOutputDecision(decisionBroker, event, ctx);
      }
      localConsoleTokenHook.handle(event, ctx);
    });
  }

  api.on("before_message_write", (event, ctx) => {
    try {
      if (decisionBroker) {
        handleBeforeMessageWriteDecision(decisionBroker, event, ctx);
      }
      const localConsoleOccurredAtMs = Date.now();
      const originalMessage = event?.message;
      if (!originalMessage) return;

      let nextMessage = decorateAssistantMessage(originalMessage);
      if (nextMessage.role === "assistant") {
        const currentText = extractMessageText(nextMessage);
        const nextText = appendLocalConsoleWebviewFootnoteForL4Reply(currentText);
        if (nextText !== currentText.trimEnd()) {
          nextMessage = createReplacementMessage(nextMessage, nextText);
        }
      }
      if (nextMessage.role === "assistant" && isTrustedManagedLynxCheckReportText(nextMessage)) {
        const currentText = extractMessageText(nextMessage);
        const nextText = appendLocalConsoleWebviewFootnote(currentText);
        if (nextText !== currentText) {
          nextMessage = createReplacementMessage(nextMessage, nextText);
        }
      }
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
      if (nextMessage.role === "assistant" && isTrustedManagedLynxCheckReportText(nextMessage)) {
        const currentText = extractMessageText(nextMessage);
        const nextText = appendLocalConsoleWebviewFootnote(currentText);
        if (nextText !== currentText) {
          nextMessage = createReplacementMessage(nextMessage, nextText);
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
          localConsoleHooks?.beforeMessageWrite({
            occurredAtMs: localConsoleOccurredAtMs,
            sessionKey: normalizeString(ctx.sessionKey) || undefined,
            summary: persistenceDecision.warning ?? "Assistant message was blocked before persistence.",
            contentExcerpt: extractMessageText(persistenceDecision.message),
            contentKind: "assistant_message",
            messageRole: nextMessage.role,
            blocked: true,
            enforcementAction: "block",
            payloadJson: {
              messageChanged: nextMessage !== originalMessage,
            },
          });
          return {
            message: persistenceDecision.message,
          };
        }
      }
      if (nextMessage === originalMessage) {
        localConsoleHooks?.beforeMessageWrite({
          occurredAtMs: localConsoleOccurredAtMs,
          sessionKey: normalizeString(ctx.sessionKey) || undefined,
          summary: "Assistant message passed through before_message_write without mutation.",
          contentExcerpt: extractMessageText(nextMessage),
          contentKind: "assistant_message",
          messageRole: nextMessage.role,
          messageChanged: false,
          enforcementAction: "allow",
        });
        return;
      }

      log.info("[lynx-guardian] Assistant message decorated before persistence");
      localConsoleHooks?.beforeMessageWrite({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: normalizeString(ctx.sessionKey) || undefined,
        summary: "Assistant message was reshaped before persistence.",
        contentExcerpt: extractMessageText(nextMessage),
        contentKind: "assistant_message",
        messageRole: nextMessage.role,
        messageChanged: true,
        enforcementAction: "allow",
      });
      return {
        message: nextMessage,
      };
    } catch (err: any) {
      log.error(`[lynx-guardian] before_message_write handler failed: ${err.message}`);
    }
  });

  api.on("tool_result_persist", (event, ctx) => {
    appendLifecycleProbe("tool_result_persist", event, ctx);
    if (decisionBroker) {
      handleToolResultPersistDecision(decisionBroker, event, ctx);
    }
    const localConsoleOccurredAtMs = Date.now();
    if (selfSafetyGuardConfig.resultGuard === false) return;
    const { guardContext } = buildManagedGuardContext(event, ctx);
    const decision = guardToolResultPersistence(event.toolName, event.message, {
      ...guardContext,
      enforcementMode: outputEnforcementMode,
    });
    if (decision.warning) {
      log.warn(`[lynx-guardian] Tool result guard diagnostic: ${decision.warning}`);
    }
    if (!decision.block) {
      localConsoleHooks?.toolResultPersist({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: normalizeString(ctx.sessionKey) || undefined,
        toolCallId: normalizeString(event.toolCallId) || undefined,
        toolName: normalizeString(event.toolName) || undefined,
        summary: decision.warning ?? "Tool result passed persistence guard evaluation.",
        contentExcerpt: extractMessageText(event.message),
        contentKind: "tool_result",
        enforcementAction: decision.warning ? "warn" : "allow",
        blocked: false,
      });
      return;
    }
    localConsoleHooks?.toolResultPersist({
      occurredAtMs: localConsoleOccurredAtMs,
      sessionKey: normalizeString(ctx.sessionKey) || undefined,
      toolCallId: normalizeString(event.toolCallId) || undefined,
      toolName: normalizeString(event.toolName) || undefined,
      summary: decision.warning ?? "Tool result was blocked before persistence.",
      contentExcerpt: extractMessageText(decision.message),
      contentKind: "tool_result",
      enforcementAction: "block",
      blocked: true,
    });
    return {
      message: decision.message,
    };
  });

  api.on("message_sending", async (event, ctx) => {
    appendLifecycleProbe("message_sending", event, ctx);
    if (decisionBroker) {
      const decisionResult = await handleMessageSendingDecision(decisionBroker, event, ctx);
      if (decisionResult?.cancel) {
        return decisionResult;
      }
    }
    const localConsoleOccurredAtMs = Date.now();
    const localConsoleSessionKey = normalizeString(ctx.sessionKey) || undefined;
    const activeManagedLynxCheckRun = localConsoleSessionKey
      ? readLatestPendingLynxCheckRunIntent(localConsoleSessionKey)
      : null;
    const outboundTarget = buildOutboundDeliveryTarget(event, ctx);
    const managedLynxCheckSnapshot = (
      typeof event.content === "string"
      && isTrustedManagedLynxCheckReportText(event.content)
      && activeManagedLynxCheckRun
    )
      ? {
        requestId: activeManagedLynxCheckRun.requestId,
        source: activeManagedLynxCheckRun.source,
        trigger: activeManagedLynxCheckRun.trigger,
        preferredTargetKind: activeManagedLynxCheckRun.preferredTargetKind,
        sessionKey: activeManagedLynxCheckRun.sessionKey,
        targetKey: activeManagedLynxCheckRun.routeHint?.targetKey
          ?? ([
            normalizeString(outboundTarget.messageProvider ?? outboundTarget.channelId),
            normalizeString(outboundTarget.channelId ?? outboundTarget.messageProvider),
            normalizeString(outboundTarget.to ?? outboundTarget.sessionKey),
          ].filter(Boolean).join(":") || undefined),
        channelId: normalizeString(outboundTarget.channelId) || activeManagedLynxCheckRun.routeHint?.channelId,
        messageProvider: normalizeString(outboundTarget.messageProvider) || activeManagedLynxCheckRun.routeHint?.messageProvider,
        status: "running",
        sendAttempted: true,
        transport: "message_sending",
        createdAtMs: activeManagedLynxCheckRun.createdAtMs,
      }
      : undefined;
    let shapedContent: string | undefined;
    if (typeof event.content === "string") {
      const nextContent = appendLocalConsoleWebviewFootnoteForL4Reply(event.content);
      if (nextContent !== event.content.trimEnd()) {
        event.content = nextContent;
        shapedContent = nextContent;
      }
    }
    if (typeof event.content === "string" && isTrustedManagedLynxCheckReportText(event.content)) {
      const nextContent = appendLocalConsoleWebviewFootnote(event.content);
      if (nextContent !== event.content) {
        event.content = nextContent;
        shapedContent = nextContent;
      }
    }
    if (typeof event.content === "string" && resolveOutboundPromptChannel(event, ctx) === "feishu") {
      const nextContent = shapeTextForProvider(event.content, "feishu");
      if (nextContent !== event.content) {
        event.content = nextContent;
        shapedContent = nextContent;
        log.info("[lynx-guardian] Outbound Feishu message shaped at message_sending");
      }
    }
    if (typeof event.content === "string" && isTrustedManagedLynxCheckReportText(event.content)) {
      const nextContent = appendLocalConsoleWebviewFootnote(event.content);
      if (nextContent !== event.content) {
        event.content = nextContent;
        shapedContent = nextContent;
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
      localConsoleHooks?.messageSending({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: localConsoleSessionKey,
        summary: "Scheduled /lynx-check outbound message was cancelled because no concrete recipient was available.",
        contentExcerpt: typeof event.content === "string" ? event.content : undefined,
        contentKind: "outbound_message",
        direction: "output",
        enforcementAction: "block",
        canceled: true,
        targetKey: managedLynxCheckSnapshot?.targetKey,
        lynxCheck: managedLynxCheckSnapshot
          ? {
            ...managedLynxCheckSnapshot,
            status: "failed",
            sendSucceeded: false,
            transport: "cancelled-no-target",
            errorMessage: "No concrete outbound recipient available",
          }
          : undefined,
      });
      return { cancel: true };
    }

    if (selfSafetyGuardConfig.outputGuard === false) {
      localConsoleHooks?.messageSending({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: localConsoleSessionKey,
        summary: "Outbound message sending bypassed output guard because it is disabled.",
        contentExcerpt: shapedContent ?? (typeof event.content === "string" ? event.content : undefined),
        contentKind: "outbound_message",
        direction: "output",
        enforcementAction: "allow",
        canceled: false,
        targetKey: managedLynxCheckSnapshot?.targetKey,
        lynxCheck: managedLynxCheckSnapshot as any,
      });
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
      localConsoleHooks?.messageSending({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: localConsoleSessionKey,
        summary: enforcement.warning ?? "Outbound message content was changed by output enforcement.",
        contentExcerpt: enforcement.content,
        contentKind: "outbound_message",
        direction: "output",
        enforcementAction: "redact",
        canceled: false,
        targetKey: managedLynxCheckSnapshot?.targetKey,
        lynxCheck: managedLynxCheckSnapshot as any,
      });
      return { content: enforcement.content };
    }
    localConsoleHooks?.messageSending({
      occurredAtMs: localConsoleOccurredAtMs,
      sessionKey: localConsoleSessionKey,
      summary: enforcement.warning ?? "Outbound message passed message_sending evaluation.",
      contentExcerpt: shapedContent ?? (typeof event.content === "string" ? event.content : undefined),
      contentKind: "outbound_message",
      direction: "output",
      enforcementAction: enforcement.warning ? "warn" : "allow",
      canceled: false,
      targetKey: managedLynxCheckSnapshot?.targetKey,
      lynxCheck: managedLynxCheckSnapshot as any,
    });
    return shapedContent ? { content: shapedContent } : undefined;
  });

  (api.on as any)("before_install", async (event: any, ctx: any) => {
    if (!decisionBroker) {
      return;
    }
    const decisionResult = await handleBeforeInstallEventDecision(decisionBroker, event, ctx);
    if (decisionResult?.block || decisionResult?.requireApproval) {
      return decisionResult;
    }
  });

  api.on("before_tool_call", async (event, ctx) => {
    const { toolName, params } = event;
    log.info(`[lynx-guardian] before_tool_call tool=${JSON.stringify(toolName)} params=${JSON.stringify(params)}`);
    if (decisionBroker) {
      const decisionResult = await handleBeforeToolCallDecision(decisionBroker, event, ctx);
      if (decisionResult?.block || decisionResult?.requireApproval) {
        return decisionResult;
      }
    }
    const localConsoleOccurredAtMs = Date.now();
    const localConsoleSessionKey = normalizeString(ctx.sessionKey) || undefined;
    const localConsoleRunId = normalizeString((ctx as any).runId) || undefined;
    const localConsoleToolCallId = normalizeString((event as any)?.toolCallId) || undefined;
    const localConsoleParamSummary = buildParamSummary(toolName, params ?? {});
    const recordBeforeToolCall = (overrides: Record<string, unknown> = {}) => {
      localConsoleHooks?.beforeToolCall({
        occurredAtMs: localConsoleOccurredAtMs,
        sessionKey: localConsoleSessionKey,
        runId: localConsoleRunId,
        toolCallId: localConsoleToolCallId,
        toolName,
        params,
        paramSummary: localConsoleParamSummary,
        ...overrides,
      } as any);
    };
    const buildLocalConsoleApproval = (approvalParams: {
      approvalId: string;
      module: string;
      riskLevel: "L2" | "L3";
      transport?: string;
      resolution?: string;
      resolvedAtMs?: number;
      metadataJson?: Record<string, unknown>;
    }) => ({
      approvalId: approvalParams.approvalId,
      pendingId: approvalParams.approvalId,
      sessionKey: localConsoleSessionKey,
      runId: localConsoleRunId,
      transport: approvalParams.transport,
      channelProfile: approvalRoute.channelProfile,
      channelId: approvalRoute.channelId,
      accountId: approvalRoute.accountId,
      conversationId: approvalRoute.conversationId,
      requesterOuId: approvalRoute.requesterOuId,
      approverOuIds: localApprovalApproverOuIds,
      module: approvalParams.module,
      riskLevel: approvalParams.riskLevel,
      toolName,
      scopeType: "singleTool" as const,
      requestedAtMs: localConsoleOccurredAtMs,
      expiresAtMs: localConsoleOccurredAtMs + riskPolicyConfig.toolApprovalTimeoutMs,
      resolvedAtMs: approvalParams.resolvedAtMs,
      resolution: approvalParams.resolution,
      promptExcerpt: runApprovalContext?.promptText,
      metadataJson: approvalParams.metadataJson,
    });
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
        const { guardActionRequired, policyEvaluation, policyResolution, effectiveAssessment, blockReason } = resolveGuardPolicyState(decision);
        log.info(`[lynx-guardian] before_tool_call decision=${JSON.stringify(decision)}`);
        logGuardPolicyTrace(log, "before_tool_call", decision, policyResolution);
        execBlacklistContext = decision.contextHints;
        log.info(`[lynx-guardian] before_tool_call execBlacklistContext=${JSON.stringify(execBlacklistContext)}`);
        log.info(`[lynx-guardian] Tool call risk detected: ${JSON.stringify(decision)}`);

        if (guardActionRequired && managedLynxCheckPreauthorized) {
          log.info(`[lynx-guardian] Managed /lynx-check blocked extra tool call outside whitelist: ${toolName}`);
          recordBeforeToolCall({
            summary: "[Lynx Guardian] Managed /lynx-check 已完成预计算，仅允许白名单内的内部读写与报告发送链路。",
            triggeredModules: effectiveAssessment.modules,
            primaryModule: effectiveAssessment.modules[0],
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: "deny",
            enforcementAction: "block",
          });
          return {
            block: true,
            blockReason: "[Lynx Guardian] Managed /lynx-check 已完成预计算，仅允许白名单内的内部读写与报告发送链路。",
          };
        }

        if (guardActionRequired) {
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${effectiveAssessment.description}`);
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:tool] ${toolName} ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "managed tool guard block",
            },
          );

          const approvalRiskLevel = toApprovalRiskLevel(effectiveAssessment.level);
          const primaryModule = effectiveAssessment.modules[0];
          const l4BlockReason = appendLogWebviewNoteForL4(blockReason, effectiveAssessment.level);
          if (!policyResult.override.allowed || !approvalRiskLevel || !primaryModule) {
            recordBeforeToolCall({
              summary: blockReason,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: "block",
            });
            return {
              block: true,
              blockReason: l4BlockReason,
            };
          }

          if (approvalRoute.compatMode === "deny-no-route") {
            const approvalId = `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`;
            const approvalUnavailableReason = appendLogWebviewNoteForL3Approval(
              approvalRoute.blockReason ?? "Approval unavailable",
              approvalRiskLevel,
            );
            recordBeforeToolCall({
              summary: approvalRoute.blockReason ?? "Approval unavailable",
              approvalId,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
                metadataJson: {
                  compatMode: approvalRoute.compatMode,
                  runtimeTier: approvalRoute.runtimeTier,
                },
              }),
            });
            return {
              block: true,
              blockReason: approvalUnavailableReason,
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
            recordBeforeToolCall({
              summary: feishuLocalApproval.blockReason ?? "Feishu local approval flow handled this tool call.",
              approvalId: `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: feishuLocalApproval.blockReason ? "block" : "requireApproval",
              approval: buildLocalConsoleApproval({
                approvalId: `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: "local-chat",
                metadataJson: {
                  localFlow: true,
                },
              }),
            });
            if (feishuLocalApproval.blockReason) {
              return {
                block: true,
                blockReason: appendLogWebviewNoteForL3Approval(feishuLocalApproval.blockReason, approvalRiskLevel),
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
            recordBeforeToolCall({
              summary: "Existing approval grant matched this tool call.",
              approvalId: `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: "allow",
            });
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
              recordBeforeToolCall({
                summary: "Pending approval was reused and resolved to allow the tool call.",
                approvalId,
                triggeredModules: effectiveAssessment.modules,
                primaryModule,
                riskLevel: effectiveAssessment.level,
                riskScore: effectiveAssessment.score,
                policyDecision: policyResult.override.allowed ? "confirm" : "deny",
                enforcementAction: "allow",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return;
            }
            if (resolution === "deny") {
              recordBeforeToolCall({
                summary: "Pending approval was explicitly denied.",
                approvalId,
                triggeredModules: effectiveAssessment.modules,
                primaryModule,
                riskLevel: effectiveAssessment.level,
                riskScore: effectiveAssessment.score,
                policyDecision: policyResult.override.allowed ? "confirm" : "deny",
                enforcementAction: "block",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return {
                block: true,
                blockReason: appendLogWebviewNoteForL3Approval("Denied by user", approvalRiskLevel),
              };
            }
            if (resolution === "cancelled") {
              recordBeforeToolCall({
                summary: "Pending approval was cancelled.",
                approvalId,
                triggeredModules: effectiveAssessment.modules,
                primaryModule,
                riskLevel: effectiveAssessment.level,
                riskScore: effectiveAssessment.score,
                policyDecision: policyResult.override.allowed ? "confirm" : "deny",
                enforcementAction: "block",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return {
                block: true,
                blockReason: appendLogWebviewNoteForL3Approval("Approval cancelled", approvalRiskLevel),
              };
            }
            recordBeforeToolCall({
              summary: "Pending approval timed out.",
              approvalId,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
                resolution: "timeout",
                resolvedAtMs: Date.now(),
              }),
            });
            return {
              block: true,
              blockReason: appendLogWebviewNoteForL3Approval("Approval timed out", approvalRiskLevel),
            };
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
            recordBeforeToolCall({
              summary: approvalBlockReason ?? "Approval unavailable",
              approvalId,
              triggeredModules: effectiveAssessment.modules,
              primaryModule,
              riskLevel: effectiveAssessment.level,
              riskScore: effectiveAssessment.score,
              policyDecision: policyResult.override.allowed ? "confirm" : "deny",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
              }),
            });
            return {
              block: true,
              blockReason: appendLogWebviewNoteForL3Approval(
                approvalBlockReason ?? "Approval unavailable",
                approvalRiskLevel,
              ),
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
          recordBeforeToolCall({
            summary: blockReason,
            approvalId,
            triggeredModules: effectiveAssessment.modules,
            primaryModule,
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResult.override.allowed ? "confirm" : "deny",
            enforcementAction: "requireApproval",
            approval: buildLocalConsoleApproval({
              approvalId,
              module: primaryModule,
              riskLevel: approvalRiskLevel,
              transport: transport === "native" ? "native" : approvalRoute.approvalTransport,
            }),
          });
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
          const policyResult = resolveRiskPolicy(effectiveAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${effectiveAssessment.description}`);
          await pushRecordBestEffort(
            {
              id: userId,
              content: buildPolicyRecordContent(
                policyEvaluation,
                `[SSG:tool] ${toolName} ${effectiveAssessment.modules.join(",")}`,
              ),
              riskLevel: policyEvaluation.legacyRiskLevel,
            },
            {
              log,
              context: "tool guard block",
            },
          );
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
          recordBeforeToolCall({
            summary: blockReason,
            triggeredModules: effectiveAssessment.modules,
            primaryModule: effectiveAssessment.modules[0],
            riskLevel: effectiveAssessment.level,
            riskScore: effectiveAssessment.score,
            policyDecision: policyResult.override.allowed ? "confirm" : "deny",
            enforcementAction: "block",
          });
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
      recordBeforeToolCall({
        summary: "Managed /lynx-check trusted tool call passed through.",
        enforcementAction: "allow",
      });
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
            await pushRecordBestEffort(
              {
                id: userId,
                content: `[SkillGuard] blocked: ${installAttempt.skillName} (${quick.reason})`,
                riskLevel: 3,
              },
              {
                log,
                context: "skill guard blocked",
              },
            );
            return {
              block: true,
              blockReason: `[Lynx Guardian] 恶意 Skill 拦截: "${installAttempt.skillName}" ${quick.reason}`,
            };
          }

          const fetchRemote = async (): Promise<MaliciousSkillEntry[] | null> => {
            const remoteBlacklist = await fetchMaliciousSkillBlacklistWeighted();
            if (!isRemoteAvailable(remoteBlacklist)) {
              log.warn(`[lynx-guardian] Remote skill blacklist unavailable: ${remoteBlacklist.errorMessage}`);
              return null;
            }
            const res = remoteBlacklist.value;
            if (res.code === 0 && res.result?.entries) {
              return res.result.entries.map((e) => ({
                ...e,
                namePattern: e.namePattern ? new RegExp(e.namePattern) : undefined,
              }));
            }
            return null;
          };

          const assessment = await assessSkillRisk(installAttempt, fetchRemote);
          log.info(`[lynx-guardian] Skill assess risk detected: ${JSON.stringify(assessment)}`);
          if (assessment.block) {
            log.warn(`[lynx-guardian] ${assessment.message}`);
            await pushRecordBestEffort(
              {
                id: userId,
                content: `[SkillGuard] ${assessment.level}: ${installAttempt.skillName}`,
                riskLevel: 3,
              },
              {
                log,
                context: "skill guard assessment block",
              },
            );

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
            await pushRecordBestEffort(
              {
                id: userId,
                content: `[SkillGuard] warning: ${installAttempt.skillName}`,
                riskLevel: 1,
              },
              {
                log,
                context: "skill guard warning",
              },
            );
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
    if (!match) {
      recordBeforeToolCall({
        summary: "Tool call passed before_tool_call evaluation without blacklist hits.",
        enforcementAction: "allow",
      });
      return;
    }

    log.warn(`[lynx-guardian] Blacklist hit: ${toolName} | ${match.reason}`);

    const detail = toolName === "exec" ? (params?.command ?? "") : (params?.file_path ?? params?.path ?? "");
    const blacklistModules = inferBlacklistModules(toolName, match.reason);
    const contentToReport = toolName === "exec" ? `执行 ${detail} 命令` : `${toolName} ${detail}`;

    const riskLevel = match.level === "critical" ? 3 : 2;
    await pushRecordBestEffort(
      {
        id: userId,
        content: contentToReport,
        riskLevel,
      },
      {
        log,
        context: "blacklist record",
      },
    );

    try {
      const userContext = readRecentContext(ctx.sessionKey);
      log.info(`[lynx-guardian] User context: ${userContext}`);
      const content = `是否${match.reason} ${detail}？用户：${userContext}`;

      const toolCheck = await checkToolWeighted(userId, content);
      const adaptedToolCheck = isRemoteAvailable(toolCheck)
        ? adaptToolCheckResult(toolCheck.value.result)
        : {
            externalRiskLevel: 0,
            content: "",
          };
      if (!isRemoteAvailable(toolCheck)) {
        log.warn(`[lynx-guardian] Tool weighting unavailable: ${toolCheck.errorMessage}`);
      } else {
        log.info(`[lynx-guardian] Tool check result: ${JSON.stringify(toolCheck.value)}`);
      }
      // Blacklist hits always require confirmation via the plugin's pending-override
      // mechanism, even when tool_check returns safe (risk_level=0).
      // "tool_check safe" means the user asked for the operation - that is necessary
      // but not sufficient. The plugin's confirmation phrase is the actual gate.
      // Floor to the blacklist's own severity so we never silently allow a blacklist hit.
      const rawRiskLevel = adaptedToolCheck.externalRiskLevel;
      const blacklistFloor = match.level === "critical" ? 3 : 2;
      const riskLevel = getWeightedRiskLevel({
        localFloor: blacklistFloor,
        remoteRiskLevel: rawRiskLevel,
      });

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
            const approvalId = `lynx:blacklist:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`;
            recordBeforeToolCall({
              summary: approvalRoute.blockReason ?? "Approval unavailable",
              approvalId,
              triggeredModules: blacklistModules,
              primaryModule,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "confirm",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
                metadataJson: {
                  compatMode: approvalRoute.compatMode,
                  blacklistReason: match.reason,
                },
              }),
            });
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
            recordBeforeToolCall({
              summary: feishuLocalApproval.blockReason ?? "Blacklist hit entered Feishu local approval flow.",
              approvalId,
              triggeredModules: blacklistModules,
              primaryModule,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "confirm",
              enforcementAction: feishuLocalApproval.blockReason ? "block" : "requireApproval",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: "local-chat",
                metadataJson: {
                  blacklistReason: match.reason,
                  localFlow: true,
                },
              }),
            });
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
            recordBeforeToolCall({
              summary: "Existing approval grant matched blacklist-protected tool call.",
              approvalId,
              triggeredModules: blacklistModules,
              primaryModule,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "confirm",
              enforcementAction: "allow",
            });
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
              recordBeforeToolCall({
                summary: "Blacklist approval reused an existing allow resolution.",
                approvalId,
                triggeredModules: blacklistModules,
                primaryModule,
                riskLevel: apiAssessment.level,
                riskScore: apiAssessment.score,
                policyDecision: "confirm",
                enforcementAction: "allow",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return;
            }
            if (resolution === "deny") {
              recordBeforeToolCall({
                summary: "Blacklist approval was denied.",
                approvalId,
                triggeredModules: blacklistModules,
                primaryModule,
                riskLevel: apiAssessment.level,
                riskScore: apiAssessment.score,
                policyDecision: "confirm",
                enforcementAction: "block",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return { block: true, blockReason: "Denied by user" };
            }
            if (resolution === "cancelled") {
              recordBeforeToolCall({
                summary: "Blacklist approval was cancelled.",
                approvalId,
                triggeredModules: blacklistModules,
                primaryModule,
                riskLevel: apiAssessment.level,
                riskScore: apiAssessment.score,
                policyDecision: "confirm",
                enforcementAction: "block",
                approval: buildLocalConsoleApproval({
                  approvalId,
                  module: primaryModule,
                  riskLevel: approvalRiskLevel,
                  transport: approvalRoute.approvalTransport,
                  resolution,
                  resolvedAtMs: Date.now(),
                }),
              });
              return { block: true, blockReason: "Approval cancelled" };
            }
            recordBeforeToolCall({
              summary: "Blacklist approval timed out.",
              approvalId,
              triggeredModules: blacklistModules,
              primaryModule,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "confirm",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
                resolution: "timeout",
                resolvedAtMs: Date.now(),
              }),
            });
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
            recordBeforeToolCall({
              summary: blockReason ?? "Approval unavailable",
              approvalId,
              triggeredModules: blacklistModules,
              primaryModule,
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "confirm",
              enforcementAction: "block",
              approval: buildLocalConsoleApproval({
                approvalId,
                module: primaryModule,
                riskLevel: approvalRiskLevel,
                transport: approvalRoute.approvalTransport,
              }),
            });
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
          recordBeforeToolCall({
            summary: `[Lynx Guardian] Risk Level ${riskLevel}: ${match.reason}`,
            approvalId,
            triggeredModules: blacklistModules,
            primaryModule,
            riskLevel: apiAssessment.level,
            riskScore: apiAssessment.score,
            policyDecision: "confirm",
            enforcementAction: "requireApproval",
            approval: buildLocalConsoleApproval({
              approvalId,
              module: primaryModule,
              riskLevel: approvalRiskLevel,
              transport: transport === "native" ? "native" : approvalRoute.approvalTransport,
            }),
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
          ...(() => {
            recordBeforeToolCall({
              summary: `[Lynx Guardian] ${riskLevel >= 3 ? "High-risk tool call blocked" : "Tool call blocked"} (Risk Level ${riskLevel}): ${match.reason}`,
              triggeredModules: blacklistModules,
              primaryModule: blacklistModules[0],
              riskLevel: apiAssessment.level,
              riskScore: apiAssessment.score,
              policyDecision: "deny",
              enforcementAction: "block",
            });
            return {};
          })(),
          block: true,
          blockReason: appendLogWebviewNoteForL4(
            `[Lynx Guardian] ${riskLevel >= 3 ? "High-risk tool call blocked" : "Tool call blocked"} (Risk Level ${riskLevel}): ${match.reason}`,
            apiAssessment.level,
          ),
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
            sourceKeys: resolveOverrideKeys(ctx),
          });
          recordBeforeToolCall({
            summary: `[Lynx Guardian] ${riskLevel >= 3 ? "High-risk tool call blocked" : "Confirmation required"} (Risk Level ${riskLevel}): ${match.reason}`,
            triggeredModules: blacklistModules,
            primaryModule: blacklistModules[0],
            riskLevel: apiAssessment.level,
            riskScore: apiAssessment.score,
            policyDecision: "confirm",
            enforcementAction: "block",
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
        recordBeforeToolCall({
          summary: `[Lynx Guardian] 高危操作被拦截 (Risk Level ${riskLevel}): ${match.reason}`,
          triggeredModules: blacklistModules,
          primaryModule: blacklistModules[0],
          riskLevel: match.level === "critical" ? "L4" : "L2",
          riskScore: match.level === "critical" ? 9 : 6,
          policyDecision: "deny",
          enforcementAction: "block",
        });
        return {
          block: true,
          blockReason: appendLogWebviewNoteForL4(
            `[Lynx Guardian] 高危操作被拦截 (Risk Level ${riskLevel}): ${match.reason}`,
            match.level === "critical" ? "L4" : "L2",
          ),
        };
      } else if (riskLevel === 2 && !approvedToolOverride) {
        recordBeforeToolCall({
          summary: `[Lynx Guardian] Confirmation required: ${match.reason}. Reply with "同意" and retry.`,
          triggeredModules: blacklistModules,
          primaryModule: blacklistModules[0],
          riskLevel: "L2",
          riskScore: 6,
          policyDecision: "confirm",
          enforcementAction: "block",
        });
        return {
          block: true,
          blockReason: `[Lynx Guardian] Confirmation required: ${match.reason}. Reply with "同意" and retry.`,
        };
      } else if (riskLevel >= 2) {
        log.info(`[lynx-guardian] One-time override consumed for tool risk: ${toolName}`);
        recordBeforeToolCall({
          summary: "One-time override consumed for risky tool call.",
          triggeredModules: blacklistModules,
          primaryModule: blacklistModules[0],
          riskLevel: match.level === "critical" ? "L4" : "L2",
          riskScore: match.level === "critical" ? 9 : 6,
          policyDecision: "allow",
          enforcementAction: "allow",
        });
        return;
      } else if (riskLevel === 1) {
        log.info(`[lynx-guardian] 识别到内容风险：${adaptedToolCheck.content}`);
        recordBeforeToolCall({
          summary: `识别到内容风险：${adaptedToolCheck.content}`,
          triggeredModules: blacklistModules,
          primaryModule: blacklistModules[0],
          riskLevel: "L1",
          riskScore: 3,
          policyDecision: "warn",
          enforcementAction: "warn",
        });
        return;
      } else {
        recordBeforeToolCall({
          summary: "Blacklist-matched tool call was ultimately allowed.",
          triggeredModules: blacklistModules,
          primaryModule: blacklistModules[0],
          riskLevel: "L0",
          riskScore: 0,
          policyDecision: "allow",
          enforcementAction: "allow",
        });
        return;
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] Tool risk handling failed: ${err.message}`);
      if (match.level === "critical") {
        recordBeforeToolCall({
          summary: `[Lynx Guardian] 安全检测失败（高危操作）: ${err.message}`,
          triggeredModules: inferBlacklistModules(toolName, match.reason),
          primaryModule: inferBlacklistModules(toolName, match.reason)[0],
          riskLevel: "L4",
          riskScore: 9,
          policyDecision: "deny",
          enforcementAction: "block",
        });
        return {
          block: true,
          blockReason: appendLogWebviewNoteForL4(
            `[Lynx Guardian] 安全检测失败（高危操作）: ${err.message}`,
            "L4",
          ),
        };
      }
      log.warn(`[lynx-guardian] API unreachable, allowing warning-level operation: ${match.reason}`);
      recordBeforeToolCall({
        summary: `API unreachable, allowing warning-level operation: ${match.reason}`,
        triggeredModules: inferBlacklistModules(toolName, match.reason),
        primaryModule: inferBlacklistModules(toolName, match.reason)[0],
        riskLevel: "L1",
        riskScore: 1,
        policyDecision: "allow",
        enforcementAction: "warn",
      });
      return;
    }
  });

  api.on("after_tool_call", async (event, ctx) => {
    appendLifecycleProbe("after_tool_call", event, ctx);
    localConsoleHooks?.afterToolCall({
      occurredAtMs: Date.now(),
      sessionKey: normalizeString(ctx.sessionKey) || undefined,
      runId: normalizeString((ctx as any).runId) || undefined,
      toolCallId: normalizeString((event as any)?.toolCallId) || undefined,
      toolName: normalizeString((event as any)?.toolName) || "unknown",
      params: (event as any)?.params,
      paramSummary: buildParamSummary(
        normalizeString((event as any)?.toolName) || "unknown",
        ((event as any)?.params ?? {}) as Record<string, unknown>,
      ),
      resultStatus: normalizeString((event as any)?.status) || (normalizeString((event as any)?.errorText) ? "error" : "completed"),
      resultExcerpt: extractMessageText((event as any)?.message) || normalizeString((event as any)?.result) || undefined,
      errorText: normalizeString((event as any)?.errorText)
        || normalizeString((event as any)?.error?.message)
        || undefined,
      durationMs: typeof (event as any)?.durationMs === "number" && Number.isFinite((event as any)?.durationMs)
        ? Math.trunc((event as any).durationMs)
        : undefined,
      finishedAtMs: typeof (event as any)?.finishedAtMs === "number" && Number.isFinite((event as any)?.finishedAtMs)
        ? Math.trunc((event as any).finishedAtMs)
        : Date.now(),
      summary: "Tool call completed and after_tool_call hook observed the result.",
      payloadJson: {
        hookPayloadKeys: Object.keys((event as any) ?? {}),
      },
    });
  });

  api.on("session_start", async (event, ctx) => {
    appendLifecycleProbe("session_start", event, ctx);
    rememberRecentActiveDeliveryTarget(ctx, { allowRouteOnly: true });
    localConsoleHooks?.sessionStart({
      occurredAtMs: Date.now(),
      sessionKey: normalizeString(ctx.sessionKey) || undefined,
      channelProfile: resolveChannelProfile(ctx.messageProvider ?? ctx.channelId ?? ctx.channel),
      channelId: normalizeString(ctx.channelId ?? ctx.channel) || undefined,
      requesterId: normalizeString((ctx as any).senderId ?? ctx.userId) || undefined,
      requesterOuId: normalizeString((ctx as any).senderOpenId) || undefined,
      accountId: normalizeString((ctx as any).accountId) || undefined,
      conversationId: normalizeString((ctx as any).conversationId) || undefined,
      threadId: (ctx as any).threadId,
      isGroup: (ctx as any).isGroup === true,
      metadataJson: {
        hook: "session_start",
      },
      summary: "Session start hook observed.",
    });
  });

  api.on("session_end", async (event, ctx) => {
    appendLifecycleProbe("session_end", event, ctx);
    clearRecentActiveDeliveryTargetForContext(ctx);
    localConsoleHooks?.sessionEnd({
      occurredAtMs: Date.now(),
      sessionKey: normalizeString(ctx.sessionKey) || undefined,
      channelProfile: resolveChannelProfile(ctx.messageProvider ?? ctx.channelId ?? ctx.channel),
      channelId: normalizeString(ctx.channelId ?? ctx.channel) || undefined,
      requesterId: normalizeString((ctx as any).senderId ?? ctx.userId) || undefined,
      requesterOuId: normalizeString((ctx as any).senderOpenId) || undefined,
      accountId: normalizeString((ctx as any).accountId) || undefined,
      conversationId: normalizeString((ctx as any).conversationId) || undefined,
      threadId: (ctx as any).threadId,
      isGroup: (ctx as any).isGroup === true,
      metadataJson: {
        hook: "session_end",
      },
      summary: "Session end hook observed.",
    });
  });
}
