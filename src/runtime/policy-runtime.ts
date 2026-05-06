import type { WorkflowAuthorization } from "../approval/approval-bridge.js";
import type { RiskAssessment, RiskLevel } from "../guard/safety-guard.js";

const DEFAULT_APPROVABLE_LEVELS = ["L2", "L3"] as const;
const APPROVABLE_RISK_LEVELS = new Set<RiskLevel>(["L2", "L3"]);

export type PolicyDecisionKind = "allow" | "warn" | "confirm" | "workflow_auth" | "block" | "deny";
export type RiskLevelLabel = RiskLevel;

export interface PolicyRuntimeEvaluation {
  riskLevelLabel: RiskLevelLabel;
  riskLevelValue: 0 | 1 | 2 | 3 | 4;
  decision: {
    kind: PolicyDecisionKind;
  };
  legacyRiskLevel: 0 | 1 | 2 | 3 | 4;
}

export interface GuardPolicyResolution {
  legacyEvaluation: PolicyRuntimeEvaluation;
  finalDecision: {
    kind: PolicyDecisionKind;
  };
  effectiveAssessment: RiskAssessment;
}

export interface GuardPolicyTrace {
  stage: string;
  shouldWarn: boolean;
  raw: {
    level: RiskAssessment["level"];
    score: number;
    modules: string[];
    action: RiskAssessment["action"];
    block: boolean;
    description: string;
  };
  legacy: {
    riskLevel: RiskLevelLabel;
    decision: PolicyDecisionKind;
    riskValue: 0 | 1 | 2 | 3 | 4;
  };
  final: {
    decision: PolicyDecisionKind;
    level: RiskAssessment["level"];
    score: number;
    modules: string[];
    action: RiskAssessment["action"];
    description: string;
  };
}

export interface RiskPolicyConfig {
  absoluteRejectScore?: number;
  confirmationPhrase?: string;
  approvableRiskLevels?: RiskLevel[];
  allowOneTimeOverrideLevels?: RiskLevel[];
  toolApprovalTimeoutSeconds?: number;
  grantWindowSeconds?: number;
  workflowAuthWindowSeconds?: number;
  moduleOverrides?: {
    M2?: {
      protectedFileAccess?: { allowOneTimeOverride?: boolean };
    };
    M3?: {
      allowOneTimeOverride?: boolean;
    };
  };
}

export interface RiskPolicyOverrideResult {
  allowed: boolean;
  confirmationPhrase?: string;
  reason?: RiskPolicyOverrideReason;
}

export type RiskPolicyOverrideReason =
  | "credential_theft"
  | "level_not_allowed"
  | "module_not_allowed";

export interface RiskPolicyResult {
  finalAction: RiskAssessment["action"];
  override: RiskPolicyOverrideResult;
}

const MODULE_OVERRIDE_ELIGIBLE: Record<string, boolean> = {
  "M0:identity_verification": true,
  "M2:memory_session_privacy": false,
  "M2:protected_file_access": true,
  "M2:runtime_config_integrity": false,
  "M2:plugin_integrity": false,
  "M3:over_agency": false,
  "M3:remote_access_control": false,
  "M3:system_availability": false,
  "M1:prompt_injection": false,
  "M2:system_prompt_extraction": false,
  "M2:system_prompt_leak": false,
  "M5:credential_theft": false,
  "M6:malicious_code": false,
  "fatal_triangle": false,
};

function isModuleOverridable(mod: string, config: RiskPolicyConfig): boolean {
  const eligible = MODULE_OVERRIDE_ELIGIBLE[mod];
  if (eligible === undefined || eligible === false) return false;
  if (mod.startsWith("M3:")) {
    return config.moduleOverrides?.M3?.allowOneTimeOverride === true;
  }
  if (mod === "M2:protected_file_access") {
    const m2cfg = config.moduleOverrides?.M2?.protectedFileAccess;
    return m2cfg === undefined || m2cfg.allowOneTimeOverride !== false;
  }
  return true;
}

function areAllModulesOverridable(modules: string[], config: RiskPolicyConfig): boolean {
  if (modules.length === 0) return false;
  return modules.every((mod) => isModuleOverridable(mod, config));
}

export function resolveRiskPolicy(
  assessment: RiskAssessment,
  config: RiskPolicyConfig = {},
): RiskPolicyResult {
  let finalAction = assessment.action;
  let overrideAllowed = false;
  let confirmationPhrase: string | undefined;
  let reason: RiskPolicyOverrideReason | undefined;

  if (!areAllModulesOverridable(assessment.modules, config)) {
    finalAction = "deny";
    reason = assessment.modules.some((m) => m.startsWith("M5:"))
      ? "credential_theft"
      : "module_not_allowed";
  } else if (assessment.level === "L4") {
    finalAction = "deny";
    reason = "level_not_allowed";
  } else {
    const allowedLevels = normalizeApprovableRiskLevels(
      config.approvableRiskLevels ?? config.allowOneTimeOverrideLevels ?? [],
    );
    overrideAllowed = allowedLevels.includes(assessment.level);
    if (!overrideAllowed) {
      reason = "level_not_allowed";
    } else if (config.confirmationPhrase) {
      confirmationPhrase = config.confirmationPhrase;
    }
  }

  return {
    finalAction,
    override: { allowed: overrideAllowed, confirmationPhrase, reason },
  };
}

function normalizeApprovableRiskLevels(value: unknown): RiskLevel[] {
  const levels = Array.isArray(value) ? value : [];
  return levels.filter((level): level is RiskLevel =>
    typeof level === "string" && APPROVABLE_RISK_LEVELS.has(level as RiskLevel),
  );
}

interface GuardEvidenceBundleLike {
  modules?: string[];
  summary?: string;
  evidenceItems?: unknown[];
}

function normalizeConfirmationPhrase(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizePolicyConfig(policy: any = {}) {
  const approvableRiskLevels = normalizeApprovableRiskLevels(
    policy.approvableRiskLevels
    ?? policy.allowOneTimeOverrideLevels
    ?? [...DEFAULT_APPROVABLE_LEVELS],
  );
  const toolApprovalTimeoutSeconds = Math.max(
    30,
    Number(policy.toolApprovalTimeoutSeconds ?? 120),
  );
  const grantWindowSeconds = Math.min(
    900,
    Math.max(
      30,
      Number(policy.grantWindowSeconds ?? policy.workflowAuthWindowSeconds ?? 180),
    ),
  );

  const confirmationPhrase = normalizeConfirmationPhrase(policy.confirmationPhrase);
  return {
    absoluteRejectScore: policy.absoluteRejectScore ?? 10,
    confirmationPhrase,
    deprecatedConfirmationPhrase: confirmationPhrase,
    approvableRiskLevels,
    allowOneTimeOverrideLevels: approvableRiskLevels,
    moduleOverrides: {
      M3: {
        allowOneTimeOverride: policy.moduleOverrides?.M3?.allowOneTimeOverride ?? true,
      },
    },
    toolApprovalTimeoutMs: toolApprovalTimeoutSeconds * 1000,
    grantWindowMs: grantWindowSeconds * 1000,
    overrideTtlMs: grantWindowSeconds * 1000,
    workflowAuthWindowMs: grantWindowSeconds * 1000,
  };
}

function riskLevelValueFromLabel(label: RiskLevelLabel): 0 | 1 | 2 | 3 | 4 {
  switch (label) {
    case "L4":
      return 4;
    case "L3":
      return 3;
    case "L2":
      return 2;
    case "L1":
      return 1;
    default:
      return 0;
  }
}

function mapAssessmentActionToPolicyKind(
  action: RiskAssessment["action"],
): PolicyDecisionKind {
  switch (action) {
    case "deny":
      return "deny";
    case "block":
      return "block";
    case "warn":
    case "log":
      return "warn";
    default:
      return "allow";
  }
}

export function evaluateRiskAssessment(
  assessment: RiskAssessment,
  _options?: {
    workflowCandidate?: boolean;
    workflowAuthorized?: boolean;
    isAuditWhitelisted?: boolean;
    auditBoundaryExceeded?: boolean;
  },
): PolicyRuntimeEvaluation {
  const riskLevelLabel = assessment.level;
  const riskLevelValue = riskLevelValueFromLabel(riskLevelLabel);
  const decisionKind = mapAssessmentActionToPolicyKind(assessment.action);

  return {
    riskLevelLabel,
    riskLevelValue,
    decision: {
      kind: decisionKind,
    },
    legacyRiskLevel: riskLevelValue,
  };
}

export function evaluateGuardDecisionPolicy(input: {
  assessment: RiskAssessment;
  evidenceBundle?: GuardEvidenceBundleLike;
  options?: {
    workflowCandidate?: boolean;
    workflowAuthorized?: boolean;
    isAuditWhitelisted?: boolean;
    auditBoundaryExceeded?: boolean;
  };
}): GuardPolicyResolution {
  const legacyEvaluation = evaluateRiskAssessment(input.assessment, input.options);

  return {
    legacyEvaluation,
    finalDecision: legacyEvaluation.decision,
    effectiveAssessment: input.assessment,
  };
}

export function buildPolicyRecordContent(
  evaluation: PolicyRuntimeEvaluation,
  content: string,
): string {
  return `[policy:${evaluation.riskLevelLabel}/${evaluation.decision.kind}] ${content}`;
}

function assessmentBlocks(assessment: RiskAssessment): boolean {
  return assessment.action === "block" || assessment.action === "deny";
}

export function buildGuardPolicyTrace(input: {
  stage: string;
  assessment: RiskAssessment;
  resolution: GuardPolicyResolution;
}): GuardPolicyTrace {
  const final = input.resolution.effectiveAssessment;
  const shouldWarn =
    assessmentBlocks(input.assessment)
    || input.assessment.modules.length > 0
    || input.resolution.finalDecision.kind !== "allow"
    || final.modules.length > 0;

  return {
    stage: input.stage,
    shouldWarn,
    raw: {
      level: input.assessment.level,
      score: input.assessment.score,
      modules: input.assessment.modules,
      action: input.assessment.action,
      block: assessmentBlocks(input.assessment),
      description: input.assessment.description,
    },
    legacy: {
      riskLevel: input.resolution.legacyEvaluation.riskLevelLabel,
      decision: input.resolution.legacyEvaluation.decision.kind,
      riskValue: input.resolution.legacyEvaluation.riskLevelValue,
    },
    final: {
      decision: input.resolution.finalDecision.kind,
      level: final.level,
      score: final.score,
      modules: final.modules,
      action: final.action,
      description: final.description,
    },
  };
}

export function buildApiRiskAssessment(
  riskLevel: number,
  description: string,
): RiskAssessment {
  if (riskLevel >= 3) {
    return { level: "L4", score: 9, modules: [], description, action: "deny" };
  }
  if (riskLevel === 2) {
    return { level: "L2", score: 6, modules: [], description, action: "block" };
  }
  if (riskLevel === 1) {
    return { level: "L1", score: 3, modules: [], description, action: "warn" };
  }
  return { level: "L0", score: 0, modules: [], description, action: "allow" };
}

export function buildOverridePrompt(message: string, confirmationPhrase?: string): string {
  if (!confirmationPhrase) {
    return message;
  }
  return `${message} 如确认放行本次工作流中的此类操作，请回复"${confirmationPhrase}"。`;
}

const MODULE_DISPLAY_NAMES: Record<string, string> = {
  "M0:identity_verification": "身份声明",
  "M2:protected_file_access": "核心配置文件访问",
  "M3:over_agency": "过度代理/权限提升",
};

function moduleDisplayName(mod: string): string {
  return MODULE_DISPLAY_NAMES[mod] ?? mod;
}

export function buildParamSummary(toolName: string, params: Record<string, any>): string {
  if (toolName === "exec") return String(params?.command ?? "").slice(0, 120);
  return String(params?.path ?? params?.file_path ?? JSON.stringify(params)).slice(0, 120);
}

export function formatWorkflowAuthSummary(auth: WorkflowAuthorization): string {
  const durationSec = Math.round((Date.now() - auth.grantedAt) / 1000);
  const moduleNames = auth.allowedModules.map(moduleDisplayName).join("、");
  const scopeDesc = auth.scopeAll ? "全模块（时间窗口）" : moduleNames;
  const lines: string[] = [
    "📘 **[Lynx Guardian] 工作流授权已回收**",
    "",
    `授权范围：${scopeDesc}`,
    `工作流时长：${durationSec}s`,
    `放行操作记录（共 ${auth.auditLog.length} 次）：`,
  ];
  auth.auditLog.forEach((entry, index) => {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour12: false });
    lines.push(`  ${index + 1}. [${timestamp}] ${entry.toolName}: ${entry.paramSummary}`);
  });
  if (auth.auditLog.length === 0) {
    lines.push("  （工作流中未产生实际放行操作）");
  }
  return lines.join("\n");
}
