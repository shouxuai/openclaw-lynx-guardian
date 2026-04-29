import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const repoRoot = process.cwd();

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

function rel(path: string): string {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

function readRel(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8").trim();
}

describe("Go decision ownership", () => {
  it("keeps rich Chinese evasive intent detector out of active plugin runtime", () => {
    const srcFiles = listFiles(join(repoRoot, "src"));
    const offenders = srcFiles
      .filter((file) => {
        const content = readFileSync(file, "utf8");
        return content.includes("detectChineseEvasiveIntent")
          || content.includes("M4:evasive_intent_cn");
      })
      .map(rel);

    expect(srcFiles.map(rel)).not.toContain("src/guard/evasive-intent-cn.ts");
    expect(offenders).toEqual([]);
  });

  it("keeps src/api.ts as a compatibility shim only", () => {
    expect(readRel("src/api.ts")).toBe('export * from "./api/remote-safety-service.js";');
  });

  it("keeps Go control-plane requests centralized", () => {
    const offenders = listFiles(join(repoRoot, "src"))
      .filter((file) => !rel(file).endsWith("src/api/go-control-plane.ts"))
      .filter((file) => readFileSync(file, "utf8").includes("/lynx/internal/v1"))
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it("keeps legacy remote safety service requests centralized", () => {
    const offenders = listFiles(join(repoRoot, "src"))
      .filter((file) => !rel(file).endsWith("src/api/remote-safety-service.ts"))
      .filter((file) => readFileSync(file, "utf8").includes("/api/v1"))
      .map(rel);

    expect(offenders).toEqual([]);
  });
});
