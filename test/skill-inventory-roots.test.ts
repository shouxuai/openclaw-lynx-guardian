import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configureSkillInventoryControlPlane,
  resolveDefaultSkillInventoryRoots,
  resolveOpenClawExtensionSkillRoots,
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
      { path: "/app/dist/extensions/openclaw-lynx-guardian/skills", source: "openclaw-extension" },
    ]));
    expect(roots).not.toContainEqual({ path: "/app/dist/extensions", source: "openclaw-extension" });
  });

  it("includes cross-platform user-managed skill roots", () => {
    const macRoots = resolveDefaultSkillInventoryRoots(
      new URL("file:///Users/alice/.openclaw/extensions/openclaw-lynx-guardian/index.js"),
      "/Users/alice",
    );
    const windowsRoots = resolveDefaultSkillInventoryRoots(
      new URL("file:///C:/Users/alice/.openclaw/extensions/openclaw-lynx-guardian/index.js"),
      "C:\\Users\\alice",
    );

    expect(macRoots).toEqual(expect.arrayContaining([
      { path: "/Users/alice/.openclaw/skills", source: "local" },
      { path: "/Users/alice/.agents/skills", source: "agents-skills-personal" },
      { path: "/Users/alice/.openclaw/extensions/openclaw-lynx-guardian/skills", source: "openclaw-extension" },
    ]));
    expect(windowsRoots).toEqual(expect.arrayContaining([
      { path: "C:\\Users\\alice\\.openclaw\\skills", source: "local" },
      { path: "C:\\Users\\alice\\.agents\\skills", source: "agents-skills-personal" },
      { path: "C:\\Users\\alice\\.openclaw\\extensions\\openclaw-lynx-guardian\\skills", source: "openclaw-extension" },
    ]));
  });

  it("discovers native OpenClaw package and extension skill roots outside Docker", () => {
    const packageRoot = join(TEST_DIR, "native-openclaw-package");
    const bundledSkillRoot = join(packageRoot, "skills");
    const feishuSkillRoot = join(packageRoot, "dist", "extensions", "feishu", "skills");
    const modulePath = join(packageRoot, "dist", "extensions", "openclaw-lynx-guardian", "index.js");
    writeSkillManifest(join(bundledSkillRoot, "healthcheck"), "healthcheck");
    writeSkillManifest(join(feishuSkillRoot, "feishu-doc"), "feishu-doc");
    mkdirSync(join(packageRoot, "dist", "extensions", "openclaw-lynx-guardian"), { recursive: true });
    writeFileSync(modulePath, "", "utf-8");

    const roots = resolveDefaultSkillInventoryRoots(pathToFileURL(modulePath), join(TEST_DIR, "home"));

    expect(roots).toEqual(expect.arrayContaining([
      { path: bundledSkillRoot, source: "openclaw-bundled" },
      { path: feishuSkillRoot, source: "openclaw-extension" },
    ]));
    expect(roots).not.toContainEqual({
      path: join(packageRoot, "dist", "extensions"),
      source: "openclaw-extension",
    });
  });

  it("uses native OpenClaw state-dir extension roots", () => {
    const stateDir = join(TEST_DIR, "state");
    const extensionSkillRoot = join(stateDir, "extensions", "openclaw-native-plugin", "skills");
    mkdirSync(extensionSkillRoot, { recursive: true });

    const roots = resolveDefaultSkillInventoryRoots(
      pathToFileURL(join(TEST_DIR, "plugin", "index.js")),
      join(TEST_DIR, "home"),
      { env: { OPENCLAW_STATE_DIR: stateDir } },
    );

    expect(roots).toEqual(expect.arrayContaining([
      { path: join(stateDir, "skills"), source: "local" },
      { path: extensionSkillRoot, source: "openclaw-extension" },
    ]));
  });

  it("discovers direct extension skill roots without scanning whole extension trees", () => {
    const extensionsRoot = join(TEST_DIR, "extensions");
    const feishuSkills = join(extensionsRoot, "openclaw-feishu", "skills");
    const acpxBundledSkills = join(extensionsRoot, "openclaw-acpx", "bundled-skills");
    mkdirSync(join(extensionsRoot, "openclaw-feishu", "node_modules", "ignored", "skills"), { recursive: true });
    mkdirSync(feishuSkills, { recursive: true });
    mkdirSync(acpxBundledSkills, { recursive: true });

    expect(resolveOpenClawExtensionSkillRoots(extensionsRoot)).toEqual([
      { path: acpxBundledSkills, source: "openclaw-extension" },
      { path: feishuSkills, source: "openclaw-extension" },
    ]);
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
    const retrySkill = requestBodies[1]?.items?.find((item: any) => item.skillId === "retry-skill");
    expect(retrySkill?.source).toBe("bundled");
    expect(retrySkill?.metadata?.inventoryChannel).toMatchObject({
      kind: "other",
      sourceKind: "bundled",
      scanner: "file-system",
    });
  });

  it("marks file-discovered OpenClaw bundled skills as native channel", async () => {
    const bundledRoot = join(TEST_DIR, "openclaw-bundled-skills");
    writeSkillManifest(join(bundledRoot, "healthcheck"), "healthcheck");

    const requestBodies: any[] = [];
    configureSkillInventoryControlPlane({
      baseUrl: "http://lynx-local-console.test",
      retryDelaysMs: [],
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          requestBodies.push(JSON.parse(String(init.body)));
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
      logger: { warn() {}, debug() {} },
      nativeSkillRegistry: { enabled: false },
    });

    verifyAllInstalledSkills([], [{ path: bundledRoot, source: "openclaw-bundled" }]);

    await waitFor(() => requestBodies.length >= 1);
    const healthcheck = requestBodies[0]?.items?.find((item: any) => item.skillId === "healthcheck");
    expect(healthcheck?.metadata?.inventoryChannel).toMatchObject({
      kind: "native",
      sourceKind: "openclaw-bundled",
      scanner: "file-system",
    });
  });

  it("enriches inventory with OpenClaw native skill registry status", async () => {
    const nativeRoot = join(TEST_DIR, "native-registry-skills");
    const nativeSkillPath = join(nativeRoot, "runtime-skill");
    writeSkillManifest(nativeSkillPath, "runtime-skill");

    const requestBodies: any[] = [];
    let nativeRegistryCallCount = 0;
    configureSkillInventoryControlPlane({
      baseUrl: "http://lynx-local-console.test",
      retryDelaysMs: [],
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          requestBodies.push(JSON.parse(String(init.body)));
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
      logger: { warn() {}, debug() {} },
      nativeSkillRegistry: {
        enabled: true,
        retryDelaysMs: [1],
        execFileImpl: (_file, _args, _options, callback) => {
          nativeRegistryCallCount += 1;
          if (nativeRegistryCallCount === 1) {
            callback(null, "skills list unavailable during gateway startup", "");
            return;
          }
          const output = [
            "Config warnings: duplicate plugin id",
            JSON.stringify({
              workspaceDir: "/workspace",
              managedSkillsDir: nativeRoot,
              skills: [
                {
                  name: "runtime-skill",
                  description: "Runtime registry skill",
                  source: "openclaw-managed",
                  bundled: false,
                  filePath: join(nativeSkillPath, "SKILL.md"),
                  baseDir: nativeSkillPath,
                  skillKey: "runtime-skill",
                  eligible: true,
                  disabled: false,
                  blockedByAllowlist: false,
                  missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
                },
              ],
            }),
          ].join("\n");
          callback(null, new TextEncoder().encode(output) as any, new TextEncoder().encode("") as any);
        },
      },
    });

    verifyAllInstalledSkills([], [{ path: nativeRoot, source: "local" }]);

    await waitFor(() => requestBodies.length >= 2);
    const nativeSyncBody = requestBodies.at(-1);
    const syncedSkill = nativeSyncBody?.items?.find((item: any) => item.skillId === "runtime-skill");
    expect(syncedSkill?.source).toBe("openclaw-managed");
    expect(syncedSkill?.metadata?.inventoryChannel).toMatchObject({
      kind: "native",
      sourceKind: "openclaw-managed",
      scanner: "openclaw-runtime",
    });
    expect(syncedSkill?.metadata?.openclawRuntime?.eligible).toBe(true);
    expect(syncedSkill?.metadata?.openclawRuntime?.missing).toEqual({
      bins: [],
      anyBins: [],
      env: [],
      config: [],
      os: [],
    });
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
