import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("sync-openclaw-dev ps1 compatibility", () => {
  it("keeps the sync-only wrapper and the ready wrapper pointed at matching node scripts", () => {
    const repoRoot = process.cwd();
    const syncWrapper = readFileSync(join(repoRoot, "scripts", "sync-openclaw-dev.ps1"), "utf8");
    const readyWrapper = readFileSync(join(repoRoot, "scripts", "sync-openclaw-dev-ready.ps1"), "utf8");

    expect(syncWrapper).toContain("sync-openclaw-dev.mjs");
    expect(readyWrapper).toContain("sync-openclaw-dev-ready.mjs");
  });
});
