import { resolve, normalize } from "path";
import type { OpenClawPluginApi } from "./src/types.js";
import {
  ensureUserRegistered,
  readRecentContext,
  ensureResources,
  baseIpInfo,
  extractContentAfterDate,
  listLocalSubnetCidrs,
} from "./src/utils.js";
import { registerUser, checkContent, checkTool, pushRecord, checkPublicAccess, fetchMaliciousSkillBlacklist } from "./src/api.js";
import { checkExecBlacklist, checkPathBlacklist } from "./src/blacklist.js";
import { SensitiveDataBlocker } from "./src/sensitive.js";
import { guardInput, guardOutput, guardToolCall } from "./src/safety-guard.js";
import type { GuardContext } from "./src/safety-guard.js";
import { runSecurityAudit, runMaliciousScriptScan, formatAuditSummary } from "./src/security-audit-runner.js";
import { detectSkillInstall, assessSkillRisk, verifyAllInstalledSkills, quickBlacklistCheck } from "./src/skill-guard.js";
import { quarantineSkill } from "./src/skill-cleanup.js";
import type { MaliciousSkillEntry } from "./src/skill-blacklist-data.js";
import { discoverOpenClaw, formatDiscoverySummary } from "./src/openclaw-discovery.js";
import { loadDiscoveryRuntimeConfig } from "./src/discovery-runtime-config.js";
import {
  recommendContext, routeModel, checkBudget, planHeartbeat,
  formatContextRecommendation, formatModelRouting, formatBudgetStatus,
  buildOptimizationHints, isTokenOptimizerAvailable,
} from "./src/token-optimizer-runner.js";

function canonicalizePath(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    return "";
  }
  if (raw.startsWith("~/")) raw = raw.replace("~", process.env.HOME ?? "/root");
  return normalize(resolve(raw));
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => normalizeString(item)).filter(Boolean)
    : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function isManualDiscoveryRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  const exactCommands = [
    "/check",
    "/lynx-check",
    "/openclaw-check",
  ];
  if (exactCommands.some((command) => normalized === command || normalized.startsWith(`${command} `))) {
    return true;
  }

  const compact = normalized.replace(/\s+/g, "");
  const actionKeywords = ["检查", "检测", "扫描", "探测", "排查", "check", "scan"];
  const targetKeywords = ["openclaw", "龙虾"];
  const signalKeywords = ["服务", "进程", "网关", "ip", "端口", "地址"];

  return hasKeyword(compact, actionKeywords)
    && hasKeyword(compact, targetKeywords)
    && hasKeyword(compact, signalKeywords);
}

async function sendPluginMessage(ctx: any, content: string): Promise<void> {
  if (typeof ctx?.sendMessage !== "function") {
    return;
  }
  await ctx.sendMessage({
    role: "assistant",
    content,
  });
}

function formatManualDiscoveryReply(report: any): string {
  const confirmed = report.hits.filter((hit: any) => hit.score >= 80);
  const likely = report.hits.filter((hit: any) => hit.score >= 50 && hit.score < 80);

  const lines = [
    "OpenClaw 服务检测结果",
    `扫描目标数: ${report.scannedTargets}`,
    `展开主机数: ${report.expandedHosts}`,
    `检测耗时: ${(report.elapsedMs / 1000).toFixed(1)}s`,
    `已确认: ${confirmed.length} 个`,
    `高度疑似: ${likely.length} 个`,
  ];

  if (confirmed.length > 0) {
    lines.push("已确认实例:");
    for (const hit of confirmed.slice(0, 10)) {
      lines.push(`- ${hit.host}:${hit.port} (${hit.scheme || "http"}, ${hit.score}分)`);
    }
  }

  if (likely.length > 0) {
    lines.push("高度疑似实例:");
    for (const hit of likely.slice(0, 10)) {
      lines.push(`- ${hit.host}:${hit.port} (${hit.scheme || "http"}, ${hit.score}分)`);
    }
  }

  if (confirmed.length === 0 && likely.length === 0) {
    lines.push("未发现高置信度或高度疑似的 OpenClaw 服务。");
  }

  if (Array.isArray(report.warnings) && report.warnings.length > 0) {
    lines.push(`提示: ${report.warnings[0]}`);
  }

  return lines.join("\n");
}

async function runDiscoveryAndNotify(
  log: any,
  ctx: any,
  discoveryConfig: any,
  discoveryRuntimePath: string,
): Promise<boolean> {
  try {
    const targets = await resolveDiscoveryTargets(discoveryConfig);
    if (targets.length === 0) {
      await sendPluginMessage(ctx, "OpenClaw 服务检测已跳过：未能解析到可检测的目标。");
      return true;
    }

    const scanMode = discoveryConfig.fullScan === true ? "全端口扫描" : "候选端口扫描";
    await sendPluginMessage(
      ctx,
      `OpenClaw 服务检测已立即启动，模式: ${scanMode}\n配置文件: ${discoveryRuntimePath}\n目标: ${targets.join(", ")}`,
    );

    log.info(
      `[lynx-guardian] 手动触发 OpenClaw 服务检测（不受后台锁限制，立即执行），模式: ${scanMode}，配置文件: ${discoveryRuntimePath}，目标: ${targets.join(", ")}`,
    );

    const report = await discoverOpenClaw({
      ...discoveryConfig,
      enabled: true,
      targets,
    });

    log.info(`[lynx-guardian] ${formatDiscoverySummary(report)}`);
    await sendPluginMessage(ctx, formatManualDiscoveryReply(report));
    return true;
  } catch (err: any) {
    log.error(`[lynx-guardian] 手动 OpenClaw 服务检测失败: ${err.message}`);
    await sendPluginMessage(ctx, `OpenClaw 服务检测失败: ${err.message}`);
    return true;
  }
}

async function resolveDiscoveryTargets(config: any): Promise<string[]> {
  const configuredTargets = normalizeStringList(config?.targets);
  if (configuredTargets.length > 0) {
    return [...new Set(configuredTargets)];
  }

  const discoveredTargets = new Set<string>();
  const ipInfo = await baseIpInfo();
  const port = typeof ipInfo?.port === "number" ? ipInfo.port : 18789;

  discoveredTargets.add(`127.0.0.1:${port}`);
  discoveredTargets.add(`localhost:${port}`);

  if (typeof ipInfo?.ip === "string" && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ipInfo.ip)) {
    discoveredTargets.add(`${ipInfo.ip}:${port}`);
  }

  const subnetTargets = listLocalSubnetCidrs();
  if (subnetTargets.length > 0) {
    for (const target of subnetTargets) {
      discoveredTargets.add(target);
    }
  }

  return [...discoveredTargets];
}

function buildGuardContext(config: any, event: any, ctx: any): GuardContext {
  const ownerVerification = config?.selfSafetyGuard?.ownerVerification ?? {};
  const requesterId = normalizeString(
    event?.sender?.id
    ?? event?.userId
    ?? ctx?.userId
    ?? ctx?.senderId,
  );
  const channel = normalizeString(
    event?.channel
    ?? event?.source
    ?? ctx?.channel
    ?? ctx?.source,
  );

  const trustedUserIds = new Set(
    normalizeStringList(ownerVerification.trustedUserIds).map((item) => item.toLowerCase()),
  );
  const trustedChannels = new Set(
    normalizeStringList(ownerVerification.trustedChannels).map((item) => item.toLowerCase()),
  );

  const verifiedOwner = ownerVerification.enabled === false
    ? false
    : event?.verifiedOwner === true
      || ctx?.verifiedOwner === true
      || (requesterId.length > 0 && trustedUserIds.has(requesterId.toLowerCase()))
      || (channel.length > 0 && trustedChannels.has(channel.toLowerCase()));

  return {
    verifiedOwner,
    requesterId,
    channel,
  };
}

function redactAgentOutput(event: any, replacement: string): void {
  if (!event) return;
  if (typeof event.output === "string") {
    event.output = replacement;
  }

  if (!Array.isArray(event.messages) || event.messages.length === 0) return;
  const lastMessage = event.messages[event.messages.length - 1];
  if (!lastMessage) return;

  if (typeof lastMessage.content === "string") {
    lastMessage.content = replacement;
    return;
  }

  if (Array.isArray(lastMessage.content) && lastMessage.content.length > 0) {
    const lastBlock = lastMessage.content[lastMessage.content.length - 1];
    if (lastBlock && typeof lastBlock === "object") {
      lastBlock.text = replacement;
    }
  }
}

export default function setup(api: OpenClawPluginApi) {
  const log = api.logger;
  log.info("[lynx-guardian] Plugin loading...");
  const sensitiveDataBlocker = new SensitiveDataBlocker();
  const config = api.config ?? {};
  const selfSafetyGuardConfig = config.selfSafetyGuard ?? {};
  const securityAuditConfig = config.securityAudit ?? {};
  const skillGuardConfig = config.skillGuard ?? {};
  const tokenOptimizerConfig = config.tokenOptimizer ?? {};
  const discoveryRuntime = loadDiscoveryRuntimeConfig();
  const openClawDiscoveryConfig = discoveryRuntime.config ?? {};
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

  if (discoveryRuntime.created) {
    log.info(
      `[lynx-guardian] 已生成 OpenClaw 服务检测配置文件: ${discoveryRuntime.path}，当前 fullScan=${openClawDiscoveryConfig.fullScan === true ? "true" : "false"}`,
    );
  }
  for (const warning of discoveryRuntime.warnings) {
    log.warn(`[lynx-guardian] ${warning}`);
  }
  if (!discoveryRuntime.created) {
    log.info(
      `[lynx-guardian] OpenClaw 服务检测配置已加载: ${discoveryRuntime.path}，当前 fullScan=${openClawDiscoveryConfig.fullScan === true ? "true" : "false"}`,
    );
  }

  // ── Startup Security Audit (SX-security-audit) ───────────────────
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

  // ── Optional OpenClaw Discovery ─────────────────────────────────
  if (config.enabled !== false && openClawDiscoveryConfig.enabled !== false && openClawDiscoveryConfig.runOnStartup !== false) {
    (async () => {
      try {
        const targets = await resolveDiscoveryTargets(openClawDiscoveryConfig);
        if (targets.length === 0) {
          log.info("[lynx-guardian] OpenClaw 服务检测已跳过：未能解析到可检测的目标。");
          return;
        }

        const startupDelayMs = 3000;
        log.info(`[lynx-guardian] OpenClaw 服务检测已排队，将在 ${startupDelayMs / 1000} 秒后后台启动，优先让网关完成启动。`);
        await sleep(startupDelayMs);

        const scanMode = openClawDiscoveryConfig.fullScan === true ? "全端口扫描" : "候选端口扫描";
        log.info(
          `[lynx-guardian] OpenClaw 服务检测已启动，模式: ${scanMode}，配置文件: ${discoveryRuntime.path}，目标: ${targets.join(", ")}`,
        );
        const report = await discoverOpenClaw({
          ...openClawDiscoveryConfig,
          enabled: true,
          targets,
        });
        log.info(`[lynx-guardian] ${formatDiscoverySummary(report)}`);

        const confirmed = report.hits.filter((hit) => hit.score >= 80);
        const likely = report.hits.filter((hit) => hit.score >= 50 && hit.score < 80);
        if (confirmed.length > 0 || likely.length > 0) {
          log.warn(
            `[lynx-guardian] OpenClaw 服务检测告警：已确认 ${confirmed.length} 个，高度疑似 ${likely.length} 个。请查看上方日志中的 IP 和端口明细。`,
          );
        } else {
          log.info("[lynx-guardian] OpenClaw 服务检测结果：未发现高置信度或高度疑似实例。");
        }
      } catch (err: any) {
        log.error(`[lynx-guardian] OpenClaw 服务检测失败: ${err.message}`);
      }
    })();
  }

  // ── Event: message_received ──────────────────────────────────────
  api.on("message_received", async (event, ctx) => {
    try {
      if (!event.content || event.content.length === 0) return;

      // P0-1: Normalize content - may be string or Array<{type, text}>
      const text = typeof event.content === 'string'
        ? event.content
        : Array.isArray(event.content)
          ? event.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
          : String(event.content);

      if (!text || text.length === 0) return;

      if (isManualDiscoveryRequest(text)) {
        const handled = await runDiscoveryAndNotify(log, ctx, openClawDiscoveryConfig, discoveryRuntime.path);
        if (handled) {
          return {
            block: true,
            blockReason: "[Lynx Guardian] 已执行 OpenClaw 服务检测请求。",
          };
        }
      }

      // Sensitive data check
      if (sensitiveDataBlocker.containsSensitiveData(text)) {
        log.warn(`[lynx-guardian] Sensitive data detected in message`);
        await pushRecord(userId, text, 1);
        return {
          block: true,
          blockReason: "Sensitive data detected"
        }
      }

      // Self-safety-guard: input guard (M1 prompt injection + M2 system prompt extraction)
      if (selfSafetyGuardConfig.inputGuard !== false) {
        const guardContext = buildGuardContext(config, event, ctx);
        const decision = guardInput(text, ctx.sessionKey, guardContext);
        if (decision.block) {
          log.warn(`[lynx-guardian] Self-safety-guard blocked message: ${decision.riskAssessment.description} (${decision.riskAssessment.level}, score=${decision.riskAssessment.score})`);
          try {
            await pushRecord(userId, `[SSG] ${decision.riskAssessment.modules.join(",")}`, decision.riskAssessment.score >= 7 ? 3 : 2);
          } catch { /* best-effort */ }
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

      // Public access check
      const ipInfo = await baseIpInfo();
      if (ipInfo.type == "next_check") {
        const res = await checkPublicAccess(userId, ipInfo.ip, ipInfo.port);
        if (res.result.is_public) {
          log.error(`[lynx-guardian] Public access check failed`);
          const warning = `⚠️重要提醒：当前IP ${ipInfo.ip} 暴露在公网环境，强烈建议配置防火墙规则，仅允许必要端口暴露。\n`;
          prependContext += warning;
        } else {
          log.info(`[lynx-guardian] Public access check passed`);
        }
      }

      log.info(`[lynx-guardian] Input messages: ${JSON.stringify(event.prompt)}`);

      // Normalize prompt text for both SSG guard and API check
      const promptText = typeof event.prompt === "string" ? event.prompt : JSON.stringify(event.prompt ?? "");

      // Self-safety-guard: input guard on prompt
      if (selfSafetyGuardConfig.inputGuard !== false && event.prompt) {
        const guardContext = buildGuardContext(config, event, ctx);
        const decision = guardInput(promptText, ctx.sessionKey, guardContext);
        if (decision.block) {
          log.warn(`[lynx-guardian] Self-safety-guard blocked agent start: ${decision.riskAssessment.description}`);
          try {
            await pushRecord(userId, `[SSG:agent_start] ${decision.riskAssessment.modules.join(",")}`, decision.riskAssessment.score >= 7 ? 3 : 2);
          } catch { /* best-effort */ }
          return {
            block: true,
            blockReason: decision.blockReason!,
          } as any;
        }
        if (decision.warning) {
          prependContext += decision.warning + "\n";
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
            prependContext += hints + "\n";
          }
        } catch (err: any) {
          log.error(`[lynx-guardian] Token optimizer failed: ${err.message}`);
        }
      }

      // Check input risk via API
      const input = extractContentAfterDate(promptText);
      const res = await checkContent(userId, input, 1);
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
        if (res.result.risk_level >= 3) {
          return {
            block: true,
            blockReason: `[Lynx Guardian] ${warning}`,
          } as any;
        }
        prependContext += warning;
      }

      return {
        prependContext
      } as any;
    } catch (err: any) {
      log.error(`[lynx-guardian] Input check failed: ${err.message}`);
    }
  });

  // ── Event: agent_end ─────────────────────────────────────────────
  api.on("agent_end", async (event, ctx) => {
    try {
      log.info(JSON.stringify(ctx));
      if (!event.messages || event.messages.length === 0) return;

      // P0-2: Defensive property chain access
      const lastMsg = event.messages[event.messages.length - 1];
      if (!lastMsg?.content) return;
      const lastContent = Array.isArray(lastMsg.content) ? lastMsg.content : [{ text: typeof lastMsg.content === 'string' ? lastMsg.content : '' }];
      if (lastContent.length === 0) return;
      const lastMessage = lastContent[lastContent.length - 1];
      const output = lastMessage?.text ?? "";

      // Self-safety-guard: output guard (M2 system prompt leak detection)
      if (selfSafetyGuardConfig.outputGuard !== false && output) {
        const decision = guardOutput(output);
        if (decision.block) {
          log.warn(`[lynx-guardian] Self-safety-guard blocked output: ${decision.riskAssessment.description}`);
          // Best effort: redact mutable event payloads when the host exposes them by reference.
          redactAgentOutput(event, "[Lynx Guardian] 输出已被安全防护替换：检测到受保护配置泄露风险。");
          try {
            await pushRecord(userId, `[SSG:output] ${decision.riskAssessment.modules.join(",")}`, 2);
          } catch { /* best-effort */ }
        }
        if (decision.warning) {
          log.warn(`[lynx-guardian] Self-safety-guard output warning: ${decision.warning}`);
        }
      }

      // API-based content check
      const res = await checkContent(userId, output, 2);
      if (res.result.risk_level > 0) {
        let warning = `⚠️重要提醒：内容包含内容风险（${res.result.level_one}、${res.result.level_two}、${res.result.level_three}）`;
        if (warning.includes("个人隐私")) {
          warning += "隐私内容需要进行脱敏处理，请勿在非必要场景随意提供。";
        } else {
          warning += "lynx-guardian 插件已进行拦截。";
        }
        log.warn(`[lynx-guardian] Output risk detected: ${warning}`);
      }
    } catch (err: any) {
      log.error(`[lynx-guardian] Output check failed: ${err.message}`);
    }
  });

  // ── Event: before_tool_call ──────────────────────────────────────
  api.on("before_tool_call", async (event, ctx) => {
    const { toolName, params } = event;

    // Self-safety-guard: tool call guard (M3 over-agency, M5 credential theft, fatal triangle)
    if (selfSafetyGuardConfig.toolGuard !== false) {
      try {
        const guardContext = buildGuardContext(config, event, ctx);
        const decision = guardToolCall(toolName, params, ctx.sessionKey, guardContext);
        if (decision.block) {
          log.warn(`[lynx-guardian] Self-safety-guard blocked tool: ${decision.riskAssessment.description}`);
          try {
            await pushRecord(userId, `[SSG:tool] ${toolName} ${decision.riskAssessment.modules.join(",")}`, decision.riskAssessment.score >= 7 ? 3 : 2);
          } catch { /* best-effort */ }
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
          log.info(`[lynx-guardian] Skill install detected: ${installAttempt.skillName} via ${installAttempt.installMethod}`);

          // Quick local blacklist check (synchronous, fast)
          const quick = quickBlacklistCheck(installAttempt.skillName);
          if (quick.blocked) {
            log.warn(`[lynx-guardian] 🛡️ Malicious Skill blocked: ${installAttempt.skillName} — ${quick.reason}`);
            try {
              await pushRecord(userId, `[SkillGuard] blocked: ${installAttempt.skillName} (${quick.reason})`, 3);
            } catch { /* best-effort */ }
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
            } catch { /* remote unavailable */ }
            return null;
          };

          const assessment = await assessSkillRisk(installAttempt, fetchRemote);

          if (assessment.block) {
            log.warn(`[lynx-guardian] ${assessment.message}`);
            try {
              await pushRecord(userId, `[SkillGuard] ${assessment.level}: ${installAttempt.skillName}`, 3);
            } catch { /* best-effort */ }

            // Auto-quarantine if the Skill already exists on disk
            if (skillGuardConfig.autoQuarantine && installAttempt.skillPath) {
              try {
                const { existsSync } = await import("fs");
                if (existsSync(installAttempt.skillPath)) {
                  quarantineSkill(installAttempt.skillPath, assessment.reasons.join("; "));
                  log.warn(`[lynx-guardian] Auto-quarantined: ${installAttempt.skillName}`);
                }
              } catch { /* best-effort */ }
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
            } catch { /* best-effort */ }
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
      log.info(`[lynx-guardian] User context: ${userContext}`);
      const content = `是否${match.reason} ${detail}？用户：${userContext}`;

      const res = await checkTool(userId, content);
      const riskLevel = res.result.risk_level;

      log.info(`[lynx-guardian] Tool check result: risk=${riskLevel}`);

      if (riskLevel >= 3) {
        return {
          block: true,
          blockReason: `[Lynx Guardian] 高危操作被拦截 (Risk Level ${riskLevel}): ${match.reason}`
        };
      } else if (riskLevel === 2) {
        return {
          block: true,
          blockReason: `[Lynx Guardian] 中危操作需确认: ${match.reason}. 请明确回复"确认"或"同意"后重试。`
        };
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
          blockReason: `[Lynx Guardian] 安全检测失败(高危操作): ${err.message}`
        };
      }
      // Warning-level: fail-open when API is unreachable
      log.warn(`[lynx-guardian] API unreachable, allowing warning-level operation: ${match.reason}`);
      return;
    }
  });
}
