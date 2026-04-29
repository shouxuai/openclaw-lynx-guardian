import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisionsPage } from "../../src/pages/DecisionsPage";

function createDecision(overrides: Record<string, unknown>) {
  return {
    decisionId: "decision-approval-1",
    stage: "input",
    block: false,
    action: "require_approval",
    riskLevel: "L0",
    score: 8,
    winningArbiter: "evidence_score",
    matchedModules: ["approval_bypass"],
    requiresApproval: true,
    audit: {
      eventSeverity: "info",
      policyDecision: "require_approval",
      enforcementAction: "require_approval",
      color: "yellow",
    },
    arbiters: [
      {
        arbiter: "evidence_score",
        riskLevel: "L2",
        action: "require_approval",
        score: 42,
        matchedModules: ["approval_bypass"],
        evidence: [
          {
            id: "approval.bypass_phrase",
            module: "approval_bypass",
            kind: "phrase",
            value: "skip approval",
            severity: "warn",
            scoreDelta: 30,
            source: "input",
          },
        ],
        scoreBreakdown: [
          {
            ruleId: "approval.bypass_phrase",
            label: "approval bypass phrase",
            delta: 30,
            reason: "User tried to bypass approval",
          },
        ],
        reason: "approval bypass phrase",
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DecisionsPage tone mapping", () => {
  it("renders block false approval and degraded decisions as warning instead of safe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      createDecision({ decisionId: "decision-approval-1", requiresApproval: true }),
      createDecision({
        decisionId: "decision-degraded-1",
        requiresApproval: false,
        degraded: { reason: "backend fallback" },
      }),
    ]), { status: 200 })));

    render(<DecisionsPage />);

    const approvalRow = (await screen.findByText("decision-approval-1")).closest("tr");
    const degradedRow = screen.getByText("decision-degraded-1").closest("tr");

    expect(approvalRow).not.toBeNull();
    expect(degradedRow).not.toBeNull();
    expect(within(approvalRow!).getByText("未阻断")).toHaveClass("status-badge--warning");
    expect(within(degradedRow!).getByText("未阻断")).toHaveClass("status-badge--warning");
  });

  it("shows control-plane audit action, approval, matched rules, and score evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      createDecision({ decisionId: "decision-evidence-1" }),
    ]), { status: 200 })));

    render(<DecisionsPage />);

    const row = (await screen.findByText("decision-evidence-1")).closest("tr");

    expect(row).not.toBeNull();
    expect(within(row!).getAllByText("审批")).toHaveLength(2);
    expect(within(row!).getAllByText("需要审批")).toHaveLength(2);
    expect(within(row!).getByText("approval.bypass_phrase")).toBeInTheDocument();
    expect(within(row!).getByText("approval.bypass_phrase +30")).toBeInTheDocument();
    expect(within(row!).getByText("evidence_score")).toBeInTheDocument();
  });
});
