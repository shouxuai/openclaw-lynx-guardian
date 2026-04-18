import { describe, expect, it } from "vitest";
import type { RiskAssessment } from "../src/guard/safety-guard.js";
import {
  evaluateEvidenceBundle,
  evaluateGuardDecisionPolicy,
} from "../src/runtime/policy-runtime.js";

describe("policy runtime", () => {
  it("returns stricter compatibility assessment for execution-ready tool evidence bundles", () => {
    const result = evaluateEvidenceBundle({
      eventKind: "tool",
      summary: "tainted script execution",
      modules: ["M2:protected_file_access"],
      evidenceItems: [
        { dimension: "auth", weight: 4, confidence: 1, reason: "auth signal" },
        { dimension: "chain", weight: 4, confidence: 1, reason: "chain signal" },
        { dimension: "taint", weight: 4, confidence: 1, reason: "taint signal" },
      ],
      chainProgress: { stage: "execution_ready" },
      isAuditWhitelisted: false,
    });

    expect(result.riskLevelLabel).toBe("L3");
    expect(result.decision.kind).toBe("block");
    expect(result.compatibilityAssessment).toMatchObject({
      level: "L3",
      score: 8,
      modules: ["M2:protected_file_access"],
      description: "tainted script execution",
      action: "block",
      policyDecisionKind: "block",
    });
  });

  it("prefers stricter bundle policy decisions over legacy allow decisions", () => {
    const assessment: RiskAssessment = {
      level: "L0",
      score: 0,
      modules: [],
      description: "legacy allow",
      action: "allow",
    };

    const result = evaluateGuardDecisionPolicy({
      assessment,
      evidenceBundle: {
        eventKind: "tool",
        summary: "tainted script execution",
        modules: ["M2:protected_file_access"],
        evidenceItems: [
          { dimension: "auth", weight: 4, confidence: 1, reason: "auth signal" },
          { dimension: "chain", weight: 4, confidence: 1, reason: "chain signal" },
          { dimension: "taint", weight: 4, confidence: 1, reason: "taint signal" },
        ],
        chainProgress: { stage: "execution_ready" },
        isAuditWhitelisted: false,
      },
    });

    expect(result.legacyEvaluation.decision.kind).toBe("allow");
    expect(result.bundleEvaluation?.decision.kind).toBe("block");
    expect(result.finalDecision.kind).toBe("block");
    expect(result.effectiveAssessment).toMatchObject({
      level: "L3",
      score: 8,
      modules: ["M2:protected_file_access"],
      description: "tainted script execution",
      action: "block",
      policyDecisionKind: "block",
    });
  });

  it("preserves bundle workflow_auth over legacy confirm during arbitration", () => {
    const assessment: RiskAssessment = {
      level: "L2",
      score: 6,
      modules: ["M2:protected_file_access"],
      description: "legacy confirm",
      action: "warn",
    };

    const result = evaluateGuardDecisionPolicy({
      assessment,
      evidenceBundle: {
        eventKind: "tool",
        summary: "workflow-gated write attempt",
        modules: ["M2:protected_file_access"],
        evidenceItems: [
          { dimension: "auth", weight: 3, confidence: 1, reason: "auth signal" },
          { dimension: "chain", weight: 3, confidence: 1, reason: "chain signal" },
        ],
        workflowCandidate: true,
        workflowAuthorized: false,
        isAuditWhitelisted: false,
      },
    });

    expect(result.legacyEvaluation.decision.kind).toBe("confirm");
    expect(result.bundleEvaluation?.decision.kind).toBe("workflow_auth");
    expect(result.finalDecision.kind).toBe("workflow_auth");
    expect(result.effectiveAssessment).toMatchObject({
      level: "L2",
      score: 6,
      modules: ["M2:protected_file_access"],
      description: "workflow-gated write attempt",
      action: "warn",
      policyDecisionKind: "workflow_auth",
    });
  });

  it("keeps allow semantics for low-risk bundle compatibility assessments", () => {
    const result = evaluateEvidenceBundle({
      eventKind: "output",
      summary: "low-risk audit note",
      modules: [],
      evidenceItems: [],
      isAuditWhitelisted: false,
    });

    expect(result.decision.kind).toBe("allow");
    expect(result.compatibilityAssessment).toMatchObject({
      level: "L0",
      score: 0,
      modules: [],
      description: "low-risk audit note",
      action: "allow",
      policyDecisionKind: "allow",
    });
  });

  it("keeps workflow-auth semantics on non-blocking compatibility assessments", () => {
    const result = evaluateEvidenceBundle({
      eventKind: "tool",
      summary: "workflow-gated write attempt",
      modules: ["M2:protected_file_access"],
      evidenceItems: [
        { dimension: "auth", weight: 3, confidence: 1, reason: "auth signal" },
        { dimension: "chain", weight: 3, confidence: 1, reason: "chain signal" },
      ],
      workflowCandidate: true,
      workflowAuthorized: false,
      isAuditWhitelisted: false,
    });

    expect(result.decision.kind).toBe("workflow_auth");
    expect(result.compatibilityAssessment).toMatchObject({
      level: "L2",
      score: 6,
      modules: ["M2:protected_file_access"],
      description: "workflow-gated write attempt",
      action: "warn",
      policyDecisionKind: "workflow_auth",
    });
  });

  it("falls back to the legacy evaluation when no evidence bundle is present", () => {
    const assessment: RiskAssessment = {
      level: "L2",
      score: 6,
      modules: ["M2:protected_file_access"],
      description: "legacy assessment",
      action: "warn",
    };

    const result = evaluateGuardDecisionPolicy({ assessment });

    expect(result.bundleEvaluation).toBeUndefined();
    expect(result.legacyEvaluation.decision.kind).toBe("confirm");
    expect(result.finalDecision.kind).toBe("confirm");
    expect(result.effectiveAssessment).toBe(assessment);
  });
});
