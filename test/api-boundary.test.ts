import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const repoRoot = process.cwd();
const srcRoot = join(repoRoot, "src");
const legacyRemotePatterns = [
  "/api/v1/register",
  "/api/v1/content_check",
  "/api/v1/tool_check",
  "/api/v1/push_record",
  "/api/v1/check_public_access",
  "/api/v1/skill_blacklist",
  "/api/v1/skill_check",
];

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

  it("keeps legacy remote safety API paths out of active plugin runtime", () => {
    const offenders = listTsFiles(srcRoot)
      .map(relativeUnix)
      .filter((file) =>
        legacyRemotePatterns.some((pattern) =>
          readFileSync(join(repoRoot, file), "utf8").includes(pattern),
        ),
      );

    expect(offenders).toEqual([]);
  });
});
