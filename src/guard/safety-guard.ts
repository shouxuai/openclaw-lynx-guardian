/**
 * AI Self-Safety Guard - Core Orchestrator
 *
 * Implements the 5-level risk assessment framework (L0-L4) with
 * weighted + folding multi-module scoring and an instant-danger channel.
 * Orchestrates all defense modules (M0-M7) from the self-safety-guard skill.
 */

import { detectPromptInjection, detectSystemPromptExtraction } from "./prompt-injection.js";
import { detectSystemPromptLeak } from "./system-prompt-guard.js";
import { detectChineseEvasiveIntent } from "./evasive-intent-cn.js";
import { SensitiveDataBlocker } from "./sensitive.js";
import {
  buildInputEvidenceBundle,
  buildOutputEvidenceBundle,
  buildToolEvidenceBundle,
} from "./policy/evidence-bundle-builder.js";
import type { GuardEvidenceBundle } from "./policy/evidence-bundle.js";
import { advanceAttackGraph, type AttackGraphEvent, type AttackGraphState } from "./policy/attack-graph.js";
import {
  advanceAttackGraphState,
  clearGuardPolicyState,
  markGuardArtifactTaint,
  readAttackGraphState,
  readGuardArtifactTaint,
} from "../runtime/guard-policy-state.js";
import {
  findObfuscatedLynxPluginPath,
  findObfuscatedProtectedReferenceLabels,
  findObfuscatedSystemAuthPath,
} from "../path-glob-protection.js";

// ── Risk Levels ────────────────────────────────────────────────────

export type RiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export interface RiskAssessment {
  level: RiskLevel;
  score: number;         // 0-10
  modules: string[];     // which modules triggered
  description: string;
  action: "allow" | "log" | "warn" | "block" | "deny";
}

export interface GuardDecision {
  block: boolean;
  blockReason?: string;
  warning?: string;
  riskAssessment: RiskAssessment;
  evidenceBundle?: GuardEvidenceBundle;
  overrideHint?: {
    allowed: boolean;
    confirmationPhrase?: string;
    reason?: string;
  };
  contextHints?: {
    masqueradeTaintLevel?: ExecMasqueradeLevel;
  };
}

export interface GuardContext {
  verifiedOwner?: boolean;
  requesterId?: string;
  channel?: string;
  trustedInternalProtectedRead?: boolean;
  trustedManagedLynxCheckToolCall?: boolean;
  trustedManagedLynxCheckOutput?: boolean;
  trustedManagedLynxCheckPersistence?: boolean;
}

interface IdentityDetectionResult {
  detected: boolean;
  matchedPatterns: string[];
  directOwnerClaim: boolean;
  relationClaim: boolean;
}

interface ProtectedFileAccessResult {
  matchedFiles: string[];
  operation: "read" | "write" | "unknown";
}

type ExecMasqueradeLevel = "soft" | "hard";

interface ExecMasqueradeState {
  level: ExecMasqueradeLevel;
  expiresAt: number;
  reasons: string[];
}

// ── Weighted Scoring Infrastructure ───────────────────────────────

const DIM_CAP = 3;
const WEIGHTS = { harm: 3, rev: 2, auth: 2, pattern: 1, clarity: 1 } as const;
// max raw = DIM_CAP × sum(weights) = 3 × (3+2+2+1+1) = 27
const MAX_WEIGHTED_SCORE = DIM_CAP * (WEIGHTS.harm + WEIGHTS.rev + WEIGHTS.auth + WEIGHTS.pattern + WEIGHTS.clarity);

interface DimAccumulators {
  harm: number[];
  rev: number[];
  auth: number[];
  pattern: number[];
  clarity: number[];
}

function createAccumulators(): DimAccumulators {
  return { harm: [], rev: [], auth: [], pattern: [], clarity: [] };
}

// First module full value; each subsequent × 0.5; per-dimension cap = DIM_CAP
function foldDim(values: number[]): number {
  if (values.length === 0) return 0;
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result += values[i] * 0.5;
  }
  return Math.min(result, DIM_CAP);
}

function pushDim(accum: DimAccumulators, key: keyof DimAccumulators, value: number): void {
  accum[key].push(value);
}

function computeWeightedScore(accum: DimAccumulators): number {
  const raw = foldDim(accum.harm) * WEIGHTS.harm
    + foldDim(accum.rev) * WEIGHTS.rev
    + foldDim(accum.auth) * WEIGHTS.auth
    + foldDim(accum.pattern) * WEIGHTS.pattern
    + foldDim(accum.clarity) * WEIGHTS.clarity;
  return Math.round(raw / MAX_WEIGHTED_SCORE * 10);
}

function scoreToLevel(score: number): RiskLevel {
  if (score <= 0) return "L0";
  if (score <= 2) return "L1";
  if (score <= 5) return "L2";
  if (score <= 8) return "L3";
  return "L4";
}

function levelToAction(level: RiskLevel): "allow" | "log" | "warn" | "block" | "deny" {
  switch (level) {
    case "L0": return "allow";
    case "L1": return "log";
    case "L2": return "warn";
    case "L3": return "block";
    case "L4": return "deny";
  }
}

// Instant deny: bypass scoring, always L4
function buildInstantDeny(moduleId: string, reason: string): GuardDecision {
  return buildInstantDenyForModules([moduleId], reason);
}

function buildInstantDenyForModules(moduleIds: string[], reason: string): GuardDecision {
  const assessment: RiskAssessment = {
    level: "L4",
    score: 10,
    modules: moduleIds,
    action: "deny",
    description: reason,
  };
  return {
    block: true,
    blockReason: `[Lynx Guardian] 🛡️ 安全防护拦截 (L4, score=10): ${reason}`,
    riskAssessment: assessment,
  };
}

// Primary secrets — any match triggers instant channel
const PRIMARY_SECRETS = new Set([
  "env_file_read",
  "ssh_key_access",
  "aws_credentials",
  "gnupg_access",
  "credentials_read",
  "etc_passwd_read",
  "etc_shadow_read",
  "etc_sudoers_read",
]);

// ── Session Anomaly Tracker ────────────────────────────────────────

// Operation categories used for multi-step sequence detection
type OperationCategory =
  | "sensitive_dir_entry"   // cd /etc, cd ~/.ssh etc.
  | "file_access"           // M2:protected_file_access
  | "credential_access"     // M5:credential_theft
  | "obfuscated_path"       // M7:wildcard_obfuscation
  | "pipe_exec"             // M7:pipe_execution
  | "external_output"       // fatal_triangle (output side)
  | "normal";

interface SessionState {
  recentScores: number[];
  rejectedTopics: Map<string, number>;
  lastTopicCategory: string;
  lastActiveTime: number;
  operationHistory: OperationCategory[];  // last N operation categories for sequence detection
  evasiveIntentCnFamilies: string[][];
  execMasquerade?: ExecMasqueradeState;
}

const SESSION_MAX_SIZE = 1000;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const sessionStates = new Map<string, SessionState>();

function evictStaleSessions(): void {
  if (sessionStates.size <= SESSION_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, state] of sessionStates) {
    if (now - state.lastActiveTime > SESSION_TTL_MS) {
      sessionStates.delete(key);
    }
  }
  if (sessionStates.size > SESSION_MAX_SIZE) {
    const entries = [...sessionStates.entries()].sort((a, b) => a[1].lastActiveTime - b[1].lastActiveTime);
    const toRemove = entries.slice(0, entries.length - SESSION_MAX_SIZE);
    for (const [key] of toRemove) {
      sessionStates.delete(key);
    }
  }
}

function getSessionState(sessionKey: string): SessionState {
  let state = sessionStates.get(sessionKey);
  if (!state) {
    evictStaleSessions();
    state = {
      recentScores: [],
      rejectedTopics: new Map(),
      lastTopicCategory: "normal",
      lastActiveTime: Date.now(),
      operationHistory: [],
      evasiveIntentCnFamilies: [],
      execMasquerade: undefined,
    };
    sessionStates.set(sessionKey, state);
  } else {
    state.lastActiveTime = Date.now();
  }
  return state;
}

// Modules that represent legitimate owner operations — repeated blocks are
// workflow retries, NOT escalating attack attempts.
const REJECTION_TRACKING_EXEMPT = new Set([
  "M0:identity_verification",
  "M2:memory_session_privacy",
  "M2:plugin_integrity",
  "M2:protected_file_access",
  "M3:over_agency",
]);

// ── Multi-Step Sequence Detection ─────────────────────────────────

const OPERATION_HISTORY_MAX = 8;

// Infer the operation category from the set of triggered modules
function inferOperationCategory(modules: string[]): OperationCategory {
  if (modules.includes("M7:pipe_execution")) return "pipe_exec";
  if (modules.some((m) => m.includes("credential"))) return "credential_access";
  if (
    modules.includes("M2:memory_session_privacy")
    || modules.includes("M2:plugin_integrity")
    || modules.includes("M2:protected_file_access")
  ) return "file_access";
  if (modules.includes("M7:wildcard_obfuscation")) return "obfuscated_path";
  if (modules.includes("fatal_triangle")) return "external_output";
  if (modules.includes("sensitive_dir_entry")) return "sensitive_dir_entry";
  return "normal";
}

interface DangerSequence {
  name: string;
  // all of these categories must appear in the history window (order-insensitive)
  required: OperationCategory[];
  window: number;   // look back at most this many steps
  adjustment: number;
}

const DANGEROUS_SEQUENCES: DangerSequence[] = [
  {
    name: "data_exfiltration_chain",
    required: ["sensitive_dir_entry", "credential_access", "external_output"],
    window: 6,
    adjustment: 3,
  },
  {
    name: "recon_then_credential",
    required: ["sensitive_dir_entry", "credential_access"],
    window: 4,
    adjustment: 2,
  },
  {
    name: "pipe_after_file_access",
    required: ["file_access", "pipe_exec"],
    window: 3,
    adjustment: 2,
  },
  {
    name: "obfuscated_then_credential",
    required: ["obfuscated_path", "credential_access"],
    window: 3,
    adjustment: 2,
  },
];

// Returns total adjustment from sequence matches (capped at 3 to avoid double-stacking)
function checkSequencePatterns(history: OperationCategory[]): number {
  let total = 0;
  for (const seq of DANGEROUS_SEQUENCES) {
    const slice = history.slice(-seq.window);
    const sliceSet = new Set(slice);
    if (seq.required.every((cat) => sliceSet.has(cat))) {
      total += seq.adjustment;
    }
  }
  return Math.min(total, 3);
}

function computeAnomalyAdjustment(sessionKey: string, baseScore: number, triggeredModules: string[]): number {
  const state = getSessionState(sessionKey);
  let adjustment = 0;

  if (triggeredModules.length === 0) return 0;

  state.recentScores.push(baseScore);
  if (state.recentScores.length > 10) state.recentScores.shift();

  // Progressive attack: 3 consecutive rounds of increasing risk, total increase >= 4
  if (state.recentScores.length >= 3) {
    const last3 = state.recentScores.slice(-3);
    const isEscalating = last3[0] < last3[1] && last3[1] < last3[2];
    const totalIncrease = last3[2] - last3[0];
    if (isEscalating && totalIncrease >= 4) {
      adjustment += 2;
    }
  }

  // Multiple modules triggered simultaneously
  if (triggeredModules.length >= 2) {
    adjustment += 1;
  }

  // Repeated rejection bypass: same non-exempt topic rejected 3+ times
  for (const mod of triggeredModules) {
    if (REJECTION_TRACKING_EXEMPT.has(mod)) continue;
    const count = (state.rejectedTopics.get(mod) ?? 0) + 1;
    state.rejectedTopics.set(mod, count);
    if (count >= 3) {
      adjustment += 1;
    }
  }

  // Multi-step sequence detection: track operation category and check dangerous chains
  const category = inferOperationCategory(triggeredModules);
  if (category !== "normal") {
    state.operationHistory.push(category);
    if (state.operationHistory.length > OPERATION_HISTORY_MAX) {
      state.operationHistory.shift();
    }
    const seqAdj = checkSequencePatterns(state.operationHistory);
    if (seqAdj > 0) {
      adjustment += seqAdj;
    }
  }

  return adjustment;
}

const EVASIVE_CN_HISTORY_MAX = 4;

function computeChineseEvasiveConversationAdjustment(sessionKey: string, families: string[]): number {
  if (!sessionKey || families.length === 0) return 0;

  const state = getSessionState(sessionKey);
  const currentFamilies = [...new Set(families)];
  const history = state.evasiveIntentCnFamilies.slice(-EVASIVE_CN_HISTORY_MAX);
  const recent = history.slice(-3);
  const unionFamilies = new Set<string>(recent.flat());
  const has = (family: string): boolean => unionFamilies.has(family);

  let adjustment = 0;

  if (
    has("bypass_goal")
    && has("masquerade_method")
    && (has("wildcard_obfuscation") || has("dangerous_outcome"))
  ) {
    adjustment += 2;
  } else if (
    (has("bypass_goal") && has("masquerade_method"))
    || (has("bypass_goal") && has("detector_target"))
  ) {
    adjustment += 1;
  }

  const detectorFocusTurns = recent.filter((turn) => turn.includes("detector_target")).length;
  if (detectorFocusTurns >= 2) {
    adjustment += 1;
  }

  if (recent.length >= 2) {
    const firstBreadth = new Set(recent[0]).size;
    const lastBreadth = new Set(recent[recent.length - 1]).size;
    if (lastBreadth >= 3 && lastBreadth > firstBreadth) {
      adjustment += 1;
    }
  }

  state.evasiveIntentCnFamilies.push(currentFamilies);
  if (state.evasiveIntentCnFamilies.length > EVASIVE_CN_HISTORY_MAX) {
    state.evasiveIntentCnFamilies.shift();
  }

  return Math.min(adjustment, 2);
}

function isStandaloneWildcardLowSignal(
  result: ReturnType<typeof detectChineseEvasiveIntent>,
): boolean {
  if (!result.detected) return false;
  if (result.severity !== "low" || result.scoreDelta !== 1) return false;
  return result.matchedFamilies.length === 1
    && result.matchedFamilies[0] === "wildcard_obfuscation";
}

// ── Identity Verification (M0) ─────────────────────────────────────

const DIRECT_OWNER_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /(?:我是|我就是).{0,10}(?:这个(?:工作区|workspace)|这个系统|你的)?(?:的)?(?:主人|所有者|管理员|开发者|创建者)/i, label: "cn_owner_claim" },
  { pattern: /(?:请|要|按).{0,4}(?:主人|管理员).{0,4}(?:权限|身份).{0,4}(?:处理|执行)/i, label: "cn_owner_treatment_request" },
  { pattern: /\b(?:i am|i'm)\s+(?:the\s+)?(?:owner|administrator|admin|creator|developer|maintainer)\b.*(?:of\s+(?:this\s+workspace|this\s+system)|here|for\s+this\s+agent)/i, label: "en_owner_claim" },
  { pattern: /\b(?:treat|handle)\s+me\s+as\s+(?:the\s+)?(?:owner|admin(?:istrator)?)\b/i, label: "en_owner_treatment_request" },
];

const RELATION_CLAIM_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /(?:我是|我代表).{0,12}(?:主人|管理员|开发者).{0,8}(?:朋友|家人|同事|助理|代理人)/i, label: "cn_relation_claim" },
  { pattern: /\b(?:i am|i'm)\s+(?:the\s+)?(?:friend|family|coworker|assistant|agent)\s+of\s+(?:the\s+)?(?:owner|admin(?:istrator)?|creator|developer)\b/i, label: "en_relation_claim" },
];

function detectIdentityClaims(text: string): IdentityDetectionResult {
  const matched: string[] = [];
  let directOwnerClaim = false;
  let relationClaim = false;

  for (const { pattern, label } of DIRECT_OWNER_CLAIM_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(label);
      directOwnerClaim = true;
    }
  }

  for (const { pattern, label } of RELATION_CLAIM_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(label);
      relationClaim = true;
    }
  }

  return {
    detected: matched.length > 0,
    matchedPatterns: matched,
    directOwnerClaim,
    relationClaim,
  };
}

// ── Protected File Access (M2) ─────────────────────────────────────

const PROTECTED_FILE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bSOUL\.md\b/i, label: "SOUL.md" },
  { pattern: /\bIDENTITY\.md\b/i, label: "IDENTITY.md" },
  { pattern: /\bUSER\.md\b/i, label: "USER.md" },
  { pattern: /\bAGENTS\.md\b/i, label: "AGENTS.md" },
  { pattern: /\bTOOLS\.md\b/i, label: "TOOLS.md" },
  { pattern: /\bSHIELD\.md\b/i, label: "SHIELD.md" },
  { pattern: /\bMEMORY\.md\b/i, label: "MEMORY.md" },
  { pattern: /(?:^|[\\/])memory[\\/]/i, label: "memory/" },
  { pattern: /\bworkspace-state\.json\b/i, label: "workspace-state.json" },
  { pattern: /\bopenclaw\.plugin\.json\b/i, label: "openclaw.plugin.json" },
  { pattern: /\bopenclaw\.json\b/i, label: "openclaw.json" },
];

const LYNX_OWNED_SKILL_LABEL = "Lynx skill files";
const LYNX_SKILL_DIR_NAME_PATTERN = "(?:lynx-guardian-[^\\\\/\\s\"'`;)]*|openclaw-plugin-dev-workflow)";
const LYNX_OWNED_SKILL_PATH_PATTERNS: RegExp[] = [
  new RegExp(String.raw`(?:^|[\\/])\.openclaw[\\/]skills[\\/]${LYNX_SKILL_DIR_NAME_PATTERN}(?:[\\/]|$)`, "i"),
  new RegExp(String.raw`(?:^|[^A-Za-z0-9_])skills[\\/]${LYNX_SKILL_DIR_NAME_PATTERN}(?:[\\/]|$)`, "i"),
  /(?:^|[\\/])(?:app|\.openclaw)[\\/]extensions[\\/]openclaw-lynx-guardian[\\/]skills(?:[\\/]|$)/i,
];

const TOOL_STAGE_MIN_BLOCK_PROTECTED_FILE_LABELS = new Set([
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "AGENTS.md",
  "TOOLS.md",
  "SHIELD.md",
  LYNX_OWNED_SKILL_LABEL,
  "MEMORY.md",
]);

const PROTECTED_FILE_READ_PATTERNS: RegExp[] = [
  /\b(?:cat|less|more|head|tail|read|open|show|print|display|type|dump)\b/i,
  /(?:读取|查看|显示|打印|展示|列出|导出)/i,
];

const PROTECTED_FILE_WRITE_PATTERNS: RegExp[] = [
  /\b(?:write|edit|modify|update|append|overwrite|rewrite|rename|move|delete|remove|rm|mv|cp|tee)\b/i,
  /sed\s+-i/i,
  /\b(?:Remove-Item|Move-Item|Copy-Item|Rename-Item|Set-Content|Add-Content|Out-File|New-Item)\b/i,
  /\b(?:writeFileSync|appendFileSync|unlinkSync|rmSync|renameSync)\b/i,
  /\b(?:File\.(?:delete|unlink|write|rename)|FileUtils\.(?:rm_rf|mv)|remove_tree)\b/i,
  /\bopen\s*\([^)]*,\s*['"][^'"]*[wa+][^'"]*['"]\)/i,
  /(?:修改|编辑|更改|更新|追加|覆盖|重写|删除|重命名|移动)/i,
];

const IMMUTABLE_RUNTIME_CONFIG_LABELS = new Set([
  "openclaw.json",
  "openclaw.plugin.json",
]);

const LYNX_PLUGIN_ROOT_PATTERNS: RegExp[] = [
  /(?:^|[\\/])\.openclaw[\\/]extensions[\\/]openclaw-lynx-guardian(?:[\\/]|$)/i,
];

const LYNX_PLUGIN_CACHE_PATTERNS: RegExp[] = [
  /(?:^|[\\/])\.cache(?:[\\/]|$)/i,
  /(?:^|[\\/])tmp(?:[\\/]|$)/i,
  /(?:^|[\\/])temp(?:[\\/]|$)/i,
  /\.tmp$/i,
  /\.log$/i,
];

const MUTATING_TOOL_PATTERNS: RegExp[] = [
  /\b(?:write|edit|modify|update|append|overwrite|rewrite|rename|move|delete|remove|unlink|rm|mv|cp|copy|tee|touch)\b/i,
  /\b(?:Remove-Item|Move-Item|Copy-Item|Rename-Item|Set-Content|Add-Content|Out-File|New-Item)\b/i,
  /\b(?:writeFileSync|appendFileSync|unlinkSync|rmSync|renameSync)\b/i,
  /\b(?:os\.(?:remove|unlink|rename)|shutil\.(?:move|rmtree)|pathlib\.Path\s*\([^)]*\)\s*\.\s*write_(?:text|bytes))\b/i,
  /\b(?:File\.(?:delete|unlink|write|rename)|FileUtils\.(?:rm_rf|mv)|remove_tree)\b/i,
  /\bopen\s*\([^)]*,\s*['"][^'"]*[wa+][^'"]*['"]\)/i,
  /sed\s+-i/i,
  />>?/,
];

const OPENCLAW_RUNTIME_NAME = String.raw`(?:openc(?:law|alaw)|open\s*claw)`;

const OPENCLAW_MEMORY_SESSION_PATH_PATTERNS: RegExp[] = [
  /(?:^|[\\/])\.openclaw[\\/]memory(?:[\\/]|$)/i,
  /(?:^|[\\/])\.openclaw[\\/]agents[\\/][^\\/\s]+[\\/]sessions(?:[\\/]|$)/i,
  /(?:^|[\\/])\.openclaw[\\/]docker-state[\\/]agents[\\/][^\\/\s]+[\\/]sessions(?:[\\/]|$)/i,
];

const OPENCLAW_MEMORY_SESSION_TARGET_PATTERNS: RegExp[] = [
  new RegExp(`${OPENCLAW_RUNTIME_NAME}[^\\n\\r]{0,40}\\bmemory\\b`, "i"),
  new RegExp(`\\bmemory\\b[^\\n\\r]{0,40}${OPENCLAW_RUNTIME_NAME}`, "i"),
  new RegExp(`${OPENCLAW_RUNTIME_NAME}[^\\n\\r]{0,40}\\bsession(?:\\s+(?:records?|history|logs?))?\\b`, "i"),
  new RegExp(`${OPENCLAW_RUNTIME_NAME}[^\\n\\r]{0,40}\\bconversation(?:\\s+(?:records?|history|logs?))\\b`, "i"),
  new RegExp(`(?:${OPENCLAW_RUNTIME_NAME})[^\\n\\r]{0,20}(?:记忆|内存|会话记录|会话历史|聊天记录)`, "i"),
];

const OPENCLAW_MEMORY_SESSION_READ_PATTERNS: RegExp[] = [
  ...PROTECTED_FILE_READ_PATTERNS,
  /\b(?:ls|dir|find|grep|rg|list|export)\b/i,
  /\b(?:Get-Content|Get-ChildItem|Select-String)\b/i,
  /(?:列出|导出)/i,
];

const OPENCLAW_MEMORY_SESSION_MUTATION_PATTERNS: RegExp[] = [
  ...PROTECTED_FILE_WRITE_PATTERNS,
  /\b(?:clear|erase|wipe|purge|reset)\b/i,
  /(?:清空|擦除|抹掉|重置)/i,
];

const OPENCLAW_MEMORY_SESSION_TOOL_NAMES = new Set([
  "sessions_list",
  "sessions_history",
  "session_status",
  "memory_search",
  "memory_get",
]);

const OPENCLAW_MEMORY_SESSION_TRANSCRIPT_PATTERNS: RegExp[] = [
  /"message"\s*:\s*\{\s*"role"\s*:\s*"(?:system|user|assistant|tool)"/i,
  /"role"\s*:\s*"(?:system|user|assistant|tool)"[\s\S]{0,160}"content"\s*:/i,
];

function normalizeGuardPath(text: string): string {
  return text.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function hasOpenClawMemorySessionTarget(text: string): boolean {
  const normalized = normalizeGuardPath(text);
  return OPENCLAW_MEMORY_SESSION_PATH_PATTERNS.some((pattern) => pattern.test(normalized))
    || OPENCLAW_MEMORY_SESSION_TARGET_PATTERNS.some((pattern) => pattern.test(text));
}

function detectOpenClawMemorySessionRequest(text: string): boolean {
  if (!hasOpenClawMemorySessionTarget(text)) {
    return false;
  }

  return OPENCLAW_MEMORY_SESSION_READ_PATTERNS.some((pattern) => pattern.test(text))
    || OPENCLAW_MEMORY_SESSION_MUTATION_PATTERNS.some((pattern) => pattern.test(text));
}

function detectOpenClawMemorySessionArtifactAccess(text: string, toolName?: string): boolean {
  const normalizedToolName = (toolName ?? "").trim().toLowerCase();
  if (OPENCLAW_MEMORY_SESSION_TOOL_NAMES.has(normalizedToolName)) {
    return true;
  }

  const normalized = normalizeGuardPath(text);
  const targetsDetected = OPENCLAW_MEMORY_SESSION_PATH_PATTERNS.some((pattern) => pattern.test(normalized));

  if (!targetsDetected) {
    return false;
  }

  if (toolName === "read" || toolName === "write" || toolName === "edit") {
    return true;
  }

  return OPENCLAW_MEMORY_SESSION_READ_PATTERNS.some((pattern) => pattern.test(text))
    || OPENCLAW_MEMORY_SESSION_MUTATION_PATTERNS.some((pattern) => pattern.test(text));
}

function detectOpenClawMemorySessionLeak(text: string): boolean {
  const normalized = normalizeGuardPath(text);
  if (OPENCLAW_MEMORY_SESSION_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (/"scope"\s*:\s*"openclaw-memory"/i.test(text)) {
    return true;
  }

  const explicitRuntimeReference = OPENCLAW_MEMORY_SESSION_TARGET_PATTERNS.some((pattern) => pattern.test(text))
    || /\bopenclaw-memory\b/i.test(text);

  return explicitRuntimeReference
    && OPENCLAW_MEMORY_SESSION_TRANSCRIPT_PATTERNS.some((pattern) => pattern.test(text));
}

function extractPluginTargets(text: string): string[] {
  const matches = text.match(/(?:^|[^\w])\.openclaw\/extensions\/openclaw-lynx-guardian(?:\/[^\s"'`;)]+)*/ig);
  if (!matches) return [];
  return matches.map((match) => match.replace(/^[^./]+/, ""));
}

function detectPluginIntegrityViolation(text: string, toolName?: string): boolean {
  const normalized = normalizeGuardPath(text);
  const directPluginTarget = LYNX_PLUGIN_ROOT_PATTERNS.some((pattern) => pattern.test(normalized));
  const obfuscatedPluginTarget = findObfuscatedLynxPluginPath(normalized) !== null;

  if (!directPluginTarget && !obfuscatedPluginTarget) {
    return false;
  }

  if (obfuscatedPluginTarget) {
    if (toolName === "write" || toolName === "edit") {
      return true;
    }
    return MUTATING_TOOL_PATTERNS.some((pattern) => pattern.test(text));
  }

  const pluginTargets = extractPluginTargets(normalized);
  const nonCacheTargets = pluginTargets.filter(
    (target) => !LYNX_PLUGIN_CACHE_PATTERNS.some((pattern) => pattern.test(target)),
  );

  if (nonCacheTargets.length === 0) {
    return false;
  }

  if (toolName === "write" || toolName === "edit") {
    return true;
  }

  return MUTATING_TOOL_PATTERNS.some((pattern) => pattern.test(text));
}

function detectProtectedFileAccess(text: string, toolName?: string): ProtectedFileAccessResult {
  const matchedFiles: string[] = [];
  for (const { pattern, label } of PROTECTED_FILE_PATTERNS) {
    if (pattern.test(text)) {
      matchedFiles.push(label);
    }
  }

  const normalized = normalizeGuardPath(text);
  if (LYNX_OWNED_SKILL_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    matchedFiles.push(LYNX_OWNED_SKILL_LABEL);
  }

  matchedFiles.push(...findObfuscatedProtectedReferenceLabels(text));

  if (matchedFiles.length === 0) {
    return { matchedFiles: [], operation: "unknown" };
  }

  let operation: ProtectedFileAccessResult["operation"] = "unknown";
  if (toolName === "write" || toolName === "edit") {
    operation = "write";
  }
  if (PROTECTED_FILE_READ_PATTERNS.some((pattern) => pattern.test(text))) {
    operation = "read";
  }
  if (PROTECTED_FILE_WRITE_PATTERNS.some((pattern) => pattern.test(text))) {
    operation = "write";
  }

  return {
    matchedFiles: [...new Set(matchedFiles)],
    operation,
  };
}

// ── Credential Theft Detection (M5) ────────────────────────────────

function hasToolStageMinBlockProtectedFile(access: ProtectedFileAccessResult): boolean {
  return access.matchedFiles.some((label) => TOOL_STAGE_MIN_BLOCK_PROTECTED_FILE_LABELS.has(label));
}

function detectImmutableRuntimeConfigWrite(protectedAccess: ProtectedFileAccessResult): boolean {
  return protectedAccess.operation === "write"
    && protectedAccess.matchedFiles.some((label) => IMMUTABLE_RUNTIME_CONFIG_LABELS.has(label));
}

const DISABLE_LYNX_GUARDIAN_PATTERNS: RegExp[] = [
  /(?:禁用|停用|关闭|卸载|移除)[^\n\r]{0,40}(?:lynx[-\s]*guardian|lynx[-\s]*plugin|openclaw[-\s]*lynx[-\s]*guardian|lynx[-\s]*插件|guardian[-\s]*插件)/i,
  /\b(?:disable|deactivate|turn\s+off|uninstall|remove)\b[^\n\r]{0,60}\b(?:lynx[-\s]*guardian|lynx[-\s]*plugin|openclaw[-\s]*lynx[-\s]*guardian)\b/i,
  /\bopenclaw\b[^\n\r]{0,40}\b(?:extension|plugin)\b[^\n\r]{0,20}\bdisable\b[^\n\r]{0,60}\b(?:openclaw-lynx-guardian|lynx-guardian)\b/i,
];

function detectLynxGuardianDisableRequest(text: string): boolean {
  return DISABLE_LYNX_GUARDIAN_PATTERNS.some((pattern) => pattern.test(text));
}

const OPENCLAW_AVAILABILITY_CONTROL_PATTERNS: RegExp[] = [
  /(?:重启|关闭|停止|关停|停掉|杀掉)[^\n\r]{0,40}(?:openclaw(?:\s*gateway)?|openclaw\s*网关|openclaw\s*gateway)/i,
  /\b(?:restart|stop|shutdown|kill)\b[^\n\r]{0,40}\bopenclaw(?:\s+gateway)?\b/i,
  /\bopenclaw\b[^\n\r]{0,80}\b(?:gateway\b[^\n\r]{0,20})?(?:restart|stop|shutdown|kill|down)\b/i,
  /\bdocker(?:\s+compose)?\b[^\n\r]{0,120}\b(?:restart|stop|down|kill)\b[^\n\r]*(?:openclaw|openclaw-gateway)\b/i,
  /\b(?:Restart-Service|Stop-Service|taskkill|pkill|killall)\b[^\n\r]*(?:openclaw|openclaw-gateway)\b/i,
];

function detectOpenClawAvailabilityControl(text: string): boolean {
  return OPENCLAW_AVAILABILITY_CONTROL_PATTERNS.some((pattern) => pattern.test(text));
}

const CREDENTIAL_ACCESS_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /(?:cat|less|more|head|tail|read|open)\s+.*\.env\b/i, label: "env_file_read" },
  { pattern: /(?:cat|less|more|head|tail)\s+.*credentials/i, label: "credentials_read" },
  { pattern: /(?:cat|less|more|head|tail)\s+.*secrets?\./i, label: "secrets_read" },
  { pattern: /\.ssh\/(?:id_rsa|id_ed25519|authorized_keys)/i, label: "ssh_key_access" },
  { pattern: /\.aws\/credentials/i, label: "aws_credentials" },
  { pattern: /\.gnupg\//i, label: "gnupg_access" },
  { pattern: /keychain|credential[\s_-]?store|password[\s_-]?manager/i, label: "credential_store" },
  { pattern: /(?:search|find|grep|rg)\s+.*(?:password|secret|api[_-]?key|token)\b/i, label: "credential_search" },
  // System-level sensitive files (support both English commands and Chinese verbs)
  { pattern: /(?:cat|less|more|head|tail|read|open|type|查看|读取|显示|打印|展示|输出)\s+.*\/etc\/passwd\b/i, label: "etc_passwd_read" },
  { pattern: /(?:cat|less|more|head|tail|read|open|type|查看|读取|显示|打印|展示|输出)\s+.*\/etc\/shadow\b/i, label: "etc_shadow_read" },
  { pattern: /(?:cat|less|more|head|tail|read|open|type|查看|读取|显示|打印|展示|输出)\s+.*\/etc\/sudoers\b/i, label: "etc_sudoers_read" },
  // Path-only patterns for when the verb is implicit or separated
  { pattern: /\/etc\/shadow\b/i, label: "etc_shadow_read" },
  { pattern: /\/etc\/sudoers\b/i, label: "etc_sudoers_read" },
  { pattern: /\/etc\/passwd\b.*(?:文件|内容|信息)/i, label: "etc_passwd_read" },
  { pattern: /\/etc\/passwd\b/i, label: "etc_passwd_read" },
];

function detectCredentialTheft(text: string): string[] {
  const matched: string[] = [];
  for (const { pattern, label } of CREDENTIAL_ACCESS_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(label);
    }
  }
  return matched;
}

// ── Over-Agency Detection (M3) ─────────────────────────────────────

const OVER_AGENCY_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /修改\s*(?:你的|自己的|自身的)\s*(?:安全|规则|技能|配置)/i, label: "self_modify_request" },
  { pattern: /modify\s+(?:your|own)\s+(?:safety|rules|skills|config)/i, label: "self_modify_request_en" },
  { pattern: /(?:关闭|禁用|停用|取消)\s*(?:安全检查|安全防护|安全模块)/i, label: "disable_safety" },
  { pattern: /(?:disable|turn\s+off|deactivate)\s+(?:safety|security|guard)/i, label: "disable_safety_en" },
  { pattern: /提升\s*(?:你的|自己的)\s*权限/i, label: "privilege_escalation" },
  { pattern: /elevate\s+(?:your|own)\s+privilege/i, label: "privilege_escalation_en" },
  { pattern: /(?:修改|编辑|更改|更新|追加|覆盖|重写|删除|重命名|移动)\s*(?:SOUL|IDENTITY|USER|SKILL|AGENTS|TOOLS|SHIELD|MEMORY)\.md/i, label: "core_file_modify" },
  { pattern: /(?:modify|edit|update|append|overwrite|rewrite|delete|remove|rename|move)\s+(?:SOUL|IDENTITY|USER|SKILL|AGENTS|TOOLS|SHIELD|MEMORY)\.md/i, label: "core_file_modify_en" },
];

function detectOverAgency(text: string): string[] {
  const matched: string[] = [];
  for (const { pattern, label } of OVER_AGENCY_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(label);
    }
  }
  return matched;
}

// ── Sensitive Directory Entry Detection ───────────────────────────
// Detects cd / pushd / Set-Location into sensitive dirs.
// Not a blocking signal on its own — only adds "sensitive_dir_entry" to
// operationHistory for sequence detection.

function detectExecMasqueradeSetup(text: string): string[] {
  const matched: string[] = [];
  if (/\b(?:cp|copy|mv|move)\b[^\n\r]*(?:\/(?:usr\/)?bin\/)?(?:cat|less|more|head|tail|sh|bash|zsh|dash|python(?:3)?|node|perl|ruby|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?|curl|wget|nc|ncat|socat)\b/i.test(text)) {
    matched.push("binary_copy_or_rename");
  }
  if (/\bln\s+-s\b[^\n\r]*(?:\/(?:usr\/)?bin\/)?(?:sh|bash|zsh|dash|python(?:3)?|node|perl|ruby|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/i.test(text)) {
    matched.push("symlink_remap");
  }
  if (/(?:^|\s)alias\s+\w+=["'][^"']*(?:cat|less|more|head|tail|sh|bash|zsh|dash|python(?:3)?|node|perl|ruby|powershell|pwsh)\b/i.test(text)) {
    matched.push("alias_remap");
  }
  if (/(?:^|\s)(?:function\s+\w+\s*\{|\w+\s*\(\)\s*\{)[^\n\r]*(?:cat|less|more|head|tail|sh|bash|zsh|dash|python(?:3)?|node|perl|ruby|powershell|pwsh)\b/i.test(text)) {
    matched.push("function_remap");
  }
  if (/(?:^|\s)Set-Alias\s+\w+\s+\S+/i.test(text)) {
    matched.push("function_remap");
  }
  return matched;
}

function detectExecMasqueradeHint(text: string): string[] {
  const matched: string[] = [];
  if (/(?:^|\s)(?:export\s+PATH=|set\s+PATH=|\$env:PATH\s*=)/i.test(text)) {
    matched.push("path_shadowing");
  }
  if (/(?:^|\s)(?:set\s+PATHEXT=|\$env:(?:PATHEXT|PSModulePath)\s*=)/i.test(text)) {
    matched.push("exec_resolution_override");
  }
  return matched;
}

function getActiveExecMasqueradeLevel(sessionKey?: string): ExecMasqueradeLevel | undefined {
  if (!sessionKey) return undefined;
  const state = getSessionState(sessionKey);
  if (!state.execMasquerade) return undefined;
  if (Date.now() > state.execMasquerade.expiresAt) {
    delete state.execMasquerade;
    return undefined;
  }
  return state.execMasquerade.level;
}

function updateExecMasqueradeState(
  sessionKey: string | undefined,
  requestedLevel: ExecMasqueradeLevel,
  reasons: string[],
): ExecMasqueradeLevel {
  if (!sessionKey) return requestedLevel;

  const state = getSessionState(sessionKey);
  const existing = getActiveExecMasqueradeLevel(sessionKey);
  const nextLevel: ExecMasqueradeLevel =
    existing === "hard" || requestedLevel === "hard" ? "hard" : "soft";

  state.execMasquerade = {
    level: nextLevel,
    expiresAt: Date.now() + (nextLevel === "hard" ? 30 * 60 * 1000 : 10 * 60 * 1000),
    reasons: Array.from(new Set([...(state.execMasquerade?.reasons ?? []), ...reasons])),
  };

  return nextLevel;
}

function detectSensitiveDirEntry(text: string): boolean {
  // cd or pushd or Set-Location targeting sensitive directories
  return /(?:^|\s|&&|\|)(?:cd|pushd|Set-Location|sl)\s+["']?(?:~[/\\](?:\.ssh|\.aws|\.gnupg|\.openclaw|\.config)|\/etc|C:\\Windows\\System32|%SystemRoot%)/i.test(text) ||
    // Windows PowerShell cd into sensitive dirs
    /(?:^|\s)cd\s+["']?%(?:USERPROFILE|APPDATA|LOCALAPPDATA)%[/\\][^\s]*/i.test(text);
}

// ── M7: Wildcard / Path Obfuscation Detection ─────────────────────

function detectWildcardObfuscation(text: string): boolean {
  return (
    // ~/path*wildcard 或 ~\path*wildcard（兼容 Windows 反斜杠）
    /~[/\\][^\s]*\*/.test(text) ||
    // 命令参数中的通配符路径：*.json、*.open*aw、dir/*.conf、dir\*.conf
    /(?:^|\s|['"`])[^\s]*\*[^\s]*(?:[/\\.]|\s|['"`]|$)/.test(text) ||
    // 相对路径穿越：../../ 或 ..\..\ (Windows)
    /(?:\.\.\/|\.\.\\)[./\\]{0,}/.test(text)
  );
}

// ── M7: Pipe Shell Execution Detection ────────────────────────────

function detectPathObfuscation(text: string): boolean {
  return detectWildcardObfuscation(text)
    || /~[/\\][^\s]*(?:\?|\[[^\]\s]+\])/.test(text)
    || /(?:^|\s|['"`])[^\s]*(?:\?|\[[^\]\s]+\])[^\s]*(?:[/\\.]|\s|['"`]|$)/.test(text);
}

interface PipeExecResult {
  detected: boolean;
  shellExec: boolean; // | bash/sh/zsh/eval
}

function detectPipeExecution(text: string): PipeExecResult {
  const shellExec = /\|\s*(?:bash|sh|zsh|eval|exec)\b/i.test(text);
  const detected = shellExec || /\|\s*(?:xargs\s+(?:bash|sh)|python3?\s+-c)/i.test(text);
  return { detected, shellExec };
}

// ── Malicious Code Request Detection (M6) ──────────────────────────

const MALICIOUS_CODE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /(?:编写|写|生成|创建|制作).{0,6}(?:病毒|木马|勒索软件|蠕虫|恶意软件)/i, label: "malware_request_cn" },
  { pattern: /(?:write|create|generate|build)\s+(?:a\s+)?(?:virus|trojan|ransomware|worm|malware)/i, label: "malware_request_en" },
  { pattern: /(?:编写|写|生成).{0,6}(?:漏洞利用|exploit|0day|零日)/i, label: "exploit_request_cn" },
  { pattern: /(?:write|create|generate)\s+(?:an?\s+)?(?:exploit|0day|zero[\s-]?day)/i, label: "exploit_request_en" },
  { pattern: /(?:编写|创建).{0,6}(?:钓鱼|phishing)\s*(?:页面|邮件|网站)/i, label: "phishing_request_cn" },
  { pattern: /(?:create|build)\s+(?:a\s+)?(?:phishing)\s+(?:page|email|site)/i, label: "phishing_request_en" },
  { pattern: /(?:编写|创建).{0,6}(?:键盘记录|keylogger|间谍软件|spyware)/i, label: "spyware_request_cn" },
  { pattern: /(?:create|write)\s+(?:a\s+)?(?:keylogger|spyware|screen[\s-]?capture)/i, label: "spyware_request_en" },
  { pattern: /(?:创建|构建).{0,6}(?:DDoS|僵尸网络|botnet)/i, label: "ddos_request_cn" },
  { pattern: /(?:create|build)\s+(?:a\s+)?(?:DDoS\s+tool|botnet)/i, label: "ddos_request_en" },
];

function detectMaliciousCodeRequest(text: string): string[] {
  const matched: string[] = [];
  for (const { pattern, label } of MALICIOUS_CODE_PATTERNS) {
    if (pattern.test(text)) {
      matched.push(label);
    }
  }
  return matched;
}

const LEGAL_SECURITY_CONTEXT_PATTERNS: RegExp[] = [
  /\bCTF\b/i,
  /capture\s+the\s+flag/i,
  /authorized\s+(?:pentest|penetration\s+test|security\s+assessment)/i,
  /security\s+(?:research|training|education|lab)/i,
  /defensive\s+security/i,
  /for\s+(?:detection|defense|analysis)/i,
  /授权(?:渗透测试|安全测试|安全研究)/i,
  /安全(?:研究|教学|实验|演练|防御)/i,
  /仅限(?:授权|实验室|教学|CTF)/i,
];

function hasLegalSecurityContext(text: string): boolean {
  return LEGAL_SECURITY_CONTEXT_PATTERNS.some((pattern) => pattern.test(text));
}

// ── "Fatal Triangle" Check ─────────────────────────────────────────

interface FatalTriangleResult {
  accessesSensitiveData: boolean;
  inputFromUntrusted: boolean;
  outputToExternal: boolean;
  hitCount: number;
}

function checkFatalTriangle(
  toolName: string,
  params: Record<string, any>,
  _inputText?: string,
): FatalTriangleResult {
  let accessesSensitiveData = false;
  let inputFromUntrusted = false;
  let outputToExternal = false;

  const command = (params?.command ?? "") as string;
  const filePath = (params?.file_path ?? params?.path ?? "") as string;
  const combined = `${toolName} ${command} ${filePath}`;

  if (/\.env|credentials|secret|\.ssh|\.aws|\.gnupg|password|token|api[_-]?key|\/etc\/passwd|\/etc\/shadow|\/etc\/sudoers/i.test(combined)) {
    accessesSensitiveData = true;
  }

  if (/curl|wget|fetch|request|download|http/i.test(combined)) {
    inputFromUntrusted = true;
  }

  if (/curl\s+.*(?:--data|-d|-F|-X\s+POST)|webhook|send|push|upload|post/i.test(combined)) {
    outputToExternal = true;
  }

  const hitCount = [accessesSensitiveData, inputFromUntrusted, outputToExternal].filter(Boolean).length;

  return { accessesSensitiveData, inputFromUntrusted, outputToExternal, hitCount };
}

function isLikelyArtifactPathToken(token: string): boolean {
  return /^(?:\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|\/)/.test(token);
}

function tokenizeCommandHead(command: string, maxTokens: number): string[] {
  const tokens: string[] = [];
  const tokenPattern = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while (tokens.length < maxTokens && (match = tokenPattern.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }

  return tokens;
}

function inferExecArtifactPath(command: string): string | undefined {
  const trimmedCommand = command.trim();
  if (!trimmedCommand) {
    return undefined;
  }

  const tokens = tokenizeCommandHead(trimmedCommand, 2)
    .map((token) => token.replace(/[;|&]+$/, "").trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return undefined;
  }

  if (isLikelyArtifactPathToken(tokens[0])) {
    return tokens[0];
  }

  if (
    /^(?:bash|sh|python(?:3)?|node(?:js)?)(?:\.exe)?$/i.test(tokens[0])
    && tokens[1]
    && isLikelyArtifactPathToken(tokens[1])
  ) {
    return tokens[1];
  }

  return undefined;
}

function inferToolArtifactPath(
  normalizedToolName: string,
  filePath: string,
  command: string,
): string | undefined {
  const explicitPath = filePath.trim();
  if (explicitPath.length > 0) {
    return explicitPath;
  }

  if (normalizedToolName !== "exec") {
    return undefined;
  }

  return inferExecArtifactPath(command);
}

function deriveToolAttackGraphEvent(input: {
  normalizedToolName: string;
  protectedAccess: ProtectedFileAccessResult;
  credTheftLabels: string[];
  memorySessionAccess: boolean;
  triangle: FatalTriangleResult;
  trustedInternalProtectedRead: boolean;
  trustedManagedLynxCheckToolCall: boolean;
  artifactPath?: string;
}): AttackGraphEvent | undefined {
  if (input.trustedManagedLynxCheckToolCall) {
    return undefined;
  }

  const sensitiveRead = (
    (
      input.protectedAccess.matchedFiles.length > 0
      && input.protectedAccess.operation !== "write"
      && !input.trustedInternalProtectedRead
    )
    || input.credTheftLabels.length > 0
    || input.memorySessionAccess
  );
  const artifactWrite = Boolean(input.artifactPath)
    && (input.normalizedToolName === "write" || input.normalizedToolName === "edit");
  const artifactExec = Boolean(input.artifactPath) && input.normalizedToolName === "exec";

  if (input.triangle.outputToExternal) {
    return { action: "external_send" };
  }
  if (artifactExec) {
    return { action: "artifact_exec" };
  }
  if (artifactWrite) {
    return { action: "artifact_write" };
  }
  if (sensitiveRead) {
    return { action: "sensitive_read" };
  }
  return undefined;
}

function shouldPersistToolAttackEvent(
  input: {
    decision: GuardDecision;
    attackEvent: AttackGraphEvent | undefined;
    priorChainState: AttackGraphState | null;
    chainProgress: AttackGraphState | null;
  },
): boolean {
  if (!input.attackEvent || !input.chainProgress) {
    return false;
  }

  if (
    input.priorChainState?.stage === input.chainProgress.stage
    || (!input.priorChainState && input.chainProgress.stage === "idle")
  ) {
    return false;
  }

  if (!input.decision.block) {
    return true;
  }

  return input.attackEvent.action === "sensitive_read";
}

function deriveToolTaintWriteLabels(input: {
  normalizedToolName: string;
  artifactPath?: string;
  priorChainState: AttackGraphState | null;
  taintReadLabels: string[];
}): string[] {
  if (
    !input.artifactPath
    || (input.normalizedToolName !== "write" && input.normalizedToolName !== "edit")
  ) {
    return [];
  }

  const labels = new Set<string>(input.taintReadLabels);
  if (input.priorChainState?.stage && input.priorChainState.stage !== "idle") {
    labels.add(`chain:${input.priorChainState.stage}`);
  }

  return [...labels];
}

// ── Public API: Input Guard ────────────────────────────────────────

const OUTPUT_QUOTED_ARTIFACT_PATH_PATTERNS: readonly RegExp[] = [
  /"((?:[A-Za-z]:\\|\/|\.{1,2}[\\/])[^"\r\n]+)"/g,
  /'((?:[A-Za-z]:\\|\/|\.{1,2}[\\/])[^'\r\n]+)'/g,
  /`((?:[A-Za-z]:\\|\/|\.{1,2}[\\/])[^`\r\n]+)`/g,
];
const OUTPUT_BARE_ARTIFACT_PATH_PATTERN = /((?:[A-Za-z]:\\|\/|\.{1,2}[\\/])[^\s"'`<>|]+)/g;
const OUTPUT_EXTERNAL_SEND_PATTERNS: readonly RegExp[] = [
  /\bhttps?:\/\/\S+/i,
  /\b(?:upload|exfiltrat|webhook|curl|wget)\b/i,
  /(?:外发|外部|上传|泄露)/,
];

function normalizeExtractedOutputArtifactPath(path: string): string {
  return path.trim().replace(/[),.;:!?]+$/g, "");
}

function extractOutputArtifactPaths(output: string): string[] {
  const unique = new Set<string>();

  let bareSearchText = output;
  for (const pattern of OUTPUT_QUOTED_ARTIFACT_PATH_PATTERNS) {
    for (const match of bareSearchText.matchAll(pattern)) {
      const normalized = normalizeExtractedOutputArtifactPath(match[1] ?? "");
      if (normalized.length > 0) {
        unique.add(normalized);
      }
    }
    bareSearchText = bareSearchText.replace(pattern, " ");
  }

  for (const match of bareSearchText.matchAll(OUTPUT_BARE_ARTIFACT_PATH_PATTERN)) {
    const normalized = normalizeExtractedOutputArtifactPath(match[1] ?? "");
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }

  return [...unique];
}

function deriveOutputArtifactTaintReadLabels(
  output: string,
  sessionKey?: string,
): string[] {
  const labels = new Set<string>();

  for (const path of extractOutputArtifactPaths(output)) {
    const taintRecord = readGuardArtifactTaint(sessionKey, path);
    for (const taint of taintRecord?.taints ?? []) {
      labels.add(taint);
    }
  }

  return [...labels];
}

function deriveOutputTaintReadLabels(
  artifactTaintReadLabels: string[],
  priorChainState?: AttackGraphState | null,
): string[] {
  const labels = new Set<string>(artifactTaintReadLabels);

  if (priorChainState?.stage && priorChainState.stage !== "idle") {
    labels.add(`chain:${priorChainState.stage}`);
  }

  return [...labels];
}

function deriveOutputAttackGraphEvent(input: {
  output: string;
  priorChainState?: AttackGraphState | null;
  artifactTaintReadLabels: string[];
}): AttackGraphEvent | undefined {
  const stage = input.priorChainState?.stage;
  if (stage !== "artifact_prepared" && stage !== "execution_ready") {
    return undefined;
  }

  const hasExternalSendSignal = OUTPUT_EXTERNAL_SEND_PATTERNS.some((pattern) => pattern.test(input.output));
  if (!hasExternalSendSignal || input.artifactTaintReadLabels.length === 0) {
    return undefined;
  }

  return { action: "external_send" };
}

function shouldPersistOutputAttackEvent(input: {
  attackEvent: AttackGraphEvent | undefined;
  priorChainState: AttackGraphState | null;
  chainProgress: AttackGraphState | null;
}): boolean {
  if (!input.attackEvent || !input.chainProgress) {
    return false;
  }

  return input.priorChainState?.stage !== input.chainProgress.stage;
}

export function guardInput(text: string, sessionKey?: string, context?: GuardContext): GuardDecision {
  const verifiedOwner = context?.verifiedOwner === true;
  const atMs = Date.now();
  const finalizeInputDecision = (decision: GuardDecision): GuardDecision => ({
    ...decision,
    evidenceBundle: buildInputEvidenceBundle({
      text,
      assessment: decision.riskAssessment,
      sessionKey,
      atMs,
    }),
  });

  // === 即时危险通道（early-return，直接 L4）===

  // M1: 高置信度提示注入 / indirect_injection
  const injection = detectPromptInjection(text);
  if (injection.detected && (injection.confidence >= 0.85 || injection.category === "indirect_injection")) {
    return finalizeInputDecision(buildInstantDeny("M1:prompt_injection", "提示注入攻击（高置信度）"));
  }

  // M2: 系统提示探测（所有置信度）
  const identityClaims = detectIdentityClaims(text);
  const protectedAccess = detectProtectedFileAccess(text);
  const sysprompt = detectSystemPromptExtraction(text);
  if (sysprompt.detected) {
    const instantModules = ["M2:system_prompt_extraction"];
    if (protectedAccess.matchedFiles.length > 0) {
      instantModules.push("M2:protected_file_access");
    }
    if (identityClaims.detected && !verifiedOwner) {
      instantModules.push("M0:identity_verification");
    }
    return finalizeInputDecision(buildInstantDenyForModules(instantModules, "system prompt extraction"));
  }

  if (detectImmutableRuntimeConfigWrite(protectedAccess)) {
    return finalizeInputDecision(buildInstantDeny("M2:runtime_config_integrity", "attempt to modify immutable OpenClaw/Lynx config"));
  }

  if (detectLynxGuardianDisableRequest(text)) {
    return finalizeInputDecision(buildInstantDeny("M3:over_agency", "attempt to disable Lynx Guardian"));
  }

  if (detectOpenClawAvailabilityControl(text)) {
    return finalizeInputDecision(buildInstantDeny("M3:system_availability", "attempt to restart or stop OpenClaw"));
  }

  if (detectOpenClawMemorySessionRequest(text)) {
    return finalizeInputDecision(buildInstantDeny("M2:memory_session_privacy", "attempt to access or clear OpenClaw memory/session records"));
  }

  // M5: 主要凭证/系统敏感文件
  const credentialTheft = detectCredentialTheft(text);
  if (credentialTheft.some((label) => PRIMARY_SECRETS.has(label))) {
    return finalizeInputDecision(buildInstantDeny("M5:credential_theft", "主要凭证/系统敏感文件访问"));
  }

  // M6: 恶意代码（无合法上下文，或有上下文但非纯 exploit 类）
  const maliciousCode = detectMaliciousCodeRequest(text);
  if (maliciousCode.length > 0) {
    const legalCtx = hasLegalSecurityContext(text);
    const pureExploitOnly = maliciousCode.every((label) => label.includes("exploit_request"));
    if (!legalCtx || !pureExploitOnly) {
      return finalizeInputDecision(buildInstantDeny("M6:malicious_code", "恶意代码请求"));
    }
  }

  // M4: 中文规避意图（输入侧）
  const evasiveIntentCn = detectChineseEvasiveIntent(text);
  const suppressVisibleM4 = isStandaloneWildcardLowSignal(evasiveIntentCn);

  // === 评分通道 ===

  const modules: string[] = [];
  const accum = createAccumulators();

  // M0: 身份声明（先到先得）
  if (identityClaims.detected && !verifiedOwner) {
    modules.push("M0:identity_verification");
    const v = identityClaims.directOwnerClaim ? 2 : 1;
    pushDim(accum, "clarity", v);
    pushDim(accum, "auth", v);
    pushDim(accum, "pattern", v);
  }

  // M1: 低置信度提示注入（0 < confidence < 0.85，非 indirect）
  if (injection.detected && injection.confidence < 0.85 && injection.category !== "indirect_injection") {
    modules.push("M1:prompt_injection");
    pushDim(accum, "harm", 2);
    pushDim(accum, "rev", 1);
    pushDim(accum, "auth", 1);
    pushDim(accum, "pattern", injection.confidence >= 0.7 ? 2 : 1);
    pushDim(accum, "clarity", injection.confidence >= 0.6 ? 2 : 1);
  }

  // M2: 核心配置文件访问（openclaw 自身文件）
  if (protectedAccess.matchedFiles.length > 0) {
    modules.push("M2:protected_file_access");
    pushDim(accum, "harm", 2);
    pushDim(accum, "rev", protectedAccess.operation === "write" ? 2 : 1);
    pushDim(accum, "auth", 2);
    pushDim(accum, "pattern", 2);
    pushDim(accum, "clarity", protectedAccess.operation === "unknown" ? 1 : 2);
  }

  // M3: 过度代理/权限提升
  const overAgency = detectOverAgency(text);
  if (overAgency.length > 0) {
    modules.push("M3:over_agency");
    const isSelfModify = overAgency.some((m) =>
      m.includes("self_modify") || m.includes("disable_safety") || m.includes("core_file_modify") || m.includes("privilege_escalation"),
    );
    pushDim(accum, "harm", 2);
    pushDim(accum, "rev", isSelfModify ? 2 : 1);
    pushDim(accum, "auth", isSelfModify ? 2 : 1);
    pushDim(accum, "pattern", overAgency.length >= 2 ? 2 : 1);
    pushDim(accum, "clarity", isSelfModify ? 2 : 1);
  }

  // M5: 非主要凭证（credential_store / credential_search）
  const nonPrimaryCredTheft = credentialTheft.filter((label) => !PRIMARY_SECRETS.has(label));
  if (nonPrimaryCredTheft.length > 0) {
    modules.push("M5:credential_theft");
    pushDim(accum, "harm", 2);
    pushDim(accum, "rev", 1);
    pushDim(accum, "auth", 1);
    pushDim(accum, "clarity", nonPrimaryCredTheft.length >= 2 ? 2 : 1);
    pushDim(accum, "pattern", nonPrimaryCredTheft.length >= 2 ? 2 : 1);
  }

  // M6: legalSecurityContext + 纯 exploit 类（降至 L3，不进即时通道）
  if (maliciousCode.length > 0 && hasLegalSecurityContext(text) && maliciousCode.every((l) => l.includes("exploit_request"))) {
    modules.push("M6:malicious_code");
    pushDim(accum, "harm", 2);
    pushDim(accum, "rev", 2);
    pushDim(accum, "auth", 1); // legalCtx 降低未授权程度
    pushDim(accum, "pattern", 2);
    pushDim(accum, "clarity", 2);
  }

  // M4: 中文规避意图（模块化加权 + 有界增益）
  if (evasiveIntentCn.detected && !suppressVisibleM4) {
    modules.push("M4:evasive_intent_cn");
    if (evasiveIntentCn.severity === "high") {
      pushDim(accum, "harm", 2);
      pushDim(accum, "rev", 1);
      pushDim(accum, "auth", 2);
      pushDim(accum, "pattern", 2);
      pushDim(accum, "clarity", 2);
    } else if (evasiveIntentCn.severity === "medium") {
      pushDim(accum, "harm", 2);
      pushDim(accum, "auth", 1);
      pushDim(accum, "pattern", 2);
      pushDim(accum, "clarity", 2);
    } else {
      pushDim(accum, "harm", 1);
      pushDim(accum, "pattern", 1);
      pushDim(accum, "clarity", 1);
    }

    if (evasiveIntentCn.matchedFamilies.includes("dangerous_outcome")) {
      pushDim(accum, "harm", 2);
      pushDim(accum, "rev", 2);
    }
    if (evasiveIntentCn.matchedFamilies.length >= 3) {
      pushDim(accum, "pattern", 2);
    }
  }

  // M0 + M2/M3 组合：叠加额外 auth 信号
  if (!verifiedOwner && identityClaims.detected && (
    modules.includes("M2:protected_file_access") || modules.includes("M3:over_agency")
  )) {
    pushDim(accum, "auth", 2);
  }

  // sensitive_dir_entry（仅进 operationHistory 用于序列检测，不独立加分）
  if (detectSensitiveDirEntry(text)) {
    modules.push("sensitive_dir_entry");
  }

  // M7: 路径混淆（弱信号，仅进评分通道，不进即时通道）
  if (detectPathObfuscation(text)) {
    modules.push("M7:wildcard_obfuscation");
    pushDim(accum, "pattern", 1);
    pushDim(accum, "clarity", 1);
  }

  // M7: 管道执行（cat|bash 等，shellExec 权重更高）
  const pipeExec = detectPipeExecution(text);
  if (pipeExec.detected) {
    modules.push("M7:pipe_execution");
    pushDim(accum, "harm", pipeExec.shellExec ? 2 : 1);
    pushDim(accum, "pattern", 1);
    pushDim(accum, "clarity", pipeExec.shellExec ? 2 : 1);
  }

  let score = computeWeightedScore(accum);
  if (evasiveIntentCn.detected && !suppressVisibleM4) {
    score = Math.min(score + Math.min(evasiveIntentCn.scoreDelta, 2), 10);
  }

  if (sessionKey) {
    const sharedAnomalyModules = modules.filter((m) => m !== "M4:evasive_intent_cn");
    const anomalyAdj = computeAnomalyAdjustment(sessionKey, score, sharedAnomalyModules);
    score = Math.min(score + anomalyAdj, 10);
    if (evasiveIntentCn.detected && !suppressVisibleM4) {
      const cnConversationAdj = computeChineseEvasiveConversationAdjustment(
        sessionKey,
        evasiveIntentCn.matchedFamilies,
      );
      score = Math.min(score + cnConversationAdj, 10);
    }
  }

  if (verifiedOwner && score > 0) {
    score = Math.max(0, score - 2);
  }

  score = Math.min(score, 10);

  const level = scoreToLevel(score);
  const action = levelToAction(level);

  const assessment: RiskAssessment = {
    level,
    score,
    modules,
    action,
    description: buildDescription(modules, level),
  };

  if (action === "deny") {
    return finalizeInputDecision({
      block: true,
      blockReason: `[Lynx Guardian] 🛡️ 安全防护拦截 (${level}, score=${score}): ${assessment.description}`,
      riskAssessment: assessment,
    });
  }

  if (action === "block") {
    return finalizeInputDecision({
      block: true,
      blockReason: `[Lynx Guardian] ⚠️ 高风险操作被阻止 (${level}, score=${score}): ${assessment.description}`,
      riskAssessment: assessment,
    });
  }

  if (action === "warn") {
    return finalizeInputDecision({
      block: false,
      warning: `⚠️ 安全提醒: ${assessment.description}`,
      riskAssessment: assessment,
    });
  }

  return finalizeInputDecision({
    block: false,
    riskAssessment: assessment,
  });
}

// ── Output: Actual Secret Value Detection ─────────────────────────
// Detects real credential values appearing in model output (not just commands
// that access them). Focuses on high-confidence key formats to avoid false positives.

const SECRET_VALUE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bsk-[a-zA-Z0-9]{20,}\b/, label: "openai_anthropic_key" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: "aws_access_key" },
  { pattern: /\bghp_[a-zA-Z0-9]{36}\b/, label: "github_token" },
  { pattern: /\bgithub_pat_[a-zA-Z0-9_]{82}\b/, label: "github_pat" },
  { pattern: /\bxox[bpas]-[0-9A-Za-z-]{10,}\b/, label: "slack_token" },
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, label: "private_key" },
];

const outputSensitiveDataBlocker = new SensitiveDataBlocker();

function detectSecretsInOutput(text: string): string[] {
  return SECRET_VALUE_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
}

function detectPersonalFinancialDataInOutput(text: string): string[] {
  return Array.from(
    new Set(
      outputSensitiveDataBlocker
        .findSensitiveData(text, { includePersonalFinancial: true })
        .map((match) => match.type)
        .filter((type) => type === "cn_resident_id" || type === "bank_card"),
    ),
  );
}

// ── Public API: Output Guard ───────────────────────────────────────

export function guardOutput(output: string, sessionKey?: string, context?: GuardContext): GuardDecision {
  if (context?.trustedManagedLynxCheckOutput === true) {
    return {
      block: false,
      riskAssessment: {
        level: "L0",
        score: 0,
        modules: [],
        description: "trusted managed lynx-check audit output",
        action: "allow",
      },
    };
  }

  const atMs = Date.now();
  const finalizeOutputDecision = (decision: GuardDecision): GuardDecision => {
    const priorChainState = readAttackGraphState(sessionKey);
    const artifactTaintReadLabels = deriveOutputArtifactTaintReadLabels(output, sessionKey);
    const taintReadLabels = deriveOutputTaintReadLabels(artifactTaintReadLabels, priorChainState);
    const attackEvent = deriveOutputAttackGraphEvent({
      output,
      priorChainState,
      artifactTaintReadLabels,
    });
    const chainProgress = attackEvent
      ? advanceAttackGraph(priorChainState ?? undefined, attackEvent)
      : priorChainState;

    if (!decision.block && attackEvent && shouldPersistOutputAttackEvent({
      attackEvent,
      priorChainState,
      chainProgress: chainProgress ?? null,
    })) {
      advanceAttackGraphState(sessionKey, attackEvent);
    }

    return {
      ...decision,
      evidenceBundle: buildOutputEvidenceBundle({
        output,
        assessment: decision.riskAssessment,
        sessionKey,
        chainProgress,
        taintReadLabels,
        atMs,
      }),
    };
  };

  if (detectOpenClawMemorySessionLeak(output)) {
    return finalizeOutputDecision(buildInstantDeny("M2:memory_session_privacy", "attempt to reveal OpenClaw memory/session records"));
  }

  const modules: string[] = [];
  const accum = createAccumulators();
  let leakDirectScore = 0;

  // ── System prompt leak (existing, direct score channel) ──────────
  const leak = detectSystemPromptLeak(output);
  if (leak.isLeak) {
    modules.push("M2:system_prompt_leak");
    leakDirectScore = leak.severity === "high" ? 10 : 7;
  }

  // ── M5: Actual secret values exposed in output ────────────────────
  const secrets = detectSecretsInOutput(output);
  if (secrets.length > 0) {
    modules.push("M5:secrets_in_output");
    pushDim(accum, "harm", 3);
    pushDim(accum, "rev", 2);
    pushDim(accum, "auth", 2);
    pushDim(accum, "pattern", 2);
    pushDim(accum, "clarity", 2);
  }

  const personalFinancialData = detectPersonalFinancialDataInOutput(output);
  if (personalFinancialData.length > 0) {
    modules.push("M5:pii_in_output");
    pushDim(accum, "harm", 2);
    pushDim(accum, "rev", 1);
    pushDim(accum, "auth", 2);
    pushDim(accum, "pattern", 2);
    pushDim(accum, "clarity", 2);
  }

  // ── M1: Chain injection propagation ──────────────────────────────
  // Model's output contains injection patterns aimed at the next conversation turn.
  const chainInj = detectPromptInjection(output);
  if (chainInj.detected && chainInj.confidence >= 0.7) {
    modules.push("M1:chain_injection_output");
    pushDim(accum, "harm", chainInj.confidence >= 0.85 ? 2 : 1);
    pushDim(accum, "rev", 1);
    pushDim(accum, "auth", 1);
    pushDim(accum, "pattern", 2);
    pushDim(accum, "clarity", chainInj.confidence >= 0.85 ? 2 : 1);
  }

  // ── M3: Over-agency suggestion in output ─────────────────────────
  // Model suggests disabling safety / modifying core files to user.
  const overAgency = detectOverAgency(output);
  if (overAgency.length > 0) {
    modules.push("M3:over_agency_output");
    pushDim(accum, "harm", 1);
    pushDim(accum, "pattern", overAgency.length >= 2 ? 2 : 1);
    pushDim(accum, "clarity", 1);
  }

  // Final score: take the higher of direct-assigned (leak) and accumulated
  let score = Math.max(leakDirectScore, computeWeightedScore(accum));

  if (sessionKey) {
    const anomalyAdj = computeAnomalyAdjustment(sessionKey, score, modules);
    score = Math.min(score + anomalyAdj, 10);
  }

  score = Math.min(score, 10);
  const level = scoreToLevel(score);
  const action = levelToAction(level);

  const descParts: string[] = [];
  if (leak.isLeak) descParts.push(`系统提示泄露(${leak.protectedFiles.join(",")})`);
  if (secrets.length > 0) descParts.push(`凭证值暴露(${secrets.join(",")})`);
  if (chainInj.detected && chainInj.confidence >= 0.7) descParts.push("输出中含链式注入");
  if (overAgency.length > 0) descParts.push("输出含高危操作建议");

  const assessment: RiskAssessment = {
    level,
    score,
    modules,
    action,
    description: descParts.length > 0 ? descParts.join("；") : "输出安全",
  };

  if (action === "block" || action === "deny") {
    return finalizeOutputDecision({
      block: true,
      blockReason: `[Lynx Guardian] 🛡️ 输出安全拦截 (${level}, score=${score}): ${assessment.description}`,
      riskAssessment: assessment,
    });
  }

  if (action === "warn") {
    return finalizeOutputDecision({
      block: false,
      warning: `⚠️ 输出风险提醒 (${level}): ${assessment.description}`,
      riskAssessment: assessment,
    });
  }

  return finalizeOutputDecision({
    block: false,
    riskAssessment: assessment,
  });
}

// ── Public API: Tool Call Guard ─────────────────────────────────────

export function guardToolCall(
  toolName: string,
  params: Record<string, any>,
  sessionKey?: string,
  context?: GuardContext,
): GuardDecision {
  const verifiedOwner = context?.verifiedOwner === true;
  const trustedInternalProtectedRead = context?.trustedInternalProtectedRead === true;
  const trustedManagedLynxCheckToolCall = context?.trustedManagedLynxCheckToolCall === true;

  const toolAction = (params?.action ?? "") as string;
  const note = (params?.note ?? "") as string;
  const raw = (params?.raw ?? "") as string;
  const command = (params?.command ?? "") as string;
  const filePath = (params?.file_path ?? params?.path ?? "") as string;
  const normalizedToolName = toolName.trim().toLowerCase();
  const normalizedToolAction = toolAction.trim().toLowerCase();
  const combined = `${toolName} ${toolAction} ${note} ${command} ${filePath} ${raw}`;
  const atMs = Date.now();
  const protectedAccess = detectProtectedFileAccess(combined, toolName);
  const memorySessionAccess = detectOpenClawMemorySessionArtifactAccess(combined, toolName);
  const credTheft = detectCredentialTheft(combined);
  const triangle = checkFatalTriangle(toolName, params);
  const artifactPath = inferToolArtifactPath(normalizedToolName, filePath, command);
  const taintReadLabels = artifactPath
    ? (readGuardArtifactTaint(sessionKey, artifactPath)?.taints ?? [])
    : [];
  const attackEvent = deriveToolAttackGraphEvent({
    normalizedToolName,
    protectedAccess,
    credTheftLabels: credTheft,
    memorySessionAccess,
    triangle,
    trustedInternalProtectedRead,
    trustedManagedLynxCheckToolCall,
    artifactPath,
  });
  let masqueradeTaintLevel = getActiveExecMasqueradeLevel(sessionKey);

  const finalizeToolDecision = (decision: GuardDecision): GuardDecision => {
    const priorChainState = readAttackGraphState(sessionKey);
    const chainProgress = attackEvent
      ? advanceAttackGraph(priorChainState ?? undefined, attackEvent)
      : priorChainState;
    const taintWriteLabels = deriveToolTaintWriteLabels({
      normalizedToolName,
      artifactPath,
      priorChainState,
      taintReadLabels,
    });

    if (shouldPersistToolAttackEvent({
      decision,
      attackEvent,
      priorChainState,
      chainProgress,
    })) {
      advanceAttackGraphState(sessionKey, attackEvent);
    }

    if (artifactPath && taintWriteLabels.length > 0 && !decision.block) {
      markGuardArtifactTaint(sessionKey, artifactPath, taintWriteLabels, { atMs });
    }

    return {
      ...decision,
      evidenceBundle: buildToolEvidenceBundle({
        toolName: normalizedToolName || toolName,
        params,
        assessment: decision.riskAssessment,
        sessionKey,
        chainProgress,
        taintReadLabels,
        taintWriteLabels,
        atMs,
      }),
    };
  };

  if (normalizedToolName === "gateway" && /^config\.(?:patch|set|replace|update)$/i.test(normalizedToolAction)) {
    return finalizeToolDecision(buildInstantDeny("M2:runtime_config_integrity", "attempt to modify immutable OpenClaw/Lynx config"));
  }

  if (
    normalizedToolName === "gateway"
    && /(?:^|\.)(?:restart|stop|shutdown|close|kill|down|quit|exit)(?:$|\.)/i.test(normalizedToolAction)
  ) {
    return finalizeToolDecision(buildInstantDeny("M3:system_availability", "attempt to restart or stop OpenClaw"));
  }

  // === 即时危险通道 ===

  // M5: 主要凭证 via tool
  if (detectImmutableRuntimeConfigWrite(protectedAccess)) {
    return finalizeToolDecision(buildInstantDeny("M2:runtime_config_integrity", "attempt to modify immutable OpenClaw/Lynx config"));
  }

  if (detectLynxGuardianDisableRequest(combined)) {
    return finalizeToolDecision(buildInstantDeny("M3:over_agency", "attempt to disable Lynx Guardian"));
  }

  if (detectOpenClawAvailabilityControl(combined)) {
    return finalizeToolDecision(buildInstantDeny("M3:system_availability", "attempt to restart or stop OpenClaw"));
  }

  if (memorySessionAccess) {
    return finalizeToolDecision(buildInstantDeny("M2:memory_session_privacy", "attempt to access or modify OpenClaw memory/session artifacts"));
  }

  if (detectPluginIntegrityViolation(combined, toolName)) {
    return finalizeToolDecision(buildInstantDeny("M2:plugin_integrity", "attempt to modify Lynx plugin directory"));
  }

  if (findObfuscatedSystemAuthPath(combined)) {
    return finalizeToolDecision(buildInstantDeny("M5:credential_theft", "工具调用访问主要凭证/系统敏感文件"));
  }

  if (credTheft.some((label) => PRIMARY_SECRETS.has(label))) {
    return finalizeToolDecision(buildInstantDeny("M5:credential_theft", "工具调用访问主要凭证/系统敏感文件"));
  }

  // M3: 过度代理 via tool（直接执行侧，立即拒绝）
  const overAgency = detectOverAgency(combined);
  if (overAgency.length > 0) {
    return finalizeToolDecision(buildInstantDeny("M3:over_agency", "工具调用过度代理/权限提升"));
  }

  // Fatal Triangle: 全三角命中
  if (triangle.hitCount >= 3) {
    return finalizeToolDecision(buildInstantDeny("fatal_triangle", "致命三角：敏感数据访问+外部输出+不可信输入同时命中"));
  }

  // === 评分通道 ===

  const modules: string[] = [];
  const accum = createAccumulators();

  // M2: 核心配置文件访问 via tool
  const masqueradeSetup = detectExecMasqueradeSetup(command);
  const masqueradeHint = detectExecMasqueradeHint(command);

  if (masqueradeSetup.length > 0) {
    modules.push("M3:exec_masquerade_setup");
    pushDim(accum, "harm", 2);
    pushDim(accum, "auth", 2);
    pushDim(accum, "pattern", 2);
    pushDim(accum, "clarity", 2);
    masqueradeTaintLevel = updateExecMasqueradeState(sessionKey, "hard", masqueradeSetup);
  } else if (masqueradeHint.length > 0) {
    modules.push("M3:exec_masquerade_taint");
    pushDim(accum, "pattern", 1);
    pushDim(accum, "clarity", 1);
    masqueradeTaintLevel = updateExecMasqueradeState(sessionKey, "soft", masqueradeHint);
  }

  if (
    protectedAccess.matchedFiles.length > 0
    && !trustedInternalProtectedRead
    && !trustedManagedLynxCheckToolCall
  ) {
    modules.push("M2:protected_file_access");
    pushDim(accum, "harm", 2);
    pushDim(accum, "rev", protectedAccess.operation === "write" ? 2 : 1);
    pushDim(accum, "auth", 2);
    pushDim(accum, "pattern", 2);
    pushDim(accum, "clarity", 2);
  }

  // M5: 非主要凭证 via tool
  const nonPrimaryCredTheft = credTheft.filter((label) => !PRIMARY_SECRETS.has(label));
  if (nonPrimaryCredTheft.length > 0) {
    modules.push("M5:credential_theft");
    pushDim(accum, "harm", 2);
    pushDim(accum, "rev", 1);
    pushDim(accum, "auth", 1);
    pushDim(accum, "clarity", nonPrimaryCredTheft.length >= 2 ? 2 : 1);
    pushDim(accum, "pattern", nonPrimaryCredTheft.length >= 2 ? 2 : 1);
  }

  // Fatal Triangle: 部分命中（2 角）
  if (triangle.hitCount === 2) {
    modules.push("fatal_triangle");
    pushDim(accum, "harm", 2);
    pushDim(accum, "rev", triangle.outputToExternal ? 2 : 1);
    pushDim(accum, "auth", 2);
    pushDim(accum, "pattern", 1);
    pushDim(accum, "clarity", 1);
  }

  // sensitive_dir_entry via tool（command 参数中的 cd 等）
  if (detectSensitiveDirEntry(command)) {
    modules.push("sensitive_dir_entry");
  }

  // M7: 路径混淆 via tool（command / file_path 参数）
  if (!trustedManagedLynxCheckToolCall && detectPathObfuscation(combined)) {
    modules.push("M7:wildcard_obfuscation");
    pushDim(accum, "pattern", 1);
    pushDim(accum, "clarity", 1);
  }

  // M7: 管道执行 via tool（command 参数中包含 | bash 等）
  const toolPipeExec = detectPipeExecution(command);
  if (!trustedManagedLynxCheckToolCall && toolPipeExec.detected) {
    modules.push("M7:pipe_execution");
    pushDim(accum, "harm", toolPipeExec.shellExec ? 2 : 1);
    pushDim(accum, "pattern", 1);
    pushDim(accum, "clarity", toolPipeExec.shellExec ? 2 : 1);
  }

  let score = computeWeightedScore(accum);

  if (sessionKey) {
    const anomalyAdj = computeAnomalyAdjustment(sessionKey, score, modules);
    score = Math.min(score + anomalyAdj, 10);
  }

  if (verifiedOwner && score > 0) {
    score = Math.max(0, score - 2);
  }

  if (
    !trustedInternalProtectedRead
    && !trustedManagedLynxCheckToolCall
    && hasToolStageMinBlockProtectedFile(protectedAccess)
  ) {
    score = Math.max(score, 6);
  }

  score = Math.min(score, 10);

  const level = scoreToLevel(score);
  const action = levelToAction(level);

  const assessment: RiskAssessment = {
    level,
    score,
    modules,
    action,
    description: buildDescription(modules, level),
  };

  if (action === "deny" || action === "block") {
    return finalizeToolDecision({
      block: true,
      blockReason: `[Lynx Guardian] 🛡️ 工具调用安全拦截 (${level}): ${assessment.description}`,
      riskAssessment: assessment,
      contextHints: {
        masqueradeTaintLevel,
      },
    });
  }

  return finalizeToolDecision({
    block: false,
    riskAssessment: assessment,
    contextHints: {
      masqueradeTaintLevel,
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────

function buildDescription(modules: string[], level: RiskLevel): string {
  if (modules.length === 0) return "安全";

  const moduleNames: Record<string, string> = {
    "M2:memory_session_privacy": "OpenClaw memory/session privacy",
    "M2:plugin_integrity": "Lynx plugin integrity",
    "M2:runtime_config_integrity": "immutable OpenClaw/Lynx config",
    "M3:remote_access_control": "SSH remote login control",
    "M3:system_availability": "system shutdown/reboot control",
    "M0:identity_verification": "身份冒充/未验证身份声明",
    "M1:prompt_injection": "提示注入攻击",
    "M2:system_prompt_extraction": "系统提示探测",
    "M2:protected_file_access": "核心配置文件访问",
    "M2:system_prompt_leak": "系统提示泄露",
    "M3:over_agency": "过度代理/权限提升",
    "M4:evasive_intent_cn": "中文规避意图输入",
    "M5:credential_theft": "凭证窃取风险",
    "M6:malicious_code": "恶意代码请求",
    "fatal_triangle": "致命三角风险",
  };

  const names = modules.map((m) => moduleNames[m] ?? m);
  return `检测到${names.join("、")}`;
}

export function clearSessionState(sessionKey: string): void {
  sessionStates.delete(sessionKey);
  clearGuardPolicyState(sessionKey);
}
