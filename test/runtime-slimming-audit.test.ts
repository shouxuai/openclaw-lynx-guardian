import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const repoRoot = process.cwd();

function listTsFiles(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      output.push(...listTsFiles(fullPath));
    } else if (entry.endsWith(".ts")) {
      output.push(fullPath);
    }
  }
  return output;
}

function countTsFiles(path: string): number {
  try {
    return listTsFiles(join(repoRoot, path)).length;
  } catch {
    return 0;
  }
}

function relativeUnix(path: string): string {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

describe("plugin runtime slimming target", () => {
  it("keeps src file count within second-stage target", () => {
    expect(countTsFiles("src")).toBeLessThanOrEqual(60);
  });

  it("keeps runtime from remaining a catch-all directory", () => {
    expect(countTsFiles("src/runtime")).toBeLessThanOrEqual(20);
  });

  it("keeps guard focused on local enforcement", () => {
    expect(countTsFiles("src/guard")).toBeLessThanOrEqual(10);
  });

  it("keeps rich semantic judgement out of plugin guard runtime", () => {
    const srcFiles = listTsFiles(join(repoRoot, "src")).map(relativeUnix);

    expect(srcFiles).not.toContain("src/guard/evasive-intent-cn.ts");
  });

  it("keeps index as hook orchestration", () => {
    const lineCount = readFileSync(join(repoRoot, "index.ts"), "utf8").split(/\r?\n/).length;
    expect(lineCount).toBeLessThan(2200);
  });

  it("keeps policy-engine files out of the active plugin path", () => {
    const policyFiles = listTsFiles(join(repoRoot, "src"))
      .map(relativeUnix)
      .filter((file) => file.startsWith("src/guard/policy/"));

    expect(policyFiles).toEqual([]);
  });
});
