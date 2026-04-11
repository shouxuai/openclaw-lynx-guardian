import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("lynx check skill docs", () => {
  it("documents execution-dispatch mode and the result-store contract in the orchestrator skill", () => {
    const raw = readFileSync(
      new URL("../skills/lynx-guardian-daily-lynx-check/SKILL.md", import.meta.url),
      "utf8",
    );

    expect(raw).toContain("Execution Dispatch Mode");
    expect(raw).toContain("requestId");
    expect(raw).toContain("sendSucceeded");
    expect(raw).toContain("SX-security-audit");
    expect(raw).toContain("SX-openclaw-discovery");
  });
});
