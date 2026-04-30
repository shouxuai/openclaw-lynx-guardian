import { describe, expect, it } from "vitest";
import type { ToolCallEvent } from "../src/types.js";
import { buildDecisionOnlyToolEvent } from "../src/script-preflight/evidence-adapter.js";

describe("script preflight decision injection", () => {
  it("adds script evidence only to the decision event", () => {
    const original: ToolCallEvent = {
      toolName: "exec",
      params: { command: "python bad.py" },
    };
    const scriptEvidence = [
      {
        evidenceId: "script-1",
        entrypointKind: "direct_file" as const,
        source: "script_file" as const,
        command: "python bad.py",
        scriptPath: "bad.py",
        language: "python" as const,
        readStatus: "read" as const,
        findings: [],
        riskLevel: "L0" as const,
        recommendedAction: "allow" as const,
      },
    ];

    const decisionEvent = buildDecisionOnlyToolEvent(original, { scriptEvidence });

    expect(decisionEvent).not.toBe(original);
    expect(decisionEvent.params).toEqual(original.params);
    expect((decisionEvent as any).scriptEvidence).toEqual(scriptEvidence);
    expect((original as any).scriptEvidence).toBeUndefined();
    expect(original.params).toEqual({ command: "python bad.py" });
  });

  it("keeps Go decision metadata separate from actual tool params", () => {
    const original: ToolCallEvent = {
      toolName: "exec",
      params: { command: "python bad.py" },
    };
    const decisionEvent = buildDecisionOnlyToolEvent(original, {
      scriptEvidence: [],
      resourceEvidence: [],
      policyVersion: 3,
    });

    expect((decisionEvent.params as Record<string, unknown>).__lynxScriptPreflight).toBeUndefined();
    expect((decisionEvent as any).policyVersion).toBe(3);
  });
});
