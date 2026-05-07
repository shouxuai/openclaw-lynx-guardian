import { describe, it, expect } from "vitest";
import { buildOverridePrompt, normalizePolicyConfig, resolveRiskPolicy } from "../src/runtime/policy-runtime.js";
import type { RiskAssessment } from "../src/guard/safety-guard.js";
import { inferBlacklistModules } from "../src/runtime/override-runtime.js";

const BASE_CONFIG = {
  allowOneTimeOverrideLevels: ["L2", "L3", "L4"] as const,
  confirmationPhrase: "确认放行本次操作",
  moduleOverrides: { M3: { allowOneTimeOverride: true } },
};

describe("Risk Policy Resolver", () => {
  it("does not default to the deprecated free-text confirmation phrase", () => {
    const config = normalizePolicyConfig({});

    expect(config.confirmationPhrase).toBeUndefined();
    expect(config.deprecatedConfirmationPhrase).toBeUndefined();
    expect(buildOverridePrompt("high-risk action")).not.toContain("确认放行本次操作");
  });

  it("does not allow override for M2:protected_file_access at L4 score=9", () => {
    const assessment: RiskAssessment = {
      level: "L4",
      score: 9,
      modules: ["M2:protected_file_access"],
      description: "protected file access",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.finalAction).toBe("deny");
    expect(result.override.allowed).toBe(false);
    expect(result.override.confirmationPhrase).toBeUndefined();
    expect(result.override.reason).toBe("level_not_allowed");
  });

  it("does not allow override for M2:protected_file_access at score=10 (anomaly inflation)", () => {
    const assessment: RiskAssessment = {
      level: "L4",
      score: 10,
      modules: ["M2:protected_file_access"],
      description: "protected file access",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.finalAction).toBe("deny");
    expect(result.override.allowed).toBe(false);
    expect(result.override.confirmationPhrase).toBeUndefined();
    expect(result.override.reason).toBe("level_not_allowed");
  });

  it("filters L4 out of normalized approval levels", () => {
    const config = normalizePolicyConfig({
      allowOneTimeOverrideLevels: ["L2", "L4"],
      confirmationPhrase: "确认放行本次操作",
    });

    expect(config.approvableRiskLevels).toEqual(["L2"]);
    expect(config.allowOneTimeOverrideLevels).toEqual(["L2"]);
  });

  it("hard-denies M3:over_agency even when explicitly configured", () => {
    const assessment: RiskAssessment = {
      level: "L3",
      score: 7,
      modules: ["M3:over_agency"],
      description: "over agency",
      action: "block",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.finalAction).toBe("deny");
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("module_not_allowed");
  });

  it("never allows override for plugin integrity", () => {
    const result = resolveRiskPolicy({
      level: "L4",
      score: 9,
      modules: ["M2:plugin_integrity"],
      description: "plugin integrity lock",
      action: "deny",
    }, BASE_CONFIG);

    expect(result.finalAction).toBe("deny");
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("module_not_allowed");
  });

  it("never allows override for remote access control or system availability", () => {
    for (const mod of ["M3:remote_access_control", "M3:system_availability"]) {
      const result = resolveRiskPolicy({
        level: "L4",
        score: 9,
        modules: [mod],
        description: mod,
        action: "deny",
      }, BASE_CONFIG);

      expect(result.finalAction, mod).toBe("deny");
      expect(result.override.allowed, mod).toBe(false);
      expect(result.override.reason, mod).toBe("module_not_allowed");
    }
  });

  it("hard-denies M1:prompt_injection regardless of score or level config", () => {
    const assessment: RiskAssessment = {
      level: "L4",
      score: 9,
      modules: ["M1:prompt_injection"],
      description: "prompt injection",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.override.allowed).toBe(false);
    expect(result.override.confirmationPhrase).toBeUndefined();
    expect(result.override.reason).toBe("module_not_allowed");
  });

  it("hard-denies M5:credential_theft with reason=credential_theft", () => {
    const assessment: RiskAssessment = {
      level: "L3",
      score: 8,
      modules: ["M5:credential_theft"],
      description: "credential theft",
      action: "block",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("credential_theft");
  });

  it("hard-denies M6:malicious_code", () => {
    const assessment: RiskAssessment = {
      level: "L4",
      score: 10,
      modules: ["M6:malicious_code"],
      description: "malicious code",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("module_not_allowed");
  });

  it("hard-denies fatal_triangle", () => {
    const assessment: RiskAssessment = {
      level: "L4",
      score: 9,
      modules: ["fatal_triangle"],
      description: "fatal triangle",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("module_not_allowed");
  });

  it("hard-denies download-and-execute blacklist hits instead of routing them to overridable M3", () => {
    const modules = inferBlacklistModules(
      "exec",
      "download + chmod +x chain (download and execute)",
    );
    const assessment: RiskAssessment = {
      level: "L4",
      score: 9,
      modules,
      description: "download and execute chain",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(modules).not.toEqual(["M3:over_agency"]);
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("module_not_allowed");
  });

  it("hard-denies when any module in the list is non-overridable", () => {
    const assessment: RiskAssessment = {
      level: "L4",
      score: 10,
      modules: ["M2:protected_file_access", "M5:credential_theft"],
      description: "mixed risk",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("credential_theft");
  });

  it("hard-denies M3 when moduleOverrides.M3.allowOneTimeOverride is not set", () => {
    const assessment: RiskAssessment = {
      level: "L3",
      score: 7,
      modules: ["M3:over_agency"],
      description: "over agency",
      action: "block",
    };
    const result = resolveRiskPolicy(assessment, {
      allowOneTimeOverrideLevels: ["L3"],
      confirmationPhrase: "确认放行本次操作",
    });
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("module_not_allowed");
  });

  it("denies override when level is below allowOneTimeOverrideLevels threshold", () => {
    const assessment: RiskAssessment = {
      level: "L2",
      score: 5,
      modules: ["M2:protected_file_access"],
      description: "protected file access",
      action: "warn",
    };
    const result = resolveRiskPolicy(assessment, {
      allowOneTimeOverrideLevels: ["L3", "L4"],
      confirmationPhrase: "确认放行本次操作",
    });
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("level_not_allowed");
  });

  it("hard-denies M2:protected_file_access when disabled via moduleOverrides", () => {
    const assessment: RiskAssessment = {
      level: "L4",
      score: 9,
      modules: ["M2:protected_file_access"],
      description: "protected file access",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, {
      ...BASE_CONFIG,
      moduleOverrides: {
        M2: { protectedFileAccess: { allowOneTimeOverride: false } },
        M3: { allowOneTimeOverride: true },
      },
    });
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("module_not_allowed");
  });
});
