import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configureSkillInventoryControlPlane,
  resolveDefaultSkillInventoryRoots,
  verifyAllInstalledSkills,
  verifyInstalledSkillsFromRoots,
} from "../src/skills/skill-guard.js";

const TEST_DIR = join(tmpdir(), "lynx-skill-inventory-roots-" + Date.now());

function writeSkillManifest(skillPath: string, title: string): void {
  mkdirSync(skillPath, { recursive: true });
  writeFileSync(join(skillPath, "SKILL.md"), `---\nname: ${title}\n---\n# ${title}\n`, "utf-8");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  configureSkillInventoryControlPlane(null);
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Skill inventory root scanning", () => {
  it("includes native OpenClaw skill roots in the default scan plan", () => {
    const roots = resolveDefaultSkillInventoryRoots(
      new URL("file:///app/dist/extensions/openclaw-lynx-guardian/index.js"),
      "/home/node",
    );

    expect(roots).toEqual(expect.arrayContaining([
      { path: "/home/node/.openclaw/skills", source: "local" },
      { path: "/app/skills", source: "openclaw-bundled" },
      { path: "/app/dist/extensions", source: "openclaw-extension" },
      { path: "/app/dist/extensions/openclaw-lynx-guardian/skills", source: "bundled" },
    ]));
  });

  it("counts bundled repo-local skill manifests when they are not installed under home", () => {
    const bundledRoot = join(TEST_DIR, "bundled-skills");
    const parentSkill = join(bundledRoot, "lynx-guardian-lesson");
    const childSkill = join(parentSkill, "SX-self-safety-guard");
    writeSkillManifest(parentSkill, "lynx-guardian-lesson");
    writeSkillManifest(childSkill, "SX-self-safety-guard");

    const results = verifyInstalledSkillsFromRoots([
      { path: bundledRoot, source: "bundled" },
    ], []);

    expect(results.map((result) => result.skillName).sort()).toEqual([
      "SX-self-safety-guard",
      "lynx-guardian-lesson",
    ]);
    expect(results.every((result) => result.source === "bundled")).toBe(true);
    expect(results.find((result) => result.skillName === "lynx-guardian-lesson")?.path)
      .toBe(parentSkill);
  });

  it("retries inventory sync when the local console is not ready on the first attempt", async () => {
    const bundledRoot = join(TEST_DIR, "retry-bundled-skills");
    writeSkillManifest(join(bundledRoot, "retry-skill"), "retry-skill");

    const requestBodies: any[] = [];
    let callCount = 0;
    configureSkillInventoryControlPlane({
      baseUrl: "http://lynx-local-console.test",
      retryDelaysMs: [1],
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        callCount += 1;
        if (init?.body) {
          requestBodies.push(JSON.parse(String(init.body)));
        }
        if (callCount === 1) {
          throw new Error("connect ECONNREFUSED");
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
      logger: { warn() {}, debug() {} },
    });

    verifyAllInstalledSkills([], [{ path: bundledRoot, source: "bundled" }]);

    await waitFor(() => callCount >= 2);
    expect(callCount).toBe(2);
    expect(requestBodies[1]?.items?.map((item: any) => item.skillId)).toContain("retry-skill");
    expect(requestBodies[1]?.items?.find((item: any) => item.skillId === "retry-skill")?.source)
      .toBe("bundled");
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}
