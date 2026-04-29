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
import { SensitiveDataBlocker } from "./src/local-guard/sensitive-patterns.js";
import { guardInput, guardOutput, guardToolCall } from "./src/guard/safety-guard.js";
import type { GuardDecision } from "./src/guard/safety-guard.js";
import {
  enforceGuardDecisionText,
  guardAssistantPersistence,
  guardOutputText,
  guardToolResultPersistence,
} from "./src/local-guard/output-protection.js";
import { buildSecurityAwarenessInjection } from "./src/runtime/visible-input-warning.js";
import { runSecurityAudit, runMaliciousScriptScan, formatAuditSummary } from "./src/lynx-check/report-producers.js";
import {
  getPendingOverride,
} from "./src/runtime/pending-override-store.js";
import {
  grantManagedLynxCheckAuthorization,
  hasManagedLynxCheckAuthorization,
} from "./src/lynx-check/lynx-check-bridge.js";
import {
  claimRequesterProvenance,
  readRequesterProvenance,
  rememberRequesterProvenance,
  readRunApprovalContext,
  saveRunApprovalContext,
} from "./src/approval/approval-bridge.js";
import {
  consumeFeishuLocalApprovalGrant,
  consumeFeishuLocalApprovalReplay,
  discardLocalToolApproval,
  getOrCreatePendingToolApproval,
  listLocalToolApprovalsForSession,
  matchApprovalGrant,
  matchFeishuRunContinuation,
  persistGrantFromApproval,
  readLocalToolApprovalByToken,
  registerLocalToolApproval,
  resolvePluginApprovalCompat,
  saveFeishuLocalApprovalGrant,
  saveFeishuLocalApprovalReplay,
  saveFeishuRunContinuation,
  buildToolApprovalRequest,
  toApprovalRiskLevel,
} from "./src/approval/approval-bridge.js";
import { buildApprovalRequestFingerprint } from "./src/approval/approval-bridge.js";
import { deliverLynxFeishuApprovalPromptDirectly } from "./src/delivery/message-delivery.js";
import {
  assessSkillRisk,
  configureSkillInventoryControlPlane,
  detectSkillInstall,
  quickBlacklistCheck,
  verifyAllInstalledSkills,
} from "./src/skills/skill-guard.js";
import { quarantineSkill } from "./src/skills/skill-guard.js";
import type { MaliciousSkillEntry } from "./src/skills/skill-guard.js";
import {
  DISCOVERY_CONFIG_SOURCE_PATH,
  loadDiscoveryRuntimeConfig,
} from "./src/discovery/discovery-runtime-config.js";
import {
  recommendContext, routeModel, checkBudget, planHeartbeat,
  formatContextRecommendation, formatModelRouting, formatBudgetStatus,
  buildOptimizationHints, isTokenOptimizerAvailable,
} from "./src/runtime/token-optimizer-runner.js";
import { reconcileScheduledLynxCheck, resolveScheduledLynxCheckConfig } from "./src/lynx-check/scheduled-lynx-check.js";
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
  resolveRiskPolicy,
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
} from "./src/delivery/message-delivery.js";
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
} from "./src/delivery/recent-delivery.js";
import { getHookCapabilityReport, getOpenClawRuntimeVersion } from "./src/runtime/hook-capabilities.js";
import type { RecentActiveDeliverySnapshot, RecentActiveDeliveryTarget } from "./src/delivery/recent-delivery.js";
import { deliverLynxReport, shapeMessageForProvider, shapeTextForProvider } from "./src/delivery/message-delivery.js";
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
} from "./src/lynx-check/lynx-check-bridge.js";
import {
  buildLynxCheckFallbackFailureNotice,
  buildManualLynxCheckPrompt,
  buildScheduledLynxCheckPrompt,
} from "./src/runtime/lynx-check-prompt.js";
import { deliverManagedLynxAuditReport } from "./src/runtime/lynx-audit-runtime.js";
import {
  createLocalConsoleTokenProvider,
  ensureLocalConsoleToken,
} from "./src/console/runtime.js";
import { createLocalConsoleIngestClient } from "./src/console/ingest-client.js";
import { resolveLocalConsoleRuntimeConfig } from "./src/console/runtime.js";
import { DecisionBroker } from "./src/runtime/decision-broker.js";
import { GoControlPlaneClient } from "./src/api/go-control-plane.js";
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
import { createLocalConsoleGatewayRouteRegistrations } from "./src/console/runtime.js";
import { createLocalConsoleHookHandlers } from "./src/console/runtime.js";
import { buildLocalConsoleLynxCheckSnapshot } from "./src/console/runtime.js";
import { createLocalConsoleSupervisor } from "./src/console/runtime.js";
import { createLocalConsoleTokenHook } from "./src/console/token-usage.js";
import {
  appendLocalConsoleWebviewFootnote,
  appendLocalConsoleWebviewFootnoteForL4Reply,
  isTrustedManagedLynxCheckReportText,
} from "./src/delivery/message-delivery.js";
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

import {
  adaptContentCheckResult,
  adaptToolCheckResult,
  guardInboundMessageBeforeWrite,
  guardPromptBuildInput,
  registerLynxHooks,
} from "./src/hooks/setup.js";
import { registerInputHooks } from "./src/hooks/input-hooks.js";
import { registerToolHooks } from "./src/hooks/tool-hooks.js";
import { registerOutputHooks } from "./src/hooks/output-hooks.js";
import { registerLifecycleHooks } from "./src/hooks/lifecycle-hooks.js";

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
    ? new DecisionBroker(new GoControlPlaneClient({
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

  const hookRuntime = {
    join,
    writeFileSync,
    readFileSync,
    unlinkSync,
    existsSync,
    ensureUserRegistered,
    readRecentContext,
    ensureResources,
    baseIpInfo,
    extractContentAfterDate,
    checkExecBlacklist,
    checkPathBlacklist,
    SensitiveDataBlocker,
    guardInput,
    guardOutput,
    guardToolCall,
    enforceGuardDecisionText,
    guardAssistantPersistence,
    guardOutputText,
    guardToolResultPersistence,
    buildSecurityAwarenessInjection,
    resolveRiskPolicy,
    runSecurityAudit,
    runMaliciousScriptScan,
    formatAuditSummary,
    getPendingOverride,
    grantManagedLynxCheckAuthorization,
    hasManagedLynxCheckAuthorization,
    claimRequesterProvenance,
    readRequesterProvenance,
    rememberRequesterProvenance,
    readRunApprovalContext,
    saveRunApprovalContext,
    consumeFeishuLocalApprovalGrant,
    consumeFeishuLocalApprovalReplay,
    discardLocalToolApproval,
    getOrCreatePendingToolApproval,
    listLocalToolApprovalsForSession,
    matchApprovalGrant,
    matchFeishuRunContinuation,
    persistGrantFromApproval,
    readLocalToolApprovalByToken,
    registerLocalToolApproval,
    resolvePluginApprovalCompat,
    saveFeishuLocalApprovalGrant,
    saveFeishuLocalApprovalReplay,
    saveFeishuRunContinuation,
    buildToolApprovalRequest,
    toApprovalRiskLevel,
    buildApprovalRequestFingerprint,
    deliverLynxFeishuApprovalPromptDirectly,
    assessSkillRisk,
    configureSkillInventoryControlPlane,
    detectSkillInstall,
    quickBlacklistCheck,
    verifyAllInstalledSkills,
    quarantineSkill,
    DISCOVERY_CONFIG_SOURCE_PATH,
    loadDiscoveryRuntimeConfig,
    recommendContext,
    routeModel,
    checkBudget,
    planHeartbeat,
    formatContextRecommendation,
    formatModelRouting,
    formatBudgetStatus,
    buildOptimizationHints,
    isTokenOptimizerAvailable,
    reconcileScheduledLynxCheck,
    resolveScheduledLynxCheckConfig,
    CONFIG,
    checkContentWeighted,
    checkPublicAccessWeighted,
    checkToolWeighted,
    fetchMaliciousSkillBlacklistWeighted,
    getWeightedRiskLevel,
    isRemoteAvailable,
    pushRecordBestEffort,
    registerUserBestEffort,
    canonicalizePath,
    buildGuardContext,
    createReplacementMessage,
    extractMessageText,
    normalizeString,
    redactAgentOutput,
    buildOperationFingerprint,
    consumeApprovedOverrideFull,
    inferBlacklistModules,
    resolveOverrideKey,
    resolveOverrideKeys,
    savePendingOverrideFull,
    buildGuardPolicyTrace,
    buildApiRiskAssessment,
    buildPolicyRecordContent,
    buildOverridePrompt,
    buildParamSummary,
    evaluateGuardDecisionPolicy,
    evaluateRiskAssessment,
    normalizePolicyConfig,
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
    isManualCompositeLynxCheckRequest,
    classifyLynxCheckTrigger,
    clearPendingDiscoveryRequest,
    ensureParentDirectory,
    shouldAttachPendingDiscoveryReport,
    formatDiscoveryReport,
    decorateAssistantMessage,
    buildManualLynxCheckReport,
    clearRecentActiveDeliveryTargetForContext,
    hasConcreteDeliveryTarget,
    getRecentActiveDeliveryTargets,
    readRecentActiveDeliverySnapshots,
    readRecentActiveDeliverySnapshot,
    getRecentActiveDeliveryTarget,
    rememberRecentActiveDeliveryTarget,
    shouldPreferRecentActiveDelivery,
    getHookCapabilityReport,
    getOpenClawRuntimeVersion,
    deliverLynxReport,
    shapeMessageForProvider,
    shapeTextForProvider,
    configureLynxCheckTaskControlPlane,
    createLynxCheckRunIntent,
    getLynxCheckRunReportPath,
    markLynxCheckRunCompleted,
    readLatestPendingLynxCheckRunIntent,
    readLynxCheckRunResult,
    updateLynxCheckRunIntentStatus,
    waitForLynxCheckRunResultSettled,
    writeLynxCheckRunResult,
    buildLynxCheckFallbackFailureNotice,
    buildManualLynxCheckPrompt,
    buildScheduledLynxCheckPrompt,
    deliverManagedLynxAuditReport,
    adaptContentCheckResult,
    adaptToolCheckResult,
    createLocalConsoleTokenProvider,
    ensureLocalConsoleToken,
    createLocalConsoleIngestClient,
    resolveLocalConsoleRuntimeConfig,
    DecisionBroker,
    GoControlPlaneClient,
    handleBeforeAgentStartDecision,
    handleBeforeDispatchDecision,
    handleBeforeInstallEventDecision,
    handleBeforeMessageWriteDecision,
    handleBeforeToolCallDecision,
    handleLlmOutputDecision,
    handleMessageReceivedDecision,
    handleMessageSendingDecision,
    handleToolResultPersistDecision,
    createLocalConsoleGatewayRouteRegistrations,
    createLocalConsoleHookHandlers,
    buildLocalConsoleLynxCheckSnapshot,
    createLocalConsoleSupervisor,
    createLocalConsoleTokenHook,
    appendLocalConsoleWebviewFootnote,
    appendLocalConsoleWebviewFootnoteForL4Reply,
    isTrustedManagedLynxCheckReportText,
    guardInboundMessageBeforeWrite,
    guardPromptBuildInput,
    buildVisibleInputGuardModelContext,
    buildVisibleInputGuardWarning,
    resolvePluginRuntimeConfig,
    buildDeliveryTargetSnapshot,
    buildFeishuNativeToolApprovalReplyPrompt,
    buildOutboundDeliveryTarget,
    createPluginSetupHelpers,
    resolveManagedLynxCheckPromptChannel,
    resolveManagedLynxCheckSource,
    resolveToolApprovalProtectedTargetSummary,
    log,
    sensitiveDataBlocker,
    config,
    localConsoleRuntimeConfig,
    localConsoleRuntime,
    localConsoleHooks,
    decisionBroker,
    selfSafetyGuardConfig,
    outputEnforcementMode,
    riskPolicyConfig,
    trustedOwnerOuIds,
    localApprovalApproverOuIds,
    securityAuditConfig,
    skillGuardConfig,
    tokenOptimizerConfig,
    scheduledLynxCheckConfig,
    managedLynxCheckAuthorizationConfig,
    resolvedScheduledLynxCheckConfig,
    discoveryRuntime,
    openClawDiscoveryConfig,
    runtimeVersion,
    hookCapabilityReport,
    localConsoleTokenHook,
    appendLogWebviewNoteForL4,
    appendLogWebviewNoteForL3Approval,
    DISCOVERY_RESULT_PATH,
    DISCOVERY_RESULT_CONSUMED_PATH,
    DISCOVERY_REQUEST_PATH,
    HOOK_PROBE_LOG_PATH,
    userId,
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
    logGuardPolicyTrace,
  };
  registerLynxHooks(api, {
    registerInputHooks: (api) => registerInputHooks(api, hookRuntime),
    registerToolHooks: (api) => registerToolHooks(api, hookRuntime),
    registerOutputHooks: (api) => registerOutputHooks(api, hookRuntime),
    registerLifecycleHooks: (api) => registerLifecycleHooks(api, hookRuntime),
  });
}
