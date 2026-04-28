import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisionsPage } from "./DecisionsPage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DecisionsPage", () => {
  it("renders warn decisions as not blocked without treating block false as safe", async () => {
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

    expect(await screen.findByText("decision-warn-1")).toBeInTheDocument();
    expect(screen.getByText("未阻断")).toBeInTheDocument();
    expect(screen.getByText(/block:false 只表示未阻断，不等于安全/)).toBeInTheDocument();
    expect(screen.getByText("evidence_score")).toBeInTheDocument();
    expect(screen.getByText("input.warn_signal +42")).toBeInTheDocument();
  });
});
