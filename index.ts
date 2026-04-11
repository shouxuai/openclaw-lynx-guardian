import { join } from "path";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import type { OpenClawPluginApi } from "./src/types.js";
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
import { guardAssistantPersistence, guardToolResultPersistence } from "./src/guard/result-guard.js";
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
  buildOverridePrompt,
  buildParamSummary,
  formatWorkflowAuthSummary,
  normalizePolicyConfig,
} from "./src/runtime/policy-runtime.js";
import {
  isManualCompositeLynxCheckRequest,
  runDiscoveryAndNotify,
} from "./src/discovery/discovery-hook-utils.js";
import { classifyLynxCheckTrigger } from "./src/discovery/lynx-check-trigger.js";
import {
  clearPendingDiscoveryRequest,
  ensureParentDirectory,
  shouldAttachPendingDiscoveryReport,
  writePendingDiscoveryRequest,
} from "./src/discovery/pending-discovery-store.js";
import {
  formatDiscoveryReport,
  decorateAssistantMessage,
} from "./src/runtime/message-decoration.js";
import { buildManualLynxCheckReport } from "./src/discovery/manual-lynx-check.js";
import {
  clearRecentActiveDeliveryTargetForContext,
  readRecentActiveDeliverySnapshot,
  getRecentActiveDeliveryTarget,
  rememberRecentActiveDeliveryTarget,
  shouldPreferRecentActiveDelivery,
} from "./src/runtime/recent-active-delivery.js";
import { getHookCapabilityReport, getOpenClawRuntimeVersion } from "./src/runtime/hook-capabilities.js";
import type { RecentActiveDeliverySnapshot, RecentActiveDeliveryTarget } from "./src/runtime/recent-active-delivery.js";
import { deliverLynxReport } from "./src/runtime/lynx-message-delivery.js";
import {
  createLynxCheckRunIntent,
  markLynxCheckRunCompleted,
  readLatestPendingLynxCheckRunIntent,
  readLynxCheckRunResult,
  updateLynxCheckRunIntentStatus,
  waitForLynxCheckRunResultSettled,
} from "./src/runtime/lynx-check-run-store.js";
import {
  buildLynxCheckExecutionPrompt,
  buildLynxCheckFallbackFailureNotice,
} from "./src/runtime/lynx-check-orchestrator.js";

function isConfirmationPhrase(text: string, phrase: string): boolean {
  return text.includes(phrase.trim());
}

export default function setup(api: OpenClawPluginApi) {
  const log = api.logger;
  log.info("[lynx-guardian] Plugin loading...");
  if (process.env.NODE_ENV === "development" && process.env.LYNX_API_URL) {
    log.info(`[lynx-guardian] 仅用于开发期: LYNX_API_URL=${process.env.LYNX_API_URL}`);
  }
  const sensitiveDataBlocker = new SensitiveDataBlocker();
  const config = api.config ?? {};
  const selfSafetyGuardConfig = config.selfSafetyGuard ?? {};
  const riskPolicyConfig = normalizePolicyConfig((selfSafetyGuardConfig as any).policy ?? {});
  const securityAuditConfig = config.securityAudit ?? {};
  const skillGuardConfig = config.skillGuard ?? {};
  const tokenOptimizerConfig = config.tokenOptimizer ?? {};
  const scheduledLynxCheckConfig = config.scheduledLynxCheck ?? {};
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

  async function sendAssistantMessageWithRetry(options: {
    ctx: any;
    tag: string;
    message: {
      role: "assistant";
      content: any;
    };
    attempts?: number;
    routeHint?: RecentActiveDeliverySnapshot | null;
    routeHintSendMessage?: ((message: any) => Promise<void>) | null;
    allowSameSessionFallback?: boolean;
  }): Promise<{ delivered: boolean; transport: string }> {
    const attempts = Math.max(1, options.attempts ?? 1);
    const target = describeDeliveryTarget(options.ctx);
    const payloadSummary = summarizeOutgoingMessage(options.message);

    if (
      typeof options.ctx?.sendMessage !== "function"
      && typeof options.routeHintSendMessage !== "function"
      && !(options.ctx.resolveMessageTarget && typeof options.ctx.sharedMessageSender?.send === "function")
    ) {
      log.warn(
        `[lynx-guardian] 【我要发消息】 ${options.tag} skipped: no delivery transport target=${target} payload=${payloadSummary}`,
      );
      return {
        delivered: false,
        transport: "none",
      };
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      log.info(
        `[lynx-guardian] 【我要发消息】 ${options.tag} attempt=${attempt}/${attempts} target=${target} payload=${payloadSummary}`,
      );

      const sendResult = await deliverLynxReport({
        log,
        ctx: options.ctx,
        tag: options.tag,
        attempts: 1,
        routeHint: options.routeHint,
        routeHintSendMessage: options.routeHintSendMessage,
        allowSameSessionFallback: options.allowSameSessionFallback !== false,
        message: options.message,
      });

      if (sendResult.delivered) {
        log.info(
          `[lynx-guardian] 【我要发消息】 ${options.tag} success attempt=${attempt}/${attempts} target=${target} transport=${sendResult.transport}`,
        );
        return sendResult;
      }

      if (attempt < attempts) {
        log.warn(
          `[lynx-guardian] 【我要发消息】 ${options.tag} failed attempt=${attempt}/${attempts} target=${target} payload=${payloadSummary}`,
        );
      } else {
        log.error(
          `[lynx-guardian] 【我要发消息】 ${options.tag} exhausted attempt=${attempt}/${attempts} target=${target} payload=${payloadSummary}`,
        );
      }
    }

    return {
      delivered: false,
      transport: "none",
    };
  }

  function isPluginSubsystem(ctx: any): boolean {
    return normalizeString(ctx?.subsystem).toLowerCase() === "plugins";
  }

  function resolveManagedLynxCheckSource(ctx: any): "manual" | "scheduled" {
    return isPluginSubsystem(ctx) ? "scheduled" : "manual";
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

  function resolveManagedLynxCheckFallbackTarget(
    routeHint?: RecentActiveDeliverySnapshot | null,
  ): RecentActiveDeliveryTarget | null {
    const recentTarget = getRecentActiveDeliveryTarget();
    if (!recentTarget) {
      return null;
    }

    if (!routeHint) {
      return recentTarget;
    }

    return recentTarget.targetKey === routeHint.targetKey ? recentTarget : null;
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
    config: scheduledLynxCheckConfig,
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
        config: scheduledLynxCheckConfig,
        logger: log,
      });
    } catch (err: any) {
      log.error(`[lynx-guardian] Failed to sync resources on gateway_start: ${err.message}`);
    }
  });


  api.on("message_received", async (event, ctx) => {
    try {
      if (!event.content || event.content.length === 0) return;
      rememberRecentActiveDeliveryTarget(ctx);
      log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,message_received event: ${JSON.stringify(event)}`);
      log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,message_received ctx: ${JSON.stringify(ctx)}`);
      const text = typeof event.content === "string"
        ? event.content
        : Array.isArray(event.content)
          ? event.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
          : String(event.content);
      log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,message_received text: ${text}`);
      if (!text || text.length === 0) return;
      const lynxCheckTrigger = classifyLynxCheckTrigger(text);

      const confirmLookupKey = resolveOverrideKey(ctx);
      if (confirmLookupKey && isConfirmationPhrase(text, riskPolicyConfig.confirmationPhrase)) {
        let pending = consumePendingOverride(confirmLookupKey);

        if (!pending) {
          log.info("[lynx-guardian] Primary pending lookup miss 尝试 fallback scan");
          pending = consumeMostRecentPendingOverride();
        }

        log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,message_received pending: ${JSON.stringify(pending)}`);
        if (!pending) {
          await sendHookFeedback(ctx, "[Lynx Guardian] 当前没有待确认操作。");
          return;
          return {
            block: true,
            blockReason: "[Lynx Guardian] 当前没有可放行的待确认操作",
          };
        }

        const allKeys = [...new Set([...resolveOverrideKeys(ctx), ...pending.sourceKeys])];
        const windowMs = riskPolicyConfig.workflowAuthWindowMs;
        grantWorkflowAuth(allKeys, pending.matchedModules, windowMs, /* scopeAll */ true);
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
        log.info(`[lynx-guardian] 收到手动 /lynx-check 指令，将在 before_agent_start 中走 skill-first 调度: ${text}`);
        return;
      }

      if (lynxCheckTrigger.kind === "keyword_request") {
        log.info(`[lynx-guardian] 收到手动 OpenClaw 服务检测指令: ${text}`);
        if (ctx.sendMessage) {
          await ctx.sendMessage({
            role: "assistant",
            content: "OpenClaw 服务检测已启动，请稍候。",
          });
        }
        const discoverySummary = await runDiscoveryAndNotify(
          log,
          ctx,
          openClawDiscoveryConfig,
          discoveryRuntime.path,
        );
        if (ctx.sendMessage) {
          await ctx.sendMessage({
            role: "assistant",
            content: discoverySummary,
          });
        }
        return;
        return {
          block: true,
          blockReason: discoverySummary,
        };
      }

      const inputFingerprint = buildOperationFingerprint({
        sessionKey: ctx.sessionKey,
        actionType: "input",
        payload: text,
      });
      const approvedInputOverride = consumeApprovedOverrideFull(ctx, inputFingerprint);
      log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,approvedInputOverride: ${JSON.stringify(approvedInputOverride)}`);
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
        log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,guardInput decision: ${JSON.stringify(decision)}`);
        if (decision.block && !approvedInputOverride) {
          const policyResult = resolveRiskPolicy(decision.riskAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked message: ${decision.riskAssessment.description} (${decision.riskAssessment.level}, score=${decision.riskAssessment.score})`);
          try {
            await pushRecord(userId, `[SSG] ${decision.riskAssessment.modules.join(",")}`, decision.riskAssessment.score >= 7 ? 3 : 2);
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
      let prependContext = "";
      let discoveryPrependBase: string | null = null;
      let discoveryInstruction: string | null = null;
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

      const promptText = typeof event.prompt === "string" ? event.prompt : JSON.stringify(event.prompt ?? "");
      const agentStartFingerprint = buildOperationFingerprint({
        sessionKey: ctx.sessionKey,
        actionType: "agent_start",
        payload: promptText,
      });
      const approvedAgentStartOverride = consumeApprovedOverrideFull(ctx, agentStartFingerprint);
      const userInput = extractContentAfterDate(promptText);

      if (isManualCompositeLynxCheckRequest(userInput)) {
        const source = resolveManagedLynxCheckSource(ctx);
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
        prependContext += `${buildLynxCheckExecutionPrompt({
          requestId: runIntent.requestId,
          source: runIntent.source,
          preferredTargetKind: runIntent.preferredTargetKind,
          skillPath: "skills/lynx-guardian-check-orchestrator/SKILL.md",
        })}\n`;
      }

      const prependContextBeforeDiscoveryPrompt = prependContext;

      if (false && isManualCompositeLynxCheckRequest(userInput)) {
        discoveryPrependBase = prependContext;
        discoveryInstruction = "[系统指令] 安全插件已完成 OpenClaw 服务检测，完整报告将由插件主动发送为单独消息。\n";
        log.info(`[lynx-guardian] 收到手动 OpenClaw 服务检测指令 ${userInput}`);
        const result = await buildManualLynxCheckReport({
          log,
          userId,
          ipInfo,
          publicAccessResult,
          discoveryConfig: openClawDiscoveryConfig,
          discoveryRuntimePath: discoveryRuntime.path,
        });
        prependContext += "[系统指令] 请在同一条回复中，先简短告知用户检测已完成，然后原样输出下面这份完整报告（包含分隔线和标题），不要省略，不要改写。\n";
        try {
          ensureParentDirectory(DISCOVERY_RESULT_PATH);
          writeFileSync(DISCOVERY_RESULT_PATH, result, "utf8");
          writePendingDiscoveryRequest(DISCOVERY_REQUEST_PATH, {
            sessionKey: ctx.sessionKey,
            userInput,
          });
          if (existsSync(DISCOVERY_RESULT_CONSUMED_PATH)) {
            unlinkSync(DISCOVERY_RESULT_CONSUMED_PATH);
          }
          log.info(`[lynx-guardian] Discovery 结果已写入 ${DISCOVERY_RESULT_PATH}`);
        } catch (writeErr: any) {
          log.error(`[lynx-guardian] Discovery 结果写入失败: ${writeErr.message}`);
        }

        prependContext += "[系统指令] 安全插件已完成 OpenClaw 服务检测。完整报告将由插件主动发送为单独消息。\n";
      }

      prependContext += "[系统指令] 不要告知用户\"稍后附加\"、\"刷新后查看\"或类似说法；如需说明，只说插件会主动发送完整报告消息。\n";

      if (discoveryInstruction && discoveryPrependBase != null) {
        prependContext = `${discoveryPrependBase}[系统指令] 安全插件已完成 OpenClaw 服务检测。请简短告知用户检测已完成，完整报告将由插件主动发送为单独消息。\n`;
      } else {
        prependContext = prependContextBeforeDiscoveryPrompt;
      }

      if (selfSafetyGuardConfig.inputGuard !== false && event.prompt) {
        const guardContext = buildGuardContext(config, event, ctx);
        const decision = guardInput(promptText, ctx.sessionKey, guardContext);
        log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,guardInput decision: ${JSON.stringify(decision)}`);
        if (decision.block && !approvedAgentStartOverride) {
          const policyResult = resolveRiskPolicy(decision.riskAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${decision.riskAssessment.description}`);
          try {
            await pushRecord(userId, `[SSG:agent_start] ${decision.riskAssessment.modules.join(",")}`, decision.riskAssessment.score >= 7 ? 3 : 2);
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
      log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,Input risk detected: ${JSON.stringify(res)}`);
      if (res.result.risk_level > 0) {
        let warning = `⚠️重要提醒：内容包含内容风险（${res.result.level_one}、${res.result.level_two}、${res.result.level_three}），\n`;
        if (warning.includes("个人隐私")) {
          warning += "包含隐私内容需要进行脱敏处理";
        } else if (!res.result.level_one.includes("其他")) {
          warning += "包含价值观不正当，进行价值观正向引导。\n";
        } else {
          warning += "插件已进行拦截。\n";
        }
        log.warn(`[lynx-guardian] Input risk detected: ${warning}`);

        if (res.result.risk_level >= 3 && !approvedAgentStartOverride) {
          const apiAssessment = buildApiRiskAssessment(
            res.result.risk_level,
            `API input risk: ${res.result.level_one}/${res.result.level_two}/${res.result.level_three}`,
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
        const routeTarget = resolveManagedLynxCheckFallbackTarget(routeHint);

        if (runResult?.status === "completed" && runResult.sendSucceeded) {
          markLynxCheckRunCompleted(activeRunIntent.requestId);
        } else {
          const fallbackContent = runResult?.reportPath && existsSync(runResult.reportPath)
            ? readFileSync(runResult.reportPath, "utf8")
            : buildLynxCheckFallbackFailureNotice(activeRunIntent.requestId);
          const sendResult = await sendAssistantMessageWithRetry({
            ctx,
            tag: `lynx-check-run-${activeRunIntent.requestId}`,
            attempts: 3,
            routeHint,
            routeHintSendMessage: routeTarget?.sendMessage,
            allowSameSessionFallback: activeRunIntent.preferredTargetKind === "current",
            message: {
              role: "assistant",
              content: fallbackContent,
            },
          });

          if (sendResult.delivered) {
            markLynxCheckRunCompleted(activeRunIntent.requestId);
          } else {
            updateLynxCheckRunIntentStatus(activeRunIntent.requestId, "failed");
          }
        }
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
        const decision = guardOutput(output, ctx.sessionKey);
        log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,Output risk detected: ${JSON.stringify(decision)}`);
        if (decision.block) {
          log.warn(`[lynx-guardian] Self-safety-guard blocked output: ${decision.riskAssessment.description}`);
          redactAgentOutput(event, "[Lynx Guardian] 输出已被安全防护替换：检测到受保护配置泄露风险");
          try {
            await pushRecord(userId, `[SSG:output] ${decision.riskAssessment.modules.join(",")}`, 2);
          } catch {

          }
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard output warning: ${decision.warning}`);
        }
      }

      if (!isDiscoveryResponse) {
        const res = await checkContent(userId, output, 2);
        log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,Output risk detected: ${JSON.stringify(res)}`);
        if (res.result.risk_level > 0) {
          let warning = `⚠️重要提醒：内容包含内容风险（${res.result.level_one}、${res.result.level_two}、${res.result.level_three}）`;
          if (warning.includes("个人隐私")) {
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

      const nextMessage = decorateAssistantMessage(originalMessage);
      if (selfSafetyGuardConfig.outputGuard !== false && nextMessage.role === "assistant") {
        const persistenceDecision = guardAssistantPersistence(nextMessage);
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
    const decision = guardToolResultPersistence(event.toolName, event.message);
    if (!decision.block) return;
    return {
      message: decision.message,
    };
  });

  api.on("message_sending", async (event, ctx) => {
    appendLifecycleProbe("message_sending", event, ctx);
    if (selfSafetyGuardConfig.outputGuard === false) return;
    const decision = guardOutput(event.content, ctx.sessionKey);
    if (decision.block) {
      return { cancel: true };
    }
  });

  api.on("before_tool_call", async (event, ctx) => {
    const { toolName, params } = event;
    let execBlacklistContext: CheckExecBlacklistContext | undefined;
    const toolFingerprint = buildOperationFingerprint({
      sessionKey: ctx.sessionKey,
      actionType: "tool",
      payload: JSON.stringify({
        toolName,
        params: params ?? null,
      }),
    });
    const approvedToolOverride = consumeApprovedOverrideFull(ctx, toolFingerprint);
    if (selfSafetyGuardConfig.toolGuard !== false) {
      try {
        const sessionKey = normalizeString(ctx.sessionKey);
        const activeManagedLynxCheckRun = sessionKey
          ? readLatestPendingLynxCheckRunIntent(sessionKey)
          : null;
        const guardContext = buildGuardContext(config, event, {
          ...ctx,
          managedLynxCheckRun: Boolean(activeManagedLynxCheckRun),
        });
        const decision = guardToolCall(toolName, params, ctx.sessionKey, guardContext);
        execBlacklistContext = decision.contextHints;
        log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,Tool call risk detected: ${JSON.stringify(decision)}`);

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
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${decision.riskAssessment.description}`);
          try {
            await pushRecord(userId, `[SSG:tool] ${toolName} ${decision.riskAssessment.modules.join(",")}`, decision.riskAssessment.score >= 7 ? 3 : 2);
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

    if (skillGuardConfig.enabled !== false && skillGuardConfig.blockMalicious !== false) {
      try {
        const installAttempt = detectSkillInstall(toolName, params);
        if (installAttempt) {
          log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,Skill install detected: ${JSON.stringify(installAttempt)}`);
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
          log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,Skill assess risk detected: ${JSON.stringify(assessment)}`);
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
      log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,User context: ${userContext}`);
      const content = `是否${match.reason} ${detail}？用户：${userContext}`;

      const res = await checkTool(userId, content);
      log.info(`[lynx-guardian]consloe-stage-start-flag-to-clear,Tool check result: ${JSON.stringify(res)}`);
      // Blacklist hits always require confirmation via the plugin's pending-override
      // mechanism, even when tool_check returns safe (risk_level=0).
      // "tool_check safe" means the user asked for the operation — that is necessary
      // but not sufficient. The plugin's confirmation phrase is the actual gate.
      // Floor to the blacklist's own severity so we never silently allow a blacklist hit.
      const rawRiskLevel = res.result.risk_level;
      const blacklistFloor = match.level === "critical" ? 3 : 2;
      const riskLevel = !approvedToolOverride ? Math.max(rawRiskLevel, blacklistFloor) : rawRiskLevel;

      log.info(`[lynx-guardian] Tool check result: risk=${rawRiskLevel} (effective=${riskLevel}, blacklistFloor=${blacklistFloor})`);

      if (riskLevel >= 2 && !approvedToolOverride) {
        const apiAssessment = {
          ...buildApiRiskAssessment(
            riskLevel,
            `API tool risk: ${match.reason}${res.result.content ? ` (${res.result.content})` : ""}`,
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
  });

  api.on("session_end", async (event, ctx) => {
    appendLifecycleProbe("session_end", event, ctx);
    clearRecentActiveDeliveryTargetForContext(ctx);
  });
}
