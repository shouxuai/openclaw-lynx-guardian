import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisionsPage } from "./DecisionsPage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DecisionsPage", () => {
  it("renders warn decisions as not blocked and keeps internal evidence in details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      {
        decisionId: "decision-warn-1",
        stage: "input",
        block: false,
        action: "warn",
        riskLevel: "L2",
        score: 42,
        winningArbiter: "evidence_score",
        matchedModules: ["risk_hint"],
        requiresApproval: false,
        audit: {
          eventSeverity: "warn",
          policyDecision: "warn",
          enforcementAction: "warn",
          color: "yellow",
        },
        arbiters: [
          {
            arbiter: "evidence_score",
            riskLevel: "L2",
            action: "warn",
            score: 42,
            matchedModules: ["risk_hint"],
            evidence: [],
            scoreBreakdown: [
              {
                ruleId: "input.warn_signal",
                label: "Warn signal",
                delta: 42,
                reason: "warn but continue",
              },
            ],
            reason: "evidence score 42 mapped to L2",
          },
        ],
      },
    ]), { status: 200 })));

    render(<DecisionsPage />);

    const row = (await screen.findByText("decision-warn-1")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("未阻断")).toHaveClass("status-badge--warning");
    expect(screen.queryByText(/block:false/)).not.toBeInTheDocument();
    expect(screen.queryByText("evidence_score")).not.toBeInTheDocument();

    fireEvent.click(within(row!).getByRole("button", { name: "查看 decision-warn-1 裁决详情" }));

    expect(screen.getByRole("dialog", { name: "裁决详情" })).toBeInTheDocument();
    expect(screen.getByText("evidence_score")).toBeInTheDocument();
    expect(screen.getByText("input.warn_signal +42")).toBeInTheDocument();
  });
});
