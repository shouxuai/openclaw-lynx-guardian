import { resolve, normalize } from "path";
import type { OpenClawPluginApi } from "./src/types.js";
import { ensureUserRegistered, readRecentContext, ensureResources, baseIpInfo, extractContentAfterDate } from "./src/utils.js";
import { registerUser, checkContent, checkTool, pushRecord, checkPublicAccess } from "./src/api.js";
import { checkExecBlacklist, checkPathBlacklist } from "./src/blacklist.js";
import { SensitiveDataBlocker } from "./src/sensitive.js";
import { guardInput, guardOutput, guardToolCall } from "./src/safety-guard.js";
import { runSecurityAudit, runMaliciousScriptScan, formatAuditSummary } from "./src/security-audit-runner.js";

function canonicalizePath(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    return "";
  }
  if (raw.startsWith("~/")) raw = raw.replace("~", process.env.HOME ?? "/root");
  return normalize(resolve(raw));
}

export default function setup(api: OpenClawPluginApi) {
  const log = api.logger;
  log.info("[lynx-guardian] Plugin loading...");
  const sensitiveDataBlocker = new SensitiveDataBlocker();
  const config = api.config ?? {};
  const selfSafetyGuardConfig = config.selfSafetyGuard ?? {};
  const securityAuditConfig = config.securityAudit ?? {};
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

  // ── Event: message_received ──────────────────────────────────────
  api.on("message_received", async (event, ctx) => {
    try {
      if (!event.content || event.content.length === 0) return;

      // Sensitive data check
      if (sensitiveDataBlocker.containsSensitiveData(event.content)) {
        log.warn(`[lynx-guardian] Sensitive data detected in message`);
        await pushRecord(userId, event.content, 1);
        return {
          block: true,
          blockReason: "Sensitive data detected"
        }
      }

      // Self-safety-guard: input guard (M1 prompt injection + M2 system prompt extraction)
      if (selfSafetyGuardConfig.inputGuard !== false) {
        const decision = guardInput(event.content, ctx.sessionKey);
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

      // Self-safety-guard: input guard on prompt
      if (selfSafetyGuardConfig.inputGuard !== false && event.prompt) {
        const promptText = typeof event.prompt === "string" ? event.prompt : JSON.stringify(event.prompt);
        const decision = guardInput(promptText, ctx.sessionKey);
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

      // Check input risk via API
      const input = extractContentAfterDate(event.prompt);
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
      if (!event.messages) return;
      const lastContent = event.messages[event.messages.length - 1].content;
      const lastMessage = lastContent[lastContent.length - 1];
      const output = lastMessage?.text ?? "";

      // Self-safety-guard: output guard (M2 system prompt leak detection)
      if (selfSafetyGuardConfig.outputGuard !== false && output) {
        const decision = guardOutput(output);
        if (decision.block) {
          log.warn(`[lynx-guardian] Self-safety-guard blocked output: ${decision.riskAssessment.description}`);
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
        const decision = guardToolCall(toolName, params, ctx.sessionKey);
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
      return {
        block: true,
        blockReason: `[Lynx Guardian] 安全检测失败: ${err.message}`
      };
    }
  });
}
