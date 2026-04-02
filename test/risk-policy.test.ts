import { describe, it, expect } from "vitest";
import { resolveRiskPolicy } from "../src/guard/risk-policy.js";
import type { RiskAssessment } from "../src/guard/safety-guard.js";

const BASE_CONFIG = {
  allowOneTimeOverrideLevels: ["L2", "L3", "L4"] as const,
  confirmationPhrase: "确认放行本次操作",
  moduleOverrides: { M3: { allowOneTimeOverride: true } },
};

describe("Risk Policy Resolver", () => {
  // ── 可放行模块 ────────────────────────────────────────────────────

  it("allows override for M2:protected_file_access at L4 score=9", () => {
    const assessment: RiskAssessment = {
      level: "L4",
      score: 9,
      modules: ["M2:protected_file_access"],
      description: "核心配置文件访问",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.override.allowed).toBe(true);
    expect(result.override.confirmationPhrase).toBe("确认放行本次操作");
    expect(result.override.reason).toBeUndefined();
  });

  it("allows override for M2:protected_file_access at score=10 (anomaly inflation)", () => {
    // This is the core regression: anomaly counter pushes score to 10,
    // but the module itself is overridable — the confirmation prompt must still appear.
    const assessment: RiskAssessment = {
      level: "L4",
      score: 10,
      modules: ["M2:protected_file_access"],
      description: "核心配置文件访问",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.override.allowed).toBe(true);
    expect(result.override.confirmationPhrase).toBe("确认放行本次操作");
    expect(result.override.reason).toBeUndefined();
  });

  it("allows override for M3:over_agency when explicitly configured", () => {
    const assessment: RiskAssessment = {
      level: "L3",
      score: 7,
      modules: ["M3:over_agency"],
      description: "over agency",
      action: "block",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.override.allowed).toBe(true);
    expect(result.override.confirmationPhrase).toBe("确认放行本次操作");
    expect(result.override.reason).toBeUndefined();
  });

  // ── 硬拒绝模块 ───────────────────────────────────────────────────

  it("hard-denies M1:prompt_injection regardless of score or level config", () => {
    const assessment: RiskAssessment = {
      level: "L4",
      score: 9,
      modules: ["M1:prompt_injection"],
      description: "提示注入",
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
      description: "凭证窃取",
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
      description: "恶意代码",
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
      description: "致命三角",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("module_not_allowed");
  });

  it("hard-denies when any module in the list is non-overridable", () => {
    // M2:protected_file_access alone is fine, but combined with M5 it must hard-deny
    const assessment: RiskAssessment = {
      level: "L4",
      score: 10,
      modules: ["M2:protected_file_access", "M5:credential_theft"],
      description: "混合风险",
      action: "deny",
    };
    const result = resolveRiskPolicy(assessment, BASE_CONFIG);
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("credential_theft");
  });

  // ── M3 配置控制 ───────────────────────────────────────────────────

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
      // no moduleOverrides → M3 defaults to not allowed
    });
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("module_not_allowed");
  });

  // ── Level 级别控制 ────────────────────────────────────────────────

  it("denies override when level is below allowOneTimeOverrideLevels threshold", () => {
    const assessment: RiskAssessment = {
      level: "L2",
      score: 5,
      modules: ["M2:protected_file_access"],
      description: "核心配置文件访问",
      action: "warn",
    };
    const result = resolveRiskPolicy(assessment, {
      allowOneTimeOverrideLevels: ["L3", "L4"],
      confirmationPhrase: "确认放行本次操作",
    });
    expect(result.override.allowed).toBe(false);
    expect(result.override.reason).toBe("level_not_allowed");
  });

  // ── M2 可通过配置关闭 ─────────────────────────────────────────────

  it("hard-denies M2:protected_file_access when disabled via moduleOverrides", () => {
    const assessment: RiskAssessment = {
      level: "L4",
      score: 9,
      modules: ["M2:protected_file_access"],
      description: "核心配置文件访问",
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
