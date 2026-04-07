/**
 * AI Self-Safety Guard - Core Orchestrator
 *
 * Implements the 5-level risk assessment framework (L0-L4) with
 * weighted + folding multi-module scoring and an instant-danger channel.
 * Orchestrates all defense modules (M0-M7) from the self-safety-guard skill.
 */

import { detectPromptInjection, detectSystemPromptExtraction } from "./prompt-injection.js";
import { detectSystemPromptLeak } from "./system-prompt-guard.js";

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
  overrideHint?: {
    allowed: boolean;
    confirmationPhrase?: string;
    reason?: string;
  };
}

export interface GuardContext {
  verifiedOwner?: boolean;
  requesterId?: string;
  channel?: string;
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
  const assessment: RiskAssessment = {
    level: "L4",
    score: 10,
    modules: [moduleId],
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

interface SessionState {
  recentScores: number[];
  rejectedTopics: Map<string, number>;
  lastTopicCategory: string;
  lastActiveTime: number;
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
  "M2:protected_file_access",
  "M3:over_agency",
]);

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

  return adjustment;
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
  { pattern: /\bSKILL\.md\b/i, label: "SKILL.md" },
  { pattern: /\bMEMORY\.md\b/i, label: "MEMORY.md" },
  { pattern: /(?:^|[\\/])memory[\\/]/i, label: "memory/" },
  { pattern: /\bworkspace-state\.json\b/i, label: "workspace-state.json" },
  { pattern: /\bopenclaw\.plugin\.json\b/i, label: "openclaw.plugin.json" },
  { pattern: /\bopenclaw\.json\b/i, label: "openclaw.json" },
];

const PROTECTED_FILE_READ_PATTERNS: RegExp[] = [
  /\b(?:cat|less|more|head|tail|read|open|show|print|display|type|dump)\b/i,
  /(?:读取|查看|显示|打印|展示|列出|导出)/i,
];

const PROTECTED_FILE_WRITE_PATTERNS: RegExp[] = [
  /\b(?:write|edit|modify|update|append|overwrite|rewrite|rename|move|delete|remove|rm|mv|cp|tee)\b/i,
  /sed\s+-i/i,
  /(?:修改|编辑|更改|更新|追加|覆盖|重写|删除|重命名|移动)/i,
];

function detectProtectedFileAccess(text: string, toolName?: string): ProtectedFileAccessResult {
  const matchedFiles: string[] = [];
  for (const { pattern, label } of PROTECTED_FILE_PATTERNS) {
    if (pattern.test(text)) {
      matchedFiles.push(label);
    }
  }

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

// ── Public API: Input Guard ────────────────────────────────────────

export function guardInput(text: string, sessionKey?: string, context?: GuardContext): GuardDecision {
  const verifiedOwner = context?.verifiedOwner === true;

  // === 即时危险通道（early-return，直接 L4）===

  // M1: 高置信度提示注入 / indirect_injection
  const injection = detectPromptInjection(text);
  if (injection.detected && (injection.confidence >= 0.85 || injection.category === "indirect_injection")) {
    return buildInstantDeny("M1:prompt_injection", "提示注入攻击（高置信度）");
  }

  // M2: 系统提示探测（所有置信度）
  const sysprompt = detectSystemPromptExtraction(text);
  if (sysprompt.detected) {
    return buildInstantDeny("M2:system_prompt_extraction", "系统提示探测");
  }

  // M5: 主要凭证/系统敏感文件
  const credentialTheft = detectCredentialTheft(text);
  if (credentialTheft.some((label) => PRIMARY_SECRETS.has(label))) {
    return buildInstantDeny("M5:credential_theft", "主要凭证/系统敏感文件访问");
  }

  // M6: 恶意代码（无合法上下文，或有上下文但非纯 exploit 类）
  const maliciousCode = detectMaliciousCodeRequest(text);
  if (maliciousCode.length > 0) {
    const legalCtx = hasLegalSecurityContext(text);
    const pureExploitOnly = maliciousCode.every((label) => label.includes("exploit_request"));
    if (!legalCtx || !pureExploitOnly) {
      return buildInstantDeny("M6:malicious_code", "恶意代码请求");
    }
  }

  // === 评分通道 ===

  const modules: string[] = [];
  const accum = createAccumulators();

  // M0: 身份声明（先到先得）
  const identityClaims = detectIdentityClaims(text);
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
  const protectedAccess = detectProtectedFileAccess(text);
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

  // M0 + M2/M3 组合：叠加额外 auth 信号
  if (!verifiedOwner && identityClaims.detected && (
    modules.includes("M2:protected_file_access") || modules.includes("M3:over_agency")
  )) {
    pushDim(accum, "auth", 2);
  }

  let score = computeWeightedScore(accum);

  if (sessionKey) {
    const anomalyAdj = computeAnomalyAdjustment(sessionKey, score, modules);
    score = Math.min(score + anomalyAdj, 10);
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
    return {
      block: true,
      blockReason: `[Lynx Guardian] 🛡️ 安全防护拦截 (${level}, score=${score}): ${assessment.description}`,
      riskAssessment: assessment,
    };
  }

  if (action === "block") {
    return {
      block: true,
      blockReason: `[Lynx Guardian] ⚠️ 高风险操作被阻止 (${level}, score=${score}): ${assessment.description}`,
      riskAssessment: assessment,
    };
  }

  if (action === "warn") {
    return {
      block: false,
      warning: `⚠️ 安全提醒: ${assessment.description}`,
      riskAssessment: assessment,
    };
  }

  return { block: false, riskAssessment: assessment };
}

// ── Public API: Output Guard ───────────────────────────────────────

export function guardOutput(output: string): GuardDecision {
  const modules: string[] = [];
  let score = 0;

  const leak = detectSystemPromptLeak(output);
  if (leak.isLeak) {
    modules.push("M2:system_prompt_leak");
    // Direct score assignment — no forcedMinLevel
    score = leak.severity === "high" ? 10 : 7;
  }

  score = Math.min(score, 10);
  const level = scoreToLevel(score);
  const action = levelToAction(level);

  const assessment: RiskAssessment = {
    level,
    score,
    modules,
    action,
    description: modules.length > 0
      ? `检测到系统提示泄露风险 (${leak.protectedFiles.join(", ")})`
      : "输出安全",
  };

  if (action === "block" || action === "deny") {
    return {
      block: true,
      blockReason: `[Lynx Guardian] 检测到输出中包含受保护的系统配置信息`,
      riskAssessment: assessment,
    };
  }

  if (action === "warn") {
    return {
      block: false,
      warning: `⚠️ 输出中可能包含敏感配置信息`,
      riskAssessment: assessment,
    };
  }

  return { block: false, riskAssessment: assessment };
}

// ── Public API: Tool Call Guard ─────────────────────────────────────

export function guardToolCall(
  toolName: string,
  params: Record<string, any>,
  sessionKey?: string,
  context?: GuardContext,
): GuardDecision {
  const verifiedOwner = context?.verifiedOwner === true;

  const command = (params?.command ?? "") as string;
  const filePath = (params?.file_path ?? params?.path ?? "") as string;
  const combined = `${command} ${filePath}`;

  // === 即时危险通道 ===

  // M5: 主要凭证 via tool
  const credTheft = detectCredentialTheft(combined);
  if (credTheft.some((label) => PRIMARY_SECRETS.has(label))) {
    return buildInstantDeny("M5:credential_theft", "工具调用访问主要凭证/系统敏感文件");
  }

  // M3: 过度代理 via tool（直接执行侧，立即拒绝）
  const overAgency = detectOverAgency(combined);
  if (overAgency.length > 0) {
    return buildInstantDeny("M3:over_agency", "工具调用过度代理/权限提升");
  }

  // Fatal Triangle: 全三角命中
  const triangle = checkFatalTriangle(toolName, params);
  if (triangle.hitCount >= 3) {
    return buildInstantDeny("fatal_triangle", "致命三角：敏感数据访问+外部输出+不可信输入同时命中");
  }

  // === 评分通道 ===

  const modules: string[] = [];
  const accum = createAccumulators();

  // M2: 核心配置文件访问 via tool
  const protectedAccess = detectProtectedFileAccess(combined, toolName);
  if (protectedAccess.matchedFiles.length > 0) {
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

  let score = computeWeightedScore(accum);

  if (sessionKey) {
    const anomalyAdj = computeAnomalyAdjustment(sessionKey, score, modules);
    score = Math.min(score + anomalyAdj, 10);
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

  if (action === "deny" || action === "block") {
    return {
      block: true,
      blockReason: `[Lynx Guardian] 🛡️ 工具调用安全拦截 (${level}): ${assessment.description}`,
      riskAssessment: assessment,
    };
  }

  return { block: false, riskAssessment: assessment };
}

// ── Helpers ────────────────────────────────────────────────────────

function buildDescription(modules: string[], level: RiskLevel): string {
  if (modules.length === 0) return "安全";

  const moduleNames: Record<string, string> = {
    "M0:identity_verification": "身份冒充/未验证身份声明",
    "M1:prompt_injection": "提示注入攻击",
    "M2:system_prompt_extraction": "系统提示探测",
    "M2:protected_file_access": "核心配置文件访问",
    "M2:system_prompt_leak": "系统提示泄露",
    "M3:over_agency": "过度代理/权限提升",
    "M5:credential_theft": "凭证窃取风险",
    "M6:malicious_code": "恶意代码请求",
    "fatal_triangle": "致命三角风险",
  };

  const names = modules.map((m) => moduleNames[m] ?? m);
  return `检测到${names.join("、")}`;
}

export function clearSessionState(sessionKey: string): void {
  sessionStates.delete(sessionKey);
}
