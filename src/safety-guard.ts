/**
 * AI Self-Safety Guard - Core Orchestrator
 *
 * Implements the 5-level risk assessment framework (L0-L4) with
 * 5-dimensional scoring and behavioral anomaly tracking.
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
}

// ── 5-Dimensional Scoring ──────────────────────────────────────────

interface ScoreDimensions {
  intentClarity: number;     // 0-2: malicious=2, ambiguous=1, benign=0
  potentialHarm: number;     // 0-2: severe=2, minor=1, none=0
  reversibility: number;     // 0-2: irreversible=2, partial=1, reversible=0
  authorizationStatus: number; // 0-2: unauthorized=2, uncertain=1, authorized=0
  patternMatch: number;      // 0-2: strong=2, weak=1, none=0
}

function computeRiskScore(dims: ScoreDimensions): number {
  return dims.intentClarity
    + dims.potentialHarm
    + dims.reversibility
    + dims.authorizationStatus
    + dims.patternMatch;
}

function scoreToLevel(score: number): RiskLevel {
  if (score <= 0) return "L0";
  if (score <= 3) return "L1";
  if (score <= 6) return "L2";
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

// ── Session Anomaly Tracker ────────────────────────────────────────

interface SessionState {
  recentScores: number[];
  rejectedTopics: Map<string, number>;
  lastTopicCategory: string;
}

const sessionStates = new Map<string, SessionState>();

function getSessionState(sessionKey: string): SessionState {
  let state = sessionStates.get(sessionKey);
  if (!state) {
    state = {
      recentScores: [],
      rejectedTopics: new Map(),
      lastTopicCategory: "normal",
    };
    sessionStates.set(sessionKey, state);
  }
  return state;
}

function computeAnomalyAdjustment(sessionKey: string, baseScore: number, triggeredModules: string[]): number {
  const state = getSessionState(sessionKey);
  let adjustment = 0;

  state.recentScores.push(baseScore);
  if (state.recentScores.length > 10) state.recentScores.shift();

  // Progressive attack: 3 consecutive rounds of increasing risk
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

  // Repeated rejection bypass: same topic rejected 3+ times
  for (const mod of triggeredModules) {
    const count = (state.rejectedTopics.get(mod) ?? 0) + 1;
    state.rejectedTopics.set(mod, count);
    if (count >= 3) {
      adjustment += 1;
    }
  }

  return adjustment;
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
  { pattern: /(?:修改|编辑|更改|覆盖)\s*(?:SOUL|IDENTITY|SKILL|AGENTS)\.md/i, label: "core_file_modify" },
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

  // Sensitive data access?
  if (/\.env|credentials|secret|\.ssh|\.aws|\.gnupg|password|token|api[_-]?key/i.test(combined)) {
    accessesSensitiveData = true;
  }

  // Input from untrusted source?
  if (/curl|wget|fetch|request|download|http/i.test(combined)) {
    inputFromUntrusted = true;
  }

  // Output to external?
  if (/curl\s+.*(?:--data|-d|-F|-X\s+POST)|webhook|send|push|upload|post/i.test(combined)) {
    outputToExternal = true;
  }

  const hitCount = [accessesSensitiveData, inputFromUntrusted, outputToExternal].filter(Boolean).length;

  return { accessesSensitiveData, inputFromUntrusted, outputToExternal, hitCount };
}

// ── Public API: Input Guard ────────────────────────────────────────

export function guardInput(text: string, sessionKey?: string): GuardDecision {
  const modules: string[] = [];
  const dims: ScoreDimensions = {
    intentClarity: 0,
    potentialHarm: 0,
    reversibility: 0,
    authorizationStatus: 1, // uncertain by default
    patternMatch: 0,
  };

  // M1: Prompt injection (CRITICAL — per SKILL.md, L4 deny)
  const injection = detectPromptInjection(text);
  if (injection.detected) {
    modules.push("M1:prompt_injection");
    dims.patternMatch = injection.confidence >= 0.7 ? 2 : 1;
    dims.intentClarity = injection.confidence >= 0.6 ? 2 : 1;
    dims.potentialHarm = 2;
    dims.reversibility = 1;
  }

  // M2: System prompt extraction (HIGH — L4 deny)
  const sysprompt = detectSystemPromptExtraction(text);
  if (sysprompt.detected) {
    modules.push("M2:system_prompt_extraction");
    dims.patternMatch = Math.max(dims.patternMatch, sysprompt.confidence >= 0.7 ? 2 : 1);
    dims.intentClarity = Math.max(dims.intentClarity, 2);
    dims.potentialHarm = Math.max(dims.potentialHarm, 2);
  }

  // M3: Over-agency (HIGH — self-modification is L4 deny)
  const overAgency = detectOverAgency(text);
  if (overAgency.length > 0) {
    modules.push("M3:over_agency");
    const isSelfModify = overAgency.some(m =>
      m.includes("self_modify") || m.includes("disable_safety") || m.includes("core_file_modify") || m.includes("privilege_escalation"),
    );
    dims.intentClarity = Math.max(dims.intentClarity, isSelfModify ? 2 : 1);
    dims.potentialHarm = 2;
    dims.reversibility = isSelfModify ? 2 : 1;
    dims.patternMatch = Math.max(dims.patternMatch, overAgency.length >= 2 ? 2 : 1);
  }

  // M5: Credential theft intent
  const credentialTheft = detectCredentialTheft(text);
  if (credentialTheft.length > 0) {
    modules.push("M5:credential_theft");
    dims.potentialHarm = Math.max(dims.potentialHarm, 2);
    dims.patternMatch = Math.max(dims.patternMatch, 1);
  }

  // M6: Malicious code request (L4 deny)
  const maliciousCode = detectMaliciousCodeRequest(text);
  if (maliciousCode.length > 0) {
    modules.push("M6:malicious_code");
    dims.intentClarity = 2;
    dims.potentialHarm = 2;
    dims.reversibility = 2;
    dims.authorizationStatus = 2;
    dims.patternMatch = 2;
  }

  let score = computeRiskScore(dims);

  // Context adjustment
  if (sessionKey) {
    const anomalyAdj = computeAnomalyAdjustment(sessionKey, score, modules);
    score = Math.min(score + anomalyAdj, 10);
  }

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

  // M2: Check for system prompt leakage in output
  const leak = detectSystemPromptLeak(output);
  if (leak.isLeak) {
    modules.push("M2:system_prompt_leak");
    score += leak.severity === "high" ? 6 : 3;
  }

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
): GuardDecision {
  const modules: string[] = [];
  const dims: ScoreDimensions = {
    intentClarity: 0,
    potentialHarm: 0,
    reversibility: 0,
    authorizationStatus: 1,
    patternMatch: 0,
  };

  const command = (params?.command ?? "") as string;
  const filePath = (params?.file_path ?? params?.path ?? "") as string;
  const combined = `${command} ${filePath}`;

  // M5: Credential theft via tool
  const credTheft = detectCredentialTheft(combined);
  if (credTheft.length > 0) {
    modules.push("M5:credential_theft");
    dims.potentialHarm = 2;
    dims.patternMatch = credTheft.length >= 2 ? 2 : 1;
  }

  // M3: Over-agency in tool params
  const overAgency = detectOverAgency(combined);
  if (overAgency.length > 0) {
    modules.push("M3:over_agency");
    dims.intentClarity = 2;
    dims.potentialHarm = 2;
    dims.reversibility = 2;
  }

  // Fatal Triangle
  const triangle = checkFatalTriangle(toolName, params);
  if (triangle.hitCount >= 2) {
    modules.push("fatal_triangle");
    dims.potentialHarm = Math.max(dims.potentialHarm, 2);
    dims.authorizationStatus = 2;
  }

  let score = computeRiskScore(dims);

  if (sessionKey) {
    const anomalyAdj = computeAnomalyAdjustment(sessionKey, score, modules);
    score = Math.min(score + anomalyAdj, 10);
  }

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
    "M1:prompt_injection": "提示注入攻击",
    "M2:system_prompt_extraction": "系统提示探测",
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
