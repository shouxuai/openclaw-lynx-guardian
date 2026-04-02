/**
 * Token Optimizer Runner
 *
 * TypeScript bridge to run the Python token optimization scripts from
 * the SX-openclaw-token-optimizer skill. Provides programmatic access to:
 * - Context optimization (lazy loading recommendations)
 * - Smart model routing (task → model tier)
 * - Heartbeat optimization (interval planning)
 * - Token budget tracking (cost monitoring)
 *
 * All scripts are local-only — no network requests, no subprocess spawning.
 */

import { execFile, execFileSync } from "child_process";
import { existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Result Types ─────────────────────────────────────────────────────

export interface ContextRecommendation {
  complexity: "simple" | "medium" | "complex";
  context_level: "minimal" | "standard" | "full";
  reasoning: string;
  recommended_files: string[];
  file_count: number;
  savings_percent: number | null;
  skip_patterns: string[];
}

export interface ModelRouting {
  provider: string;
  current_model: string;
  recommended_model: string;
  tier: "cheap" | "balanced" | "smart" | "premium";
  tier_display: string;
  confidence: number;
  reasoning: string;
  cost_savings_percent: number;
  should_switch: boolean;
  all_providers: Record<string, string>;
}

export interface HeartbeatPlan {
  planned: Array<{ type: string; reason: string }>;
  skipped: Array<{ type: string; reason: string; next_check: string | null }>;
  should_run: boolean;
  can_skip: boolean;
  cache_ttl_tip: string;
}

export interface BudgetStatus {
  date: string;
  cost: number;
  tokens: number;
  limit: number;
  percent_used: number;
  status: "ok" | "warning" | "exceeded";
  alert?: string;
}

export interface UsageStats {
  total_accesses: number;
  unique_files: number;
  frequent: Array<{ file: string; count: number }>;
  occasional: Array<{ file: string; count: number }>;
  rare: Array<{ file: string; count: number }>;
  recommendation: string;
}

// ── Script Discovery ─────────────────────────────────────────────────

function findTokenOptimizerScriptsDir(): string | null {
  const candidates = [
    join(__dirname, "skills", "lynx-guardian-lesson", "SX-openclaw-token-optimizer", "scripts"),
    join(__dirname, "..", "skills", "lynx-guardian-lesson", "SX-openclaw-token-optimizer", "scripts"),
    join(__dirname, "..", "..", "skills", "lynx-guardian-lesson", "SX-openclaw-token-optimizer", "scripts"),
    join(homedir(), ".openclaw", "skills", "lynx-guardian-lesson", "SX-openclaw-token-optimizer", "scripts"),
  ];

  for (const dir of candidates) {
    const resolved = resolve(dir);
    if (existsSync(resolved)) return resolved;
  }
  return null;
}

function findPython(): string {
  const candidates = ["python3", "python"];
  for (const cmd of candidates) {
    try {
      execFileSync("which", [cmd], { stdio: "ignore" });
      return cmd;
    } catch {
      continue;
    }
  }
  return "python3";
}

// ── Generic Script Runner ────────────────────────────────────────────

function runScript<T>(
  scriptName: string,
  args: string[],
  timeoutMs: number = 30000,
): Promise<T | null> {
  return new Promise((done) => {
    const scriptsDir = findTokenOptimizerScriptsDir();
    if (!scriptsDir) {
      done(null);
      return;
    }

    const scriptPath = join(scriptsDir, scriptName);
    if (!existsSync(scriptPath)) {
      done(null);
      return;
    }

    const python = findPython();
    execFile(python, [scriptPath, ...args], {
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout) => {
      if (error && !stdout) {
        done(null);
        return;
      }
      try {
        const result = JSON.parse(stdout) as T;
        done(result);
      } catch {
        done(null);
      }
    });
  });
}

// ── Public API: Context Optimizer ────────────────────────────────────

/**
 * Get context loading recommendations for a prompt.
 * Returns which files to load and expected savings.
 */
export function recommendContext(
  prompt: string,
  currentFiles?: string[],
): Promise<ContextRecommendation | null> {
  const args = ["recommend", prompt];
  if (currentFiles && currentFiles.length > 0) {
    args.push(...currentFiles);
  }
  return runScript<ContextRecommendation>("context_optimizer.py", args);
}

/**
 * Record that a file was accessed (for usage tracking).
 */
export function recordFileAccess(filePath: string): Promise<null> {
  return runScript("context_optimizer.py", ["record", filePath]);
}

/**
 * Get file usage statistics.
 */
export function getUsageStats(): Promise<UsageStats | null> {
  return runScript<UsageStats>("context_optimizer.py", ["stats"]);
}

// ── Public API: Model Router ─────────────────────────────────────────

/**
 * Route a task to the appropriate model tier.
 * Returns routing decision with cost savings estimate.
 */
export function routeModel(
  prompt: string,
  currentModel?: string,
  forceTier?: string,
  provider?: string,
): Promise<ModelRouting | null> {
  const args = ["route", prompt];
  if (currentModel) args.push(currentModel);
  if (forceTier) args.push(`--tier=${forceTier}`);
  if (provider) args.push(`--provider=${provider}`);
  return runScript<ModelRouting>("model_router.py", args);
}

// ── Public API: Heartbeat Optimizer ──────────────────────────────────

/**
 * Plan which heartbeat checks should run.
 */
export function planHeartbeat(
  checks?: string[],
): Promise<HeartbeatPlan | null> {
  const args = ["plan"];
  if (checks && checks.length > 0) {
    args.push(...checks);
  }
  return runScript<HeartbeatPlan>("heartbeat_optimizer.py", args);
}

/**
 * Record that a heartbeat check was performed.
 */
export function recordHeartbeatCheck(checkType: string): Promise<null> {
  return runScript("heartbeat_optimizer.py", ["record", checkType]);
}

// ── Public API: Token Budget Tracker ─────────────────────────────────

/**
 * Check current daily token budget status.
 */
export function checkBudget(): Promise<BudgetStatus | null> {
  return runScript<BudgetStatus>("token_tracker.py", ["check"]);
}

// ── Formatting Helpers ───────────────────────────────────────────────

/**
 * Format context recommendation as a concise log string.
 */
export function formatContextRecommendation(rec: ContextRecommendation): string {
  const savings = rec.savings_percent !== null ? ` (${rec.savings_percent.toFixed(0)}% savings)` : "";
  return `Context: ${rec.context_level} (${rec.complexity}) → ${rec.file_count} files${savings} | ${rec.reasoning}`;
}

/**
 * Format model routing as a concise log string.
 */
export function formatModelRouting(routing: ModelRouting): string {
  const savings = routing.cost_savings_percent > 0 ? ` (${routing.cost_savings_percent.toFixed(0)}% savings)` : "";
  const switchNote = routing.should_switch ? ` → switch to ${routing.recommended_model}` : " → keep current";
  return `Model: ${routing.tier_display}${switchNote}${savings} | ${routing.reasoning}`;
}

/**
 * Format budget status as a concise log string.
 */
export function formatBudgetStatus(budget: BudgetStatus): string {
  return `Budget: $${budget.cost.toFixed(2)}/$${budget.limit.toFixed(2)} (${budget.percent_used.toFixed(0)}%) — ${budget.status}`;
}

/**
 * Build optimization hints for prepending to agent context.
 */
export function buildOptimizationHints(
  context?: ContextRecommendation | null,
  routing?: ModelRouting | null,
  budget?: BudgetStatus | null,
): string {
  const hints: string[] = [];

  if (context && context.context_level !== "full") {
    hints.push(
      `[Token Optimizer] Context: Load ${context.context_level} context only (${context.file_count} files). ` +
      `Recommended: ${context.recommended_files.join(", ")}. ` +
      (context.skip_patterns.length > 0
        ? `Skip: ${context.skip_patterns.join(", ")}.`
        : ""),
    );
  }

  if (routing && routing.should_switch) {
    hints.push(
      `[Token Optimizer] Model: Suggest ${routing.recommended_model} (${routing.tier_display}, ` +
      `${routing.cost_savings_percent.toFixed(0)}% cheaper). Reason: ${routing.reasoning}.`,
    );
  }

  if (budget && budget.status !== "ok") {
    hints.push(
      `[Token Optimizer] Budget: ${budget.alert ?? `${budget.percent_used.toFixed(0)}% of daily limit used`}`,
    );
  }

  return hints.join("\n");
}

/**
 * Check if token optimizer scripts are available.
 */
export function isTokenOptimizerAvailable(): boolean {
  return findTokenOptimizerScriptsDir() !== null;
}
