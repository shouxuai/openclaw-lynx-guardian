import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("package manifest", () => {
  it("does not declare Node built-in modules as runtime dependencies", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const dependencies = Object.keys(manifest.dependencies ?? {});
    const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

    expect(dependencies.filter((name) => builtins.has(name))).toEqual([]);
  });
});
