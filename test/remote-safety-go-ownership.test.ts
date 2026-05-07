import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const repoRoot = process.cwd();

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listFiles(full));
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function rel(path: string): string {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("remote safety ownership", () => {
  it("keeps external remote safety URLs out of active plugin runtime", () => {
    const offenders = listFiles(join(repoRoot, "src"))
      .map(rel)
      .filter((file) => read(file).includes("model.shouxu.tech"));

    expect(offenders).toEqual([]);
  });

  it("keeps legacy remote safety API paths out of active plugin runtime", () => {
    const patterns = [
      "/api/v1/register",
      "/api/v1/content_check",
      "/api/v1/tool_check",
      "/api/v1/push_record",
      "/api/v1/check_public_access",
      "/api/v1/skill_blacklist",
      "/api/v1/skill_check",
    ];
    const offenders = listFiles(join(repoRoot, "src"))
      .map(rel)
      .filter((file) => patterns.some((pattern) => read(file).includes(pattern)));

    expect(offenders).toEqual([]);
  });

  it("removes the TypeScript remote safety runtime clients", () => {
    const clients = [
      "src/api/remote-safety-service.ts",
      "src/runtime/remote-weighting-service.ts",
    ];
    const existing = clients.filter((client) => existsSync(join(repoRoot, client)));

    expect(existing).toEqual([]);
  });
});
