import { describe, expect, it } from "vitest";

import {
  decideRiskAction,
  localSignalFromAssessment,
  remoteContentSignal,
  type RiskSurface,
  type UnifiedRiskSignal,
} from "../src/runtime/risk-decision.js";
import type { RiskAssessment } from "../src/guard/safety-guard.js";

function signal(overrides: Partial<UnifiedRiskSignal> = {}): UnifiedRiskSignal {
  return {
    source: "local",
    surface: "input",
    level: "L0",
    score: 0,
    modules: [],
    description: "安全",
    ...overrides,
  };
}

describe("unified risk decision layer", () => {
  it("keeps remote content categories separate from local L-levels", () => {
    const remote = remoteContentSignal({
      surface: "input",
      riskLevel: 3,
      categories: ["其他", "None", "None"],
      description: "远端内容检测命中",
    });

    expect(remote).toEqual({
      source: "remote",
      surface: "input",
      level: "L3",
      score: 3,
      categories: ["其他", "None", "None"],
      modules: ["remote:content_check"],
      description: "远端内容检测命中",
    });
  });

  it("copies local RiskAssessment into a local unified signal", () => {
    const assessment: RiskAssessment = {
      level: "L2",
      score: 5,
      modules: ["M1:prompt_injection"],
      description: "本地检测命中",
      action: "warn",
    };

    const unified = localSignalFromAssessment("output", assessment);

    expect(unified).toEqual({
      source: "local",
      surface: "output",
      level: "L2",
      score: 5,
      modules: ["M1:prompt_injection"],
      description: "本地检测命中",
    });
  });

  it("maps input L3 from local assessment to model_context instead of a physical block", () => {
    const assessment: RiskAssessment = {
      level: "L3",
      score: 7,
      modules: ["M4:concealed_intent"],
      description: "输入需要进入模型上下文约束",
      action: "block",
    };

    const decision = decideRiskAction("input", [
      localSignalFromAssessment("input", assessment),
    ]);

    expect(decision.action).toBe("model_context");
    expect(decision.level).toBe("L3");
    expect(decision.primaryModule).toBe("M4:concealed_intent");
  });

  it("maps tool L3 to require_approval", () => {
    const decision = decideRiskAction("tool", [
      signal({
        surface: "tool",
        level: "L3",
        score: 7,
        modules: ["M2:protected_file_access"],
        description: "工具调用需要审批",
      }),
    ]);

    expect(decision).toMatchObject({
      surface: "tool",
      level: "L3",
      action: "require_approval",
      primaryModule: "M2:protected_file_access",
    });
  });

  it.each<RiskSurface>(["input", "output", "tool"])("maps %s L4 to deny", (surface) => {
    const decision = decideRiskAction(surface, [
      signal({
        surface,
        level: "L4",
        score: 10,
        modules: ["M5:credential_theft"],
        description: "必须拒绝",
      }),
    ]);

    expect(decision.action).toBe("deny");
    expect(decision.level).toBe("L4");
    expect(decision.primaryModule).toBe("M5:credential_theft");
  });

  it("returns L0 allow for empty signals", () => {
    expect(decideRiskAction("input", [])).toMatchObject({
      surface: "input",
      level: "L0",
      action: "allow",
      signals: [],
      reason: "no risk signals",
    });
  });
});
