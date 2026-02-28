/**
 * OpenClaw Guardian v2 — Blacklist + LLM Intent Verification
 *
 * Flow:
 *   tool call → only check exec/write/edit
 *     → blacklist match? no → pass (99%)
 *     → yes, critical → 3 LLM votes (all must confirm user intent)
 *     → yes, warning  → 1 LLM vote (confirm user intent)
 *     → LLM down → critical: block, warning: ask user
 */

import { readFileSync } from "node:fs";
import { join, dirname, resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

function canonicalizePath(raw: string): string {
  if (!raw) return raw;
  // Expand ~ to home dir
  if (raw.startsWith("~/")) raw = raw.replace("~", process.env.HOME ?? "/root");
  // Resolve to absolute + normalize (removes ../ etc)
  return normalize(resolve(raw));
}
import { initAuditLog, writeAuditEntry } from "./src/audit-log.js";
import { checkExecBlacklist, checkPathBlacklist } from "./src/blacklist.js";
import { initLlm, singleVote, multiVote } from "./src/llm-voter.js";

function loadEnabled(): boolean {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(dir, "default-policies.json"), "utf-8");
    return JSON.parse(raw).enabled !== false;
  } catch {
    return true; // default on if config missing
  }
}

export default function setup(api: OpenClawPluginApi): void {
  if (!loadEnabled()) {
    api.logger.info("[guardian] Disabled by policy");
    return;
  }

  initAuditLog();
  initLlm(api.config);
  const log = api.logger;
  log.info("[guardian] v2 active — blacklist + LLM intent verification");

  api.on("before_tool_call", async (event, ctx) => {
    const { toolName, params } = event;

    // Only check exec, write, edit — everything else passes instantly
    let match = null;

    if (toolName === "exec") {
      match = checkExecBlacklist((params?.command ?? "") as string);
    } else if (toolName === "write" || toolName === "edit") {
      const rawPath = (params?.file_path ?? params?.path ?? "") as string;
      const safePath = canonicalizePath(rawPath);
      match = checkPathBlacklist(safePath);
    }

    if (!match) return; // 99% of calls end here

    const detail =
      toolName === "exec"
        ? (params?.command ?? "").toString().slice(0, 120)
        : (params?.file_path ?? params?.path ?? "").toString().slice(0, 120);

    log.warn(
      `[guardian] ⚠️ Blacklist hit: ${match.level.toUpperCase()} | tool=${toolName} | ${detail} | rule=${match.reason}`,
    );

    // Blacklist hit — verify user intent via LLM
    const sessionKey = ctx?.sessionKey as string | undefined;

    if (match.level === "critical") {
      const result = await multiVote(toolName, params ?? {}, sessionKey, 3, 3);
      writeAuditEntry(toolName, params ?? {}, match, result.confirmed, result.reason);

      if (!result.confirmed) {
        log.error(
          `[guardian] 🛑 BLOCKED CRITICAL | tool=${toolName} | ${detail} | votes=${result.reason}`,
        );
        return {
          block: true,
          blockReason: `🛡️ Guardian: 危险操作被拦截 — ${match.reason}。${result.reason}`,
        };
      }
      log.info(`[guardian] ✅ CRITICAL passed (3/3 confirmed) | tool=${toolName} | ${detail}`);
      return;
    }

    // Warning level: 1 vote
    const result = await singleVote(toolName, params ?? {}, sessionKey);
    writeAuditEntry(toolName, params ?? {}, match, result.confirmed, result.reason);

    if (!result.confirmed) {
      log.warn(
        `[guardian] 🚫 BLOCKED WARNING | tool=${toolName} | ${detail} | reason=${result.reason}`,
      );
      return {
        block: true,
        blockReason: `🛡️ Guardian: 此操作需要用户确认 — ${match.reason}。请先询问用户是否要执行此操作。`,
      };
    }
    log.info(`[guardian] ✅ WARNING passed (user confirmed) | tool=${toolName} | ${detail}`);
    return;
  });
}
