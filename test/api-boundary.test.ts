import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const repoRoot = process.cwd();
const srcRoot = join(repoRoot, "src");

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

function relativeUnix(path: string): string {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

describe("plugin API boundary", () => {
  it("declares Go control-plane request paths only in src/api/go-control-plane.ts", () => {
    const offenders = listTsFiles(srcRoot)
      .filter((file) => !relativeUnix(file).endsWith("src/api/go-control-plane.ts"))
      .filter((file) => readFileSync(file, "utf8").includes("/lynx/internal/v1"))
      .map(relativeUnix);

    expect(offenders).toEqual([]);
  });

  it("declares legacy remote API paths only in src/api/remote-safety-service.ts", () => {
    const offenders = listTsFiles(srcRoot)
      .filter((file) => !relativeUnix(file).endsWith("src/api/remote-safety-service.ts"))
      .filter((file) => readFileSync(file, "utf8").includes("/api/v1/"))
      .map(relativeUnix);

    expect(offenders).toEqual([]);
  });
});
