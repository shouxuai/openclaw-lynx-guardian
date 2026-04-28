import { describe, expect, it } from "vitest";

import { getDecisionTone } from "../../src/utils/status";

describe("getDecisionTone", () => {
  it("treats block false warn decisions as warning instead of safe", () => {
    expect(getDecisionTone({
      block: false,
      riskLevel: "L2",
      action: "warn",
      eventSeverity: "warn",
    })).toBe("warning");
  });

  it("treats L4 deny decisions as error", () => {
    expect(getDecisionTone({
      block: true,
      riskLevel: "L4",
      action: "deny",
      eventSeverity: "critical",
    })).toBe("error");
  });

  it("treats low risk allow decisions as default", () => {
    expect(getDecisionTone({
      block: false,
      riskLevel: "L0",
      action: "allow",
      eventSeverity: "info",
    })).toBe("default");
  });
});
