import type { RiskAssessment, RiskLevel } from "./safety-guard.js";

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

// ── Module Override Eligibility ────────────────────────────────────
//
// Defines which modules support a one-time user-confirmation override.
//
// Hard-deny modules (false / absent): the operation is rejected outright,
// no confirmation phrase will be offered, regardless of score.
//
// Overridable modules (true): the risk level (derived from score) is still
// checked against allowOneTimeOverrideLevels — score still matters, but
// absoluteRejectScore is NOT applied as an additional ceiling, so anomaly-
// driven score inflation cannot permanently silence the confirmation prompt.

const MODULE_OVERRIDE_ELIGIBLE: Record<string, boolean> = {
  // Potentially legitimate access by the workspace owner
  "M0:identity_verification":  true,
  "M2:protected_file_access":  true,
  // Self-modification / privilege escalation — configurable, default on
  "M2:plugin_integrity":       false,
  "M3:over_agency":            false,
  "M3:remote_access_control":  false,
  "M3:system_availability":    false,
  // The following are always hard-deny
  "M1:prompt_injection":       false,
  "M2:system_prompt_extraction": false,
  "M2:system_prompt_leak":     false,
  "M5:credential_theft":       false,
  "M6:malicious_code":         false,
  "fatal_triangle":            false,
};

function isModuleOverridable(mod: string, config: RiskPolicyConfig): boolean {
  const eligible = MODULE_OVERRIDE_ELIGIBLE[mod];
  // Unknown module → treat as hard-deny for safety
  if (eligible === undefined || eligible === false) return false;
  // M3 requires explicit opt-in via moduleOverrides
  if (mod.startsWith("M3:")) {
    return config.moduleOverrides?.M3?.allowOneTimeOverride === true;
  }
  // M2:protected_file_access can be disabled via moduleOverrides
  if (mod === "M2:protected_file_access") {
    const m2cfg = config.moduleOverrides?.M2?.protectedFileAccess;
    return m2cfg === undefined || m2cfg.allowOneTimeOverride !== false;
  }
  return true;
}

/**
 * Returns true when every triggered module supports one-time override.
 * An empty module list is treated as hard-deny (anomalous state).
 */
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
    // At least one hard-deny module — reject without offering a confirmation phrase.
    finalAction = "deny";
    reason = assessment.modules.some((m) => m.startsWith("M5:"))
      ? "credential_theft"
      : "module_not_allowed";
  } else {
    // All triggered modules support override.
    // Score still drives the level; level is checked against allowOneTimeOverrideLevels.
    // absoluteRejectScore is intentionally NOT re-checked here: anomaly-driven score
    // inflation on overridable modules should not silence the confirmation prompt.
    const allowedLevels = config.approvableRiskLevels ?? config.allowOneTimeOverrideLevels ?? [];
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
