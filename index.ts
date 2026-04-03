import { join, dirname } from "path";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import type { OpenClawPluginApi, EventContext } from "./src/types.js";
import {
  ensureUserRegistered,
  readRecentContext,
  ensureResources,
  baseIpInfo,
  extractContentAfterDate,
} from "./src/utils.js";
import { registerUser, checkContent, checkTool, pushRecord, checkPublicAccess, fetchMaliciousSkillBlacklist } from "./src/api.js";
import { checkExecBlacklist, checkPathBlacklist } from "./src/blacklist.js";
import { SensitiveDataBlocker } from "./src/guard/sensitive.js";
import { guardInput, guardOutput, guardToolCall } from "./src/guard/safety-guard.js";
import type { RiskAssessment } from "./src/guard/safety-guard.js";
import { resolveRiskPolicy } from "./src/guard/risk-policy.js";
import { runSecurityAudit, runMaliciousScriptScan, formatAuditSummary } from "./src/runtime/security-audit-runner.js";
import {
  savePendingOverride,
  getPendingOverride,
  consumePendingOverride,
  consumeMostRecentPendingOverride,
} from "./src/runtime/pending-override-store.js";
import type { PendingOverride } from "./src/runtime/pending-override-store.js";
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
import { reconcileScheduledLynxCheck } from "./src/runtime/scheduled-lynx-check.js";
import { CONFIG } from "./src/config.js";
import {
  canonicalizePath,
  buildGuardContext,
  redactAgentOutput,
} from "./src/runtime/plugin-runtime-helpers.js";
import {
  isManualDiscoveryRequest,
} from "./src/discovery/discovery-hook-utils.js";
import {
  appendDiscoveryReportToContent,
  formatDiscoveryReport,
  appendDiscoveryReportToMessage,
  decorateAssistantMessage,
} from "./src/runtime/message-decoration.js";
import { buildManualLynxCheckReport } from "./src/discovery/manual-lynx-check.js";

const DEFAULT_CONFIRMATION_PHRASE = "确认放行本次操作";
const DEFAULT_OVERRIDE_TTL_MS = 90 * 1000;
const DEFAULT_OVERRIDE_LEVELS = ["L2", "L3", "L4"] as const;

const approvedOverrides = new Map<string, { operationFingerprint: string; expiresAt: number }>();

function pruneApprovedOverrides(now: number = Date.now()): void {
  for (const [sessionKey, approved] of approvedOverrides) {
    if (approved.expiresAt <= now) {
      approvedOverrides.delete(sessionKey);
    }
  }
}

function buildOperationFingerprint(params: {
  sessionKey?: string;
  actionType: "input" | "tool" | "agent_start";
  payload: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(params))
    .digest("hex");
}

function normalizePolicyConfig(policy: any = {}) {
  return {
    absoluteRejectScore: policy.absoluteRejectScore ?? 10,
    confirmationPhrase: policy.confirmationPhrase ?? DEFAULT_CONFIRMATION_PHRASE,
    allowOneTimeOverrideLevels: policy.allowOneTimeOverrideLevels ?? [...DEFAULT_OVERRIDE_LEVELS],
    moduleOverrides: {
      M3: {
        allowOneTimeOverride: policy.moduleOverrides?.M3?.allowOneTimeOverride ?? true,
      },
    },
    overrideTtlMs: Math.max(30, Number(policy.overrideTtlSeconds ?? 90)) * 1000,
    /**
     * Duration (ms) for the time-window workflow authorization.
     * Once the user confirms, ALL blocked operations within this window are automatically
     * allowed through — regardless of which modules they trigger. Defaults to 3 minutes.
     * Configurable via policy.workflowAuthWindowSeconds (30 – 900 seconds).
     */
    workflowAuthWindowMs: Math.min(
      900_000,
      Math.max(30_000, Number(policy.workflowAuthWindowSeconds ?? 180)) * 1000,
    ),
  };
}

function isConfirmationPhrase(text: string, phrase: string): boolean {
  // Allow the phrase to appear anywhere in the message — token optimizer and
  // other system annotations may prepend context lines to the user's text.
  return text.includes(phrase.trim());
}

function approvePendingOverride(sessionKey: string, operationFingerprint: string, expiresAt: number): void {
  pruneApprovedOverrides();
  approvedOverrides.set(sessionKey, { operationFingerprint, expiresAt });
}

function consumeApprovedOverride(sessionKey: string | undefined, operationFingerprint: string): boolean {
  if (!sessionKey) {
    return false;
  }
  pruneApprovedOverrides();
  const approved = approvedOverrides.get(sessionKey);
  if (!approved || approved.operationFingerprint !== operationFingerprint) {
    return false;
  }
  approvedOverrides.delete(sessionKey);
  return true;
}

/**
 * Returns all non-empty, deduplicated override keys derivable from ctx.
 * message_received only provides channelId; tool/agent handlers provide sessionKey
 * (and usually channelId too). By collecting both, we can do cross-handler matching.
 */
function resolveOverrideKeys(ctx: EventContext): string[] {
  const keys = new Set<string>();
  if (ctx.sessionKey) keys.add(ctx.sessionKey);
  if (ctx.channelId) keys.add(ctx.channelId);
  return [...keys];
}

/** Primary lookup key: prefer channelId (present in all event types), fall back to sessionKey. */
function resolveOverrideKey(ctx: EventContext): string | undefined {
  return ctx.channelId ?? ctx.sessionKey;
}

/** Save a pending override under every key available in ctx. */
function savePendingOverrideFull(ctx: EventContext, override: PendingOverride): void {
  const keys = resolveOverrideKeys(ctx);
  for (const key of keys) {
    savePendingOverride(key, override);
  }
}

/**
 * Approve a pending override under all sourceKeys stored in the override object,
 * plus any additional keys available in the current ctx.
 * This bridges the gap between the handler that saved the override (has sessionKey)
 * and the handler that consumes the confirmation (only has channelId).
 */
function approvePendingOverrideFull(
  ctx: EventContext,
  pending: PendingOverride,
): void {
  const allKeys = new Set<string>([
    ...resolveOverrideKeys(ctx),
    ...pending.sourceKeys,
  ]);
  const entry = { operationFingerprint: pending.operationFingerprint, expiresAt: pending.expiresAt };
  pruneApprovedOverrides();
  for (const key of allKeys) {
    approvedOverrides.set(key, entry);
  }
}

/**
 * Consume an approved override, checking all keys derivable from ctx.
 * Returns true (and removes the entry) when a matching approval is found under any key.
 */
function consumeApprovedOverrideFull(ctx: EventContext, fingerprint: string): boolean {
  pruneApprovedOverrides();
  for (const key of resolveOverrideKeys(ctx)) {
    const approved = approvedOverrides.get(key);
    if (approved && approved.operationFingerprint === fingerprint) {
      // Clean up ALL keys pointing to the same approval to prevent double-use
      for (const k of resolveOverrideKeys(ctx)) {
        if (approvedOverrides.get(k)?.operationFingerprint === fingerprint) {
          approvedOverrides.delete(k);
        }
      }
      return true;
    }
  }
  return false;
}

function buildApiRiskAssessment(
  riskLevel: number,
  description: string,
): RiskAssessment {
  if (riskLevel >= 3) {
    return {
      level: "L4",
      score: 9,
      modules: [],
      description,
      action: "deny",
    };
  }
  if (riskLevel === 2) {
    return {
      level: "L2",
      score: 6,
      modules: [],
      description,
      action: "block",
    };
  }
  if (riskLevel === 1) {
    return {
      level: "L1",
      score: 3,
      modules: [],
      description,
      action: "warn",
    };
  }
  return {
    level: "L0",
    score: 0,
    modules: [],
    description,
    action: "allow",
  };
}

function buildOverridePrompt(message: string, confirmationPhrase: string): string {
  return `${message} 如确认放行本次工作流中的此类操作，请回复"${confirmationPhrase}"。`;
}

const MODULE_DISPLAY_NAMES: Record<string, string> = {
  "M0:identity_verification":  "身份声明",
  "M2:protected_file_access":  "核心配置文件访问",
  "M3:over_agency":            "过度代理/权限提升",
};

function moduleDisplayName(mod: string): string {
  return MODULE_DISPLAY_NAMES[mod] ?? mod;
}

function buildParamSummary(toolName: string, params: Record<string, any>): string {
  if (toolName === "exec") return String(params?.command ?? "").slice(0, 120);
  return String(params?.path ?? params?.file_path ?? JSON.stringify(params)).slice(0, 120);
}

function formatWorkflowAuthSummary(auth: import("./src/runtime/workflow-authorization-store.js").WorkflowAuthorization): string {
  const durationSec = Math.round((Date.now() - auth.grantedAt) / 1000);
  const moduleNames = auth.allowedModules.map(moduleDisplayName).join("、");
  const scopeDesc = auth.scopeAll ? "全模块（时间窗口）" : moduleNames;
  const lines: string[] = [
    `🔓 **[Lynx Guardian] 工作流授权已回收**`,
    ``,
    `授权范围：${scopeDesc}`,
    `工作流时长：${durationSec}s`,
    `放行操作记录（共 ${auth.auditLog.length} 次）：`,
  ];
  auth.auditLog.forEach((e, i) => {
    const t = new Date(e.timestamp).toLocaleTimeString("zh-CN", { hour12: false });
    lines.push(`  ${i + 1}. [${t}] ${e.toolName}: ${e.paramSummary}`);
  });
  if (auth.auditLog.length === 0) {
    lines.push("  （工作流中未产生实际放行操作）");
  }
  return lines.join("\n");
}

type PendingDiscoveryRequest = {
  sessionKey?: string;
  userInput: string;
};

function ensureParentDirectory(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function writePendingDiscoveryRequest(filePath: string, request: PendingDiscoveryRequest): void {
  ensureParentDirectory(filePath);
  writeFileSync(filePath, JSON.stringify(request), "utf8");
}

function readPendingDiscoveryRequest(filePath: string): PendingDiscoveryRequest | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.userInput !== "string") {
      return null;
    }

    return {
      sessionKey: typeof parsed.sessionKey === "string" ? parsed.sessionKey : undefined,
      userInput: parsed.userInput,
    };
  } catch {
    return null;
  }
}

function clearPendingDiscoveryRequest(filePath: string): void {
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

function shouldAttachPendingDiscoveryReport(filePath: string, currentSessionKey?: string): boolean {
  const pendingRequest = readPendingDiscoveryRequest(filePath);
  if (!pendingRequest || !isManualDiscoveryRequest(pendingRequest.userInput)) {
    return false;
  }

  if (pendingRequest.sessionKey || currentSessionKey) {
    return pendingRequest.sessionKey === currentSessionKey;
  }

  return true;
}

export default function setup(api: OpenClawPluginApi) {
  const log = api.logger;
  log.info("[lynx-guardian] Plugin loading...");
  const sensitiveDataBlocker = new SensitiveDataBlocker();
  const config = api.config ?? {};
  const selfSafetyGuardConfig = config.selfSafetyGuard ?? {};
  const riskPolicyConfig = normalizePolicyConfig((selfSafetyGuardConfig as any).policy ?? {});
  const securityAuditConfig = config.securityAudit ?? {};
  const skillGuardConfig = config.skillGuard ?? {};
  const tokenOptimizerConfig = config.tokenOptimizer ?? {};
  const scheduledLynxCheckConfig = config.scheduledLynxCheck ?? {};
  const discoveryRuntime = {
    path: DISCOVERY_CONFIG_SOURCE_PATH,
    config: loadDiscoveryRuntimeConfig(config.openclawDiscovery),
  };
  const openClawDiscoveryConfig = discoveryRuntime.config;
  // discovery 检测结果通过文件传递（before_agent_start 与 agent_end 可能不在同一线程）
  const DISCOVERY_RESULT_PATH = join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".openclaw", ".lynx-pending-discovery.txt");
  const DISCOVERY_RESULT_CONSUMED_PATH = join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".openclaw", ".lynx-pending-discovery.consumed");
  const DISCOVERY_REQUEST_PATH = join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".openclaw", ".lynx-pending-discovery.request.json");
  let userId: string;

  try {
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

    // Run malicious script scanner on skills
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

  // ── Startup Skill Integrity Verification ─────────────────────────
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

          // Auto-quarantine if enabled
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

  // ── Startup Token Optimizer (SX-openclaw-token-optimizer) ─────────
  if (tokenOptimizerConfig.enabled !== false && isTokenOptimizerAvailable()) {
    (async () => {
      try {
        // Budget check on startup
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

        // Heartbeat optimization on startup
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
      log.info(`[lynx-guardian] Resources synced on gateway_start (port=${event?.port ?? "unknown"})`);
      await reconcileScheduledLynxCheck({
        config: scheduledLynxCheckConfig,
        logger: log,
      });
    } catch (err: any) {
      log.error(`[lynx-guardian] Failed to sync resources on gateway_start: ${err.message}`);
    }
  });


  // ── Event: message_received ──────────────────────────────────────
  api.on("message_received", async (event, ctx) => {
    try {
      if (!event.content || event.content.length === 0) return;
      log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 message_received event: ${JSON.stringify(event)}`);
      log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 message_received ctx: ${JSON.stringify(ctx)}`);
      // P0-1: Normalize content - may be string or Array<{type, text}>
      const text = typeof event.content === "string"
        ? event.content
        : Array.isArray(event.content)
          ? event.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
          : String(event.content);
      log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 message_received text: ${text}`);
      if (!text || text.length === 0) return;

      // ── Confirmation phrase handler ──────────────────────────────
      // Uses channelId as the primary key because message_received ctx may not
      // carry sessionKey. The pending override stores all sourceKeys so approval
      // is registered under every key the tool handler will later look up.
      const confirmLookupKey = resolveOverrideKey(ctx);
      if (confirmLookupKey && isConfirmationPhrase(text, riskPolicyConfig.confirmationPhrase)) {
        // Primary lookup: by the key available in this handler (usually channelId).
        let pending = consumePendingOverride(confirmLookupKey);

        // P0 Fallback: before_tool_call ctx typically only carries sessionKey while
        // message_received ctx only carries channelId — the two key sets never overlap.
        // When the direct lookup fails, scan all stored pending overrides and consume
        // the most recently created non-expired one.
        if (!pending) {
          log.info("[lynx-guardian] Primary pending lookup miss — trying fallback scan");
          pending = consumeMostRecentPendingOverride();
        }

        log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 message_received pending: ${JSON.stringify(pending)}`);
        if (!pending) {
          return {
            block: true,
            blockReason: "[Lynx Guardian] 当前没有可放行的待确认操作。",
          };
        }

        // Grant workflow-level authorization — time-window (scopeAll) mode:
        // covers ALL blocked operations within the configured window regardless of
        // which modules they trigger, until agent_end fires (or the window expires).
        const allKeys = [...new Set([...resolveOverrideKeys(ctx), ...pending.sourceKeys])];
        const windowMs = riskPolicyConfig.workflowAuthWindowMs;
        grantWorkflowAuth(allKeys, pending.matchedModules, windowMs, /* scopeAll */ true);
        const windowSec = Math.round(windowMs / 1000);
        return {
          block: true,
          blockReason: `[Lynx Guardian] 已确认，工作流授权已开放（时间窗口：${windowSec}s）。此窗口内的相关操作将自动放行，工作流结束后将自动收回并汇报操作记录。`,
        };
      }

      const inputFingerprint = buildOperationFingerprint({
        sessionKey: ctx.sessionKey,
        actionType: "input",
        payload: text,
      });
      const approvedInputOverride = consumeApprovedOverrideFull(ctx, inputFingerprint);
      log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 approvedInputOverride: ${JSON.stringify(approvedInputOverride)}`);
      // Sensitive data check
      if (sensitiveDataBlocker.containsSensitiveData(text)) {
        log.warn("[lynx-guardian] Sensitive data detected in message");
        await pushRecord(userId, text, 1);
        return {
          block: true,
          blockReason: "Sensitive data detected",
        };
      }

      // Self-safety-guard: input guard (M1 prompt injection + M2 system prompt extraction)
      if (selfSafetyGuardConfig.inputGuard !== false) {
        const guardContext = buildGuardContext(config, event, ctx);
        const decision = guardInput(text, ctx.sessionKey, guardContext);
        log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 guardInput decision: ${JSON.stringify(decision)}`);
        if (decision.block && !approvedInputOverride) {
          const policyResult = resolveRiskPolicy(decision.riskAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked message: ${decision.riskAssessment.description} (${decision.riskAssessment.level}, score=${decision.riskAssessment.score})`);
          try {
            await pushRecord(userId, `[SSG] ${decision.riskAssessment.modules.join(",")}`, decision.riskAssessment.score >= 7 ? 3 : 2);
          } catch {
            /* best-effort */
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
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard warning: ${decision.warning}`);
        }
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] message_received handler failed: ${err.message}`);
    }
  });

  // ── Event: before_agent_start ────────────────────────────────────
  api.on("before_agent_start", async (event, ctx) => {
    try {
      if (!event.prompt && !event.messages) return;
      let prependContext = "";
      let discoveryPrependBase: string | null = null;
      let discoveryInstruction: string | null = null;
      let publicAccessResult: any = null;
      // Public access check
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

      // Normalize prompt text for both SSG guard and API check
      const promptText = typeof event.prompt === "string" ? event.prompt : JSON.stringify(event.prompt ?? "");
      const agentStartFingerprint = buildOperationFingerprint({
        sessionKey: ctx.sessionKey,
        actionType: "agent_start",
        payload: promptText,
      });
      const approvedAgentStartOverride = consumeApprovedOverrideFull(ctx, agentStartFingerprint);
      // 提取用户原始输入（去掉 [日期时间] 前缀）
      const userInput = extractContentAfterDate(promptText);
      const prependContextBeforeDiscoveryPrompt = prependContext;

      // OpenClaw 服务检测：匹配用户原始输入（去除日期前缀后）
      if (isManualDiscoveryRequest(userInput)) {
        discoveryPrependBase = prependContext;
        discoveryInstruction = "[系统指令] 安全插件已完成 OpenClaw 服务检测，完整报告将由插件自动附加在最终输出后面，如果没有自动输出请刷新一下。\n";
        log.info(`[lynx-guardian] 收到手动 OpenClaw 服务检测指令: ${userInput}`);
        const result = await buildManualLynxCheckReport({
          log,
          userId,
          ipInfo,
          publicAccessResult,
          discoveryConfig: openClawDiscoveryConfig,
          discoveryRuntimePath: discoveryRuntime.path,
        });
        prependContext += "[系统指令] 请在同一条回复中，先简短告知用户检测已完成，然后原样输出下面这份完整报告（包含分隔线和标题），不要省略，不要改写。\n";
        // 结果写文件，agent_end 中用于跳过内容风险检查
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
          log.info(`[lynx-guardian] Discovery 结果已写入: ${DISCOVERY_RESULT_PATH}`);
        } catch (writeErr: any) {
          log.error(`[lynx-guardian] Discovery 结果写入失败: ${writeErr.message}`);
        }

        prependContext += "[系统指令] 安全插件已完成 OpenClaw 服务检测。完整报告将由插件自动附加在最终输出后面。\n";
      }

      prependContext += "[系统指令] 不要告知用户\"稍后附加\"、\"刷新后查看\"或类似说法，直接在本条回复内输出上面的完整报告。\n";

      if (discoveryInstruction && discoveryPrependBase != null) {
        prependContext = `${discoveryPrependBase}[系统指令] 安全插件已完成 OpenClaw 服务检测。请简短告知用户检测已完成，完整报告将由插件自动附加在最终输出后面。\n`;
      } else {
        prependContext = prependContextBeforeDiscoveryPrompt;
      }

      // Self-safety-guard: input guard on prompt
      if (selfSafetyGuardConfig.inputGuard !== false && event.prompt) {
        const guardContext = buildGuardContext(config, event, ctx);
        const decision = guardInput(promptText, ctx.sessionKey, guardContext);
        log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 guardInput decision: ${JSON.stringify(decision)}`);
        if (decision.block && !approvedAgentStartOverride) {
          const policyResult = resolveRiskPolicy(decision.riskAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${decision.riskAssessment.description}`);
          try {
            await pushRecord(userId, `[SSG:agent_start] ${decision.riskAssessment.modules.join(",")}`, decision.riskAssessment.score >= 7 ? 3 : 2);
          } catch {
            /* best-effort */
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
      }

      // Token Optimizer: context optimization + model routing
      if (tokenOptimizerConfig.enabled !== false && isTokenOptimizerAvailable()) {
        try {
          let ctxRec = null;
          let modelRec = null;
          let budgetRec = null;

          // Context optimization: recommend minimal file loading
          if (tokenOptimizerConfig.contextOptimizer !== false) {
            ctxRec = await recommendContext(promptText);
            if (ctxRec) {
              log.info(`[lynx-guardian] ${formatContextRecommendation(ctxRec)}`);
            }
          }

          // Model routing: suggest cheaper tier
          if (tokenOptimizerConfig.modelRouter !== false) {
            modelRec = await routeModel(promptText);
            if (modelRec) {
              log.info(`[lynx-guardian] ${formatModelRouting(modelRec)}`);
            }
          }

          // Budget check: warn if approaching limit
          if (tokenOptimizerConfig.budgetTracking !== false) {
            budgetRec = await checkBudget();
            if (budgetRec && budgetRec.status !== "ok") {
              log.warn(`[lynx-guardian] ${formatBudgetStatus(budgetRec)}`);
            }
          }

          // Build optimization hints for the agent
          const hints = buildOptimizationHints(ctxRec, modelRec, budgetRec);
          if (hints) {
            prependContext += `${hints}\n`;
          }
        } catch (err: any) {
          log.error(`[lynx-guardian] Token optimizer failed: ${err.message}`);
        }
      }

      // Check input risk via API
      const input = extractContentAfterDate(promptText);
      const res = await checkContent(userId, input, 1);
      log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 Input risk detected: ${JSON.stringify(res)}`);
      if (res.result.risk_level > 0) {
        let warning = `⚠️重要提醒：内容包含内容风险（${res.result.level_one}、${res.result.level_two}、${res.result.level_three}），\n`;
        if (warning.includes("个人隐私")) {
          warning += "包含隐私内容需要进行脱敏处理。";
        } else if (!res.result.level_one.includes("其他")) {
          warning += "包含价值观不正当，进行价值观正向引导。\n";
        } else {
          warning += "插件已进行拦截。\n";
        }
        log.warn(`[lynx-guardian] Input risk detected: ${warning}`);

        // P1-10: Block high-risk content instead of just warning
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

  // ── Event: agent_end ─────────────────────────────────────────────
  api.on("agent_end", async (event, ctx) => {
    try {
      log.info(JSON.stringify(ctx));

      // Revoke any active workflow authorization and send the audit summary.
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

      // discovery 输出包含 IP 等信息，跳过后续内容风险检查（避免误报隐私泄露）
      const isDiscoveryResponse = existsSync(DISCOVERY_RESULT_PATH) || existsSync(DISCOVERY_RESULT_CONSUMED_PATH);

      // discovery 主路径已经迁到 before_message_write；这里只保留兜底发送和清理
      if (
        existsSync(DISCOVERY_RESULT_PATH)
        && !existsSync(DISCOVERY_RESULT_CONSUMED_PATH)
        && shouldAttachPendingDiscoveryReport(DISCOVERY_REQUEST_PATH, ctx.sessionKey)
      ) {
        try {
          const discoveryOutput = readFileSync(DISCOVERY_RESULT_PATH, "utf8");
          unlinkSync(DISCOVERY_RESULT_PATH);
          clearPendingDiscoveryRequest(DISCOVERY_REQUEST_PATH);
          if (discoveryOutput && ctx.sendMessage) {
            await ctx.sendMessage({
              role: "assistant",
              content: formatDiscoveryReport(discoveryOutput),
            });
            log.info("[lynx-guardian] Discovery 结果已通过 agent_end fallback sendMessage 推送");
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

      // P0-2: Defensive property chain access
      const lastMsg = event.messages[event.messages.length - 1];
      if (!lastMsg?.content) return;
      const lastContent = Array.isArray(lastMsg.content) ? lastMsg.content : [{ text: typeof lastMsg.content === "string" ? lastMsg.content : "" }];
      if (lastContent.length === 0) return;
      const lastMessage = lastContent[lastContent.length - 1];
      const output = lastMessage?.text ?? "";
      // Self-safety-guard: output guard (M2 system prompt leak detection)
      if (selfSafetyGuardConfig.outputGuard !== false && output && !isDiscoveryResponse) {
        const decision = guardOutput(output);
        log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 Output risk detected: ${JSON.stringify(decision)}`);
        if (decision.block) {
          log.warn(`[lynx-guardian] Self-safety-guard blocked output: ${decision.riskAssessment.description}`);
          // Best effort: redact mutable event payloads when the host exposes them by reference.
          redactAgentOutput(event, "[Lynx Guardian] 输出已被安全防护替换：检测到受保护配置泄露风险。");
          try {
            await pushRecord(userId, `[SSG:output] ${decision.riskAssessment.modules.join(",")}`, 2);
          } catch {
            /* best-effort */
          }
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard output warning: ${decision.warning}`);
        }
      }

      // API-based content check（discovery 输出含 IP 是预期行为，跳过检查）
      if (!isDiscoveryResponse) {
        const res = await checkContent(userId, output, 2);
        log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 Output risk detected: ${JSON.stringify(res)}`);
        if (res.result.risk_level > 0) {
          let warning = `⚠️重要提醒：内容包含内容风险（${res.result.level_one}、${res.result.level_two}、${res.result.level_three}）`;
          if (warning.includes("个人隐私")) {
            warning += "隐私内容需要进行脱敏处理，请勿在非必要场景随意提供。";
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

  // ── Event: before_message_write ──────────────────────────────────
  api.on("before_message_write", (event, ctx) => {
    try {
      const originalMessage = event?.message;
      if (!originalMessage) return;

      let nextMessage = originalMessage;
      if (originalMessage.role === "assistant" && existsSync(DISCOVERY_RESULT_PATH)) {
        try {
          if (shouldAttachPendingDiscoveryReport(DISCOVERY_REQUEST_PATH, ctx.sessionKey)) {
            const discoveryOutput = readFileSync(DISCOVERY_RESULT_PATH, "utf8");
            const report = formatDiscoveryReport(discoveryOutput);
            if (report) {
              nextMessage = appendDiscoveryReportToMessage(nextMessage, report);
              unlinkSync(DISCOVERY_RESULT_PATH);
              clearPendingDiscoveryRequest(DISCOVERY_REQUEST_PATH);
              ensureParentDirectory(DISCOVERY_RESULT_CONSUMED_PATH);
              writeFileSync(DISCOVERY_RESULT_CONSUMED_PATH, "1", "utf8");
              log.info("[lynx-guardian] Discovery report appended in before_message_write");
            }
          }
        } catch (discoveryErr: any) {
          log.error(`[lynx-guardian] Discovery append in before_message_write failed: ${discoveryErr.message}`);
        }
      }

      nextMessage = decorateAssistantMessage(nextMessage);
      if (nextMessage === originalMessage) return;

      log.info("[lynx-guardian] Assistant message decorated before persistence");
      return {
        message: nextMessage,
      };
    } catch (err: any) {
      log.error(`[lynx-guardian] before_message_write handler failed: ${err.message}`);
    }
  });

  // ── Event: before_tool_call ──────────────────────────────────────
  api.on("before_tool_call", async (event, ctx) => {
    const { toolName, params } = event;
    const toolFingerprint = buildOperationFingerprint({
      sessionKey: ctx.sessionKey,
      actionType: "tool",
      payload: JSON.stringify({
        toolName,
        params: params ?? null,
      }),
    });
    const approvedToolOverride = consumeApprovedOverrideFull(ctx, toolFingerprint);
    // Self-safety-guard: tool call guard (M3 over-agency, M5 credential theft, fatal triangle)
    if (selfSafetyGuardConfig.toolGuard !== false) {
      try {
        const guardContext = buildGuardContext(config, event, ctx);
        const decision = guardToolCall(toolName, params, ctx.sessionKey, guardContext);
        log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 Tool call risk detected: ${JSON.stringify(decision)}`);

        // Check workflow-level authorization BEFORE blocking — if the user already
        // confirmed a workflow grant that covers all triggered modules, allow through.
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
            log.info(`[lynx-guardian] ✅ Workflow auth: ${toolName} allowed (modules: ${decision.riskAssessment.modules.join(",")})`);
            // Fall through — do not block
          }
        }

        if (decision.block && !approvedToolOverride && !getWorkflowAuth(resolveOverrideKeys(ctx), decision.riskAssessment.modules)) {
          const policyResult = resolveRiskPolicy(decision.riskAssessment, riskPolicyConfig);
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${decision.riskAssessment.description}`);
          try {
            await pushRecord(userId, `[SSG:tool] ${toolName} ${decision.riskAssessment.modules.join(",")}`, decision.riskAssessment.score >= 7 ? 3 : 2);
          } catch {
            /* best-effort */
          }
          if (resolveOverrideKey(ctx) && policyResult.override.allowed) {
            // Check whether a pending override already exists BEFORE saving, so we
            // can detect the "same-run multiple blocks" case (P2).
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
              // Another tool in this same agent run was already blocked and is awaiting
              // confirmation. The new block has been merged into the existing pending —
              // don't emit a second confirmation prompt; silently block and let the user
              // confirm once for the whole batch.
              log.info(`[lynx-guardian] P2: additional block merged into existing pending (${toolName})`);
              return {
                block: true,
                blockReason: `[Lynx Guardian] 🛡️ 已有待确认操作，本次操作（${toolName}）将在确认后一并放行。`,
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

    // Skill Guard: detect and assess Skill installation attempts
    if (skillGuardConfig.enabled !== false && skillGuardConfig.blockMalicious !== false) {
      try {
        const installAttempt = detectSkillInstall(toolName, params);
        if (installAttempt) {
          log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 Skill install detected: ${JSON.stringify(installAttempt)}`);
          log.info(`[lynx-guardian] Skill install detected: ${installAttempt.skillName} via ${installAttempt.installMethod}`);

          // Quick local blacklist check (synchronous, fast)
          const quick = quickBlacklistCheck(installAttempt.skillName);
          if (quick.blocked) {
            log.warn(`[lynx-guardian] 🛡️ Malicious Skill blocked: ${installAttempt.skillName} — ${quick.reason}`);
            try {
              await pushRecord(userId, `[SkillGuard] blocked: ${installAttempt.skillName} (${quick.reason})`, 3);
            } catch {
              /* best-effort */
            }
            return {
              block: true,
              blockReason: `[Lynx Guardian] 🛡️ 恶意Skill拦截: "${installAttempt.skillName}" — ${quick.reason}`,
            };
          }

          // Full async assessment (blacklist + content + integrity)
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
          log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 Skill assess risk detected: ${JSON.stringify(assessment)}`);
          if (assessment.block) {
            log.warn(`[lynx-guardian] ${assessment.message}`);
            try {
              await pushRecord(userId, `[SkillGuard] ${assessment.level}: ${installAttempt.skillName}`, 3);
            } catch {
              /* best-effort */
            }

            // Auto-quarantine if the Skill already exists on disk
            if (skillGuardConfig.autoQuarantine && installAttempt.skillPath) {
              try {
                const { existsSync: existsOnDisk } = await import("fs");
                if (existsOnDisk(installAttempt.skillPath)) {
                  quarantineSkill(installAttempt.skillPath, assessment.reasons.join("; "));
                  log.warn(`[lynx-guardian] Auto-quarantined: ${installAttempt.skillName}`);
                }
              } catch {
                /* best-effort */
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
              /* best-effort */
            }
          }
        }
      } catch (err: any) {
        log.error(`[lynx-guardian] Skill guard check error: ${err.message}`);
      }
    }

    // Local Blacklist Check
    let match = null;
    if (toolName === "exec") {
      const command = (params?.command ?? "") as string;
      match = checkExecBlacklist(typeof command === "string" ? command : "");
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
    const contentToReport = toolName === "exec" ? `执行 ${detail} 命令` : `${toolName} ${detail}`;

    try {
      const riskLevel = match.level === "critical" ? 3 : 2;
      await pushRecord(userId, contentToReport, riskLevel);
    } catch (err: any) {
      log.error(`[lynx-guardian] Failed to push blacklist record: ${err.message}`);
    }

    // Call Tool Check API
    try {
      const userContext = readRecentContext(ctx.sessionKey);
      log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 User context: ${userContext}`);
      const content = `是否${match.reason} ${detail}？用户：${userContext}`;

      const res = await checkTool(userId, content);
      log.info(`[lynx-guardian]特别打印仅在开发阶段进行使用 Tool check result: ${JSON.stringify(res)}`);
      const riskLevel = res.result.risk_level;

      log.info(`[lynx-guardian] Tool check result: risk=${riskLevel}`);

      if (riskLevel >= 2 && !approvedToolOverride) {
        const apiAssessment = buildApiRiskAssessment(
          riskLevel,
          `API tool risk: ${match.reason}${res.result.content ? ` (${res.result.content})` : ""}`,
        );
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
            matchedModules: apiAssessment.modules,
            sourceKeys: resolveOverrideKeys(ctx),
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
          blockReason: `[Lynx Guardian] 高危操作被拦截 (Risk Level ${riskLevel}): ${match.reason}`,
        };
      } else if (riskLevel === 2 && !approvedToolOverride) {
        return {
          block: true,
          blockReason: `[Lynx Guardian] 中危操作需确认: ${match.reason}. 请明确回复"确认"或"同意"后重试。`,
        };
      } else if (riskLevel >= 2) {
        log.info(`[lynx-guardian] One-time override consumed for tool risk: ${toolName}`);
        return;
      } else if (riskLevel === 1) {
        log.info(`[lynx-guardian] 识别到内容风险: ${res.result.content}`);
        return;
      } else {
        return;
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] Tool check failed: ${err.message}`);
      // P0-4: Only fail-closed for critical matches; fail-open for warnings
      if (match.level === "critical") {
        return {
          block: true,
          blockReason: `[Lynx Guardian] 安全检测失败(高危操作): ${err.message}`,
        };
      }
      // Warning-level: fail-open when API is unreachable
      log.warn(`[lynx-guardian] API unreachable, allowing warning-level operation: ${match.reason}`);
      return;
    }
  });
}
