import { decidePolicy } from "../guard/policy/policy-engine.js";
import type { GuardEvidenceBundle } from "../guard/policy/evidence-bundle.js";
import { scoreEvidence } from "../guard/policy/evidence-scorer.js";
import type { EvidenceScoreResult } from "../guard/policy/evidence-scorer.js";
import { resolveRiskLevel } from "../guard/policy/policy-engine.js";
import type { PolicyDecisionKind, ResolvedRiskLevel, RiskLevelLabel } from "../guard/policy/policy-types.js";
import type { RiskAssessment } from "../guard/safety-guard.js";
import { toLegacyRiskLevel } from "./api-risk-adapter.js";
import type { WorkflowAuthorization } from "./workflow-authorization-store.js";

const DEFAULT_CONFIRMATION_PHRASE = "确认放行本次操作";
const DEFAULT_APPROVABLE_LEVELS = ["L2", "L3"] as const;

const POLICY_DECISION_PRIORITY: Record<PolicyDecisionKind, number> = {
  allow: 0,
  warn: 1,
  confirm: 2,
  workflow_auth: 2,
  block: 3,
  deny: 4,
};

export interface PolicyRuntimeEvaluation extends ResolvedRiskLevel {
  decision: {
    kind: PolicyDecisionKind;
  };
  legacyRiskLevel: 0 | 1 | 2 | 3 | 4;
}

export interface EvidenceBundleRuntimeEvaluation extends PolicyRuntimeEvaluation {
  score: EvidenceScoreResult;
  compatibilityAssessment: CompatibilityRiskAssessment;
}

export interface GuardPolicyResolution {
  legacyEvaluation: PolicyRuntimeEvaluation;
  bundleEvaluation?: EvidenceBundleRuntimeEvaluation;
  finalDecision: {
    kind: PolicyDecisionKind;
  };
  effectiveAssessment: RiskAssessment;
}

export interface CompatibilityRiskAssessment extends RiskAssessment {
  policyDecisionKind: PolicyDecisionKind;
}

export function normalizePolicyConfig(policy: any = {}) {
  const approvableRiskLevels =
    policy.approvableRiskLevels
    ?? policy.allowOneTimeOverrideLevels
    ?? [...DEFAULT_APPROVABLE_LEVELS];
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

  return {
    absoluteRejectScore: policy.absoluteRejectScore ?? 10,
    confirmationPhrase: policy.confirmationPhrase ?? DEFAULT_CONFIRMATION_PHRASE,
    deprecatedConfirmationPhrase: policy.confirmationPhrase ?? DEFAULT_CONFIRMATION_PHRASE,
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

function pickStricterPolicyKind(
  left: PolicyDecisionKind,
  right: PolicyDecisionKind,
): PolicyDecisionKind {
  return POLICY_DECISION_PRIORITY[left] >= POLICY_DECISION_PRIORITY[right]
    ? left
    : right;
}

function pickFinalPolicyKind(
  legacyKind: PolicyDecisionKind,
  bundleKind: PolicyDecisionKind,
): PolicyDecisionKind {
  const legacyPriority = POLICY_DECISION_PRIORITY[legacyKind];
  const bundlePriority = POLICY_DECISION_PRIORITY[bundleKind];

  if (bundlePriority > legacyPriority) {
    return bundleKind;
  }

  if (bundlePriority < legacyPriority) {
    return legacyKind;
  }

  if (legacyKind === "confirm" && bundleKind === "workflow_auth") {
    return bundleKind;
  }

  return legacyKind;
}

export function evaluateRiskAssessment(
  assessment: RiskAssessment,
  options?: {
    workflowCandidate?: boolean;
    workflowAuthorized?: boolean;
    isAuditWhitelisted?: boolean;
    auditBoundaryExceeded?: boolean;
  },
): PolicyRuntimeEvaluation {
  const riskLevelLabel = assessment.level as RiskLevelLabel;
  const riskLevelValue = riskLevelValueFromLabel(riskLevelLabel);
  const policyDecision = decidePolicy({
    riskLevelLabel,
    riskLevelValue,
    workflowCandidate: options?.workflowCandidate,
    workflowAuthorized: options?.workflowAuthorized,
    isAuditWhitelisted: options?.isAuditWhitelisted ?? false,
    auditBoundaryExceeded: options?.auditBoundaryExceeded,
  });
  const bridgedDecisionKind = pickStricterPolicyKind(
    policyDecision.kind,
    mapAssessmentActionToPolicyKind(assessment.action),
  );

  return {
    riskLevelLabel,
    riskLevelValue,
    decision: {
      kind: bridgedDecisionKind,
    },
    legacyRiskLevel: toLegacyRiskLevel(riskLevelValue),
  };
}

function mapPolicyKindToAssessmentAction(
  policyKind: PolicyDecisionKind,
): RiskAssessment["action"] {
  switch (policyKind) {
    case "allow":
      return "allow";
    case "deny":
      return "deny";
    case "block":
      return "block";
    default:
      return "warn";
  }
}

export function evaluateEvidenceBundle(
  bundle: GuardEvidenceBundle,
): EvidenceBundleRuntimeEvaluation {
  const score = scoreEvidence(bundle.evidenceItems);
  const resolvedRisk = resolveRiskLevel({
    summaryHeat: score.summaryHeat,
    dimensionScores: score.dimensionScores,
    chainProgress: bundle.chainProgress,
    isAuditWhitelisted: bundle.isAuditWhitelisted ?? false,
  });
  const decision = decidePolicy({
    ...resolvedRisk,
    workflowCandidate: bundle.workflowCandidate,
    workflowAuthorized: bundle.workflowAuthorized,
    isAuditWhitelisted: bundle.isAuditWhitelisted ?? false,
    auditBoundaryExceeded: bundle.auditBoundaryExceeded,
  });

  return {
    ...resolvedRisk,
    decision,
    legacyRiskLevel: toLegacyRiskLevel(resolvedRisk.riskLevelValue),
    score,
    compatibilityAssessment: {
      level: resolvedRisk.riskLevelLabel,
      score: score.compatibilityScore,
      modules: bundle.modules,
      description: bundle.summary,
      action: mapPolicyKindToAssessmentAction(decision.kind),
      policyDecisionKind: decision.kind,
    },
  };
}

export function evaluateGuardDecisionPolicy(input: {
  assessment: RiskAssessment;
  evidenceBundle?: GuardEvidenceBundle;
  options?: {
    workflowCandidate?: boolean;
    workflowAuthorized?: boolean;
    isAuditWhitelisted?: boolean;
    auditBoundaryExceeded?: boolean;
  };
}): GuardPolicyResolution {
  const legacyEvaluation = evaluateRiskAssessment(input.assessment, input.options);

  if (!input.evidenceBundle) {
    return {
      legacyEvaluation,
      finalDecision: legacyEvaluation.decision,
      effectiveAssessment: input.assessment,
    };
  }

  const bundleEvaluation = evaluateEvidenceBundle({
    ...input.evidenceBundle,
    workflowCandidate: input.evidenceBundle.workflowCandidate ?? input.options?.workflowCandidate,
    workflowAuthorized: input.evidenceBundle.workflowAuthorized ?? input.options?.workflowAuthorized,
    isAuditWhitelisted: input.evidenceBundle.isAuditWhitelisted ?? input.options?.isAuditWhitelisted,
    auditBoundaryExceeded:
      input.evidenceBundle.auditBoundaryExceeded ?? input.options?.auditBoundaryExceeded,
  });
  const finalKind = pickFinalPolicyKind(legacyEvaluation.decision.kind, bundleEvaluation.decision.kind);
  const bundleIsSelected = finalKind === bundleEvaluation.decision.kind
    && (
      finalKind !== legacyEvaluation.decision.kind
      || bundleEvaluation.decision.kind === "workflow_auth"
    );

  return {
    legacyEvaluation,
    bundleEvaluation,
    finalDecision: {
      kind: finalKind,
    },
    effectiveAssessment: bundleIsSelected
      ? bundleEvaluation.compatibilityAssessment
      : input.assessment,
  };
}

export function buildPolicyRecordContent(
  evaluation: PolicyRuntimeEvaluation,
  content: string,
): string {
  return `[policy:${evaluation.riskLevelLabel}/${evaluation.decision.kind}] ${content}`;
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

export function buildOverridePrompt(message: string, confirmationPhrase: string): string {
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
    "📣 **[Lynx Guardian] 工作流授权已回收**",
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
