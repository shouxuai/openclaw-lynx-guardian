import { describe, expect, it } from "vitest";

import { classifyLynxCheckTrigger } from "../src/discovery/lynx-check-trigger.js";

describe("classifyLynxCheckTrigger", () => {
  it("identifies /check as native_passthrough", () => {
    expect(classifyLynxCheckTrigger("/check")).toEqual({
      kind: "native_passthrough",
      normalizedText: "/check",
    });
  });

  it("identifies /lynx-check as a lynx_command", () => {
    expect(classifyLynxCheckTrigger("/lynx-check")).toEqual({
      kind: "lynx_command",
      normalizedText: "/lynx-check",
    });
  });

  it("returns none for the polite natural-language request", () => {
    expect(classifyLynxCheckTrigger("please check lynx gateway ip")).toEqual({
      kind: "none",
      normalizedText: "please check lynx gateway ip",
    });
  });

  it("returns none for another natural-language reference", () => {
    expect(classifyLynxCheckTrigger("help me inspect openclaw service")).toEqual({
      kind: "none",
      normalizedText: "help me inspect openclaw service",
    });
  });
});
