import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("direct agent hard-stop contract", () => {
  it("documents that before_agent_start block is not a physical stop in current OpenClaw hook types", () => {
    const currentBeforeAgentStartResultFields = [
      "systemPrompt",
      "prependContext",
      "prependSystemContext",
      "appendSystemContext",
      "modelOverride",
      "providerOverride",
    ];

    expect(currentBeforeAgentStartResultFields).not.toContain("block");
    expect(currentBeforeAgentStartResultFields).not.toContain("handled");
  });

  it("keeps direct agent L4 fallback labeled as prompt-level only", () => {
    const inputHooksSource = readFileSync(
      join(process.cwd(), "src", "hooks", "input-hooks.ts"),
      "utf8",
    );

    expect(inputHooksSource).toContain("before_agent_start L4 denial is prompt-level only");
    expect(inputHooksSource).toContain("physicalHardStopVerified: false");
    expect(inputHooksSource).toContain('requiredCoreHook: "before_agent_dispatch"');
    expect(inputHooksSource).toContain("Prompt-level fallback active because this OpenClaw runtime does not expose direct-agent physical block semantics.");
  });
});
