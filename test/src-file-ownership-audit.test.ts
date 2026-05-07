import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
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

type OwnershipLabel =
  | "keep-ts"
  | "split"
  | "move-ts"
  | "delete"
  | "discuss-keep";

const OWNERSHIP: Record<string, OwnershipLabel> = {
  "src/api.ts": "delete",
  "src/blacklist.ts": "split",
  "src/config.ts": "delete",
  "src/path-glob-protection.ts": "split",
  "src/types.ts": "keep-ts",
  "src/utils.ts": "split",
  "src/api/go-control-plane.ts": "keep-ts",
  "src/approval/approval-bridge.ts": "split",
  "src/approval/native-approval-description.ts": "keep-ts",
  "src/approval/approval-prompts.ts": "keep-ts",
  "src/approval/pending-override-store.ts": "keep-ts",
  "src/approval/requester-provenance-store.ts": "keep-ts",
  "src/console/event-builder.ts": "split",
  "src/console/ingest-client.ts": "keep-ts",
  "src/console/runtime.ts": "keep-ts",
  "src/console/token-usage.ts": "split",
  "src/delivery/message-delivery.ts": "split",
  "src/delivery/delivery-targets.ts": "keep-ts",
  "src/delivery/recent-delivery.ts": "split",
  "src/discovery/discovery-hook-utils.ts": "keep-ts",
  "src/discovery/discovery-runtime-config.ts": "keep-ts",
  "src/discovery/lynx-check-report-template.ts": "move-ts",
  "src/discovery/lynx-check-trigger.ts": "keep-ts",
  "src/discovery/manual-lynx-check.ts": "split",
  "src/discovery/openclaw-discovery.ts": "discuss-keep",
  "src/discovery/pending-discovery-store.ts": "split",
  "src/guard/concealed-intent.ts": "split",
  "src/guard/global-allowlist.ts": "split",
  "src/guard/prompt-injection.ts": "split",
  "src/guard/risk-policy.ts": "delete",
  "src/guard/safety-guard.ts": "split",
  "src/guard/system-prompt-guard.ts": "split",
  "src/hooks/input-hooks.ts": "split",
  "src/hooks/lifecycle-hooks.ts": "keep-ts",
  "src/hooks/hook-runtime-helpers.ts": "keep-ts",
  "src/hooks/output-hooks.ts": "split",
  "src/hooks/setup.ts": "keep-ts",
  "src/hooks/tool-hooks.ts": "split",
  "src/local-guard/concealed-execution-hard-deny.ts": "keep-ts",
  "src/local-guard/local-l4-fast-path.ts": "keep-ts",
  "src/local-guard/output-protection.ts": "keep-ts",
  "src/local-guard/path-hard-deny.ts": "keep-ts",
  "src/local-guard/prompt-hard-deny.ts": "keep-ts",
  "src/local-guard/sensitive-patterns.ts": "keep-ts",
  "src/local-guard/tool-command-hard-deny.ts": "keep-ts",
  "src/lynx-check/lynx-check-bridge.ts": "split",
  "src/lynx-check/prompt.ts": "keep-ts",
  "src/lynx-check/report-template.ts": "keep-ts",
  "src/lynx-check/report-producers.ts": "discuss-keep",
  "src/lynx-check/scheduled-lynx-check.ts": "split",
  "src/lynx-check/setup-helpers.ts": "keep-ts",
  "src/protected-resources/evidence-adapter.ts": "keep-ts",
  "src/protected-resources/explanation.ts": "keep-ts",
  "src/protected-resources/tool-operation.ts": "keep-ts",
  "src/protected-resources/types.ts": "keep-ts",
  "src/runtime/decision-broker.ts": "keep-ts",
  "src/runtime/decision-context.ts": "keep-ts",
  "src/runtime/hook-capabilities.ts": "keep-ts",
  "src/runtime/hook-decision-handlers.ts": "split",
  "src/runtime/lynx-audit-runtime.ts": "keep-ts",
  "src/runtime/lynx-check-prompt.ts": "move-ts",
  "src/runtime/override-runtime.ts": "split",
  "src/runtime/pending-override-store.ts": "split",
  "src/runtime/plugin-entry-helpers.ts": "split",
  "src/runtime/plugin-runtime-config.ts": "keep-ts",
  "src/runtime/plugin-runtime-helpers.ts": "split",
  "src/runtime/plugin-setup-helpers.ts": "split",
  "src/runtime/policy-runtime.ts": "delete",
  "src/runtime/remote-weighting-service.ts": "delete",
  "src/runtime/requester-provenance-store.ts": "split",
  "src/runtime/resource-config.ts": "keep-ts",
  "src/runtime/risk-decision.ts": "keep-ts",
  "src/runtime/token-optimizer-runner.ts": "discuss-keep",
  "src/runtime/visible-input-warning.ts": "split",
  "src/script-preflight/dispatcher-parser.ts": "keep-ts",
  "src/script-preflight/entrypoint-resolver.ts": "keep-ts",
  "src/script-preflight/evidence-adapter.ts": "keep-ts",
  "src/script-preflight/explanation.ts": "keep-ts",
  "src/script-preflight/safe-script-reader.ts": "keep-ts",
  "src/script-preflight/script-scanner.ts": "keep-ts",
  "src/script-preflight/types.ts": "keep-ts",
  "src/skills/skill-guard.ts": "split",
  "src/skills/skill-hash.ts": "keep-ts",
};

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
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

describe("src file ownership audit", () => {
  it("declares an ownership label for every active src file", () => {
    const actual = listTsFiles(srcRoot).map(rel).sort();
    const missing = actual.filter((file) => OWNERSHIP[file] === undefined);
    expect(missing).toEqual([]);
  });

  it("does not keep the root api compatibility shim", () => {
    expect(existsSync(join(repoRoot, "src/api.ts"))).toBe(false);
  });

  it("does not keep a root config catch-all file", () => {
    expect(existsSync(join(repoRoot, "src/config.ts"))).toBe(false);
  });

  it("keeps Go control-plane requests centralized", () => {
    const offenders = listTsFiles(srcRoot)
      .map(rel)
      .filter((file) => file !== "src/api/go-control-plane.ts")
      .filter((file) => read(file).includes("/lynx/internal/v1"));

    expect(offenders).toEqual([]);
  });

  it("keeps legacy remote safety API paths out of active plugin runtime", () => {
    const offenders = listTsFiles(srcRoot)
      .map(rel)
      .filter((file) =>
        legacyRemotePatterns.some((pattern) => read(file).includes(pattern)),
      );

    expect(offenders).toEqual([]);
  });

  it("keeps discuss files in TypeScript for this pass", () => {
    const missingDiscussFiles = Object.entries(OWNERSHIP)
      .filter(([, label]) => label === "discuss-keep")
      .map(([file]) => file)
      .filter((file) => !existsSync(join(repoRoot, file)));

    expect(missingDiscussFiles).toEqual([]);
  });

  it("keeps sync-only output protection independent from safety-guard", () => {
    const source = read("src/local-guard/output-protection.ts");
    expect(source).not.toContain("../guard/safety-guard");
  });

  it("keeps approval callback stores implemented under src/approval", () => {
    expect(existsSync(join(repoRoot, "src/approval/pending-override-store.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "src/approval/requester-provenance-store.ts"))).toBe(true);

    const pendingRuntimeShim = read("src/runtime/pending-override-store.ts");
    const requesterRuntimeShim = read("src/runtime/requester-provenance-store.ts");

    expect(pendingRuntimeShim).toContain("../approval/pending-override-store.js");
    expect(requesterRuntimeShim).toContain("../approval/requester-provenance-store.js");
    expect(pendingRuntimeShim).not.toContain("new Map");
    expect(requesterRuntimeShim).not.toContain("new Map");
  });

  it("keeps runtime policy adapter free of local evidence scoring", () => {
    const source = read("src/runtime/policy-runtime.ts");
    expect(source).not.toContain("evaluateEvidenceBundle");
    expect(source).not.toContain("compatibilityScore");
  });

  it("keeps plugin setup helper facade from owning approval, delivery, or lynx-check pure helpers", () => {
    const source = read("src/runtime/plugin-setup-helpers.ts");
    expect(source).not.toContain("export function extractApproveCommand");
    expect(source).not.toContain("export function buildOutboundDeliveryTarget");
    expect(source).not.toContain("export function resolveManagedLynxCheckSource");
    expect(source).not.toContain("writeFileSync");
  });

  it("keeps moved lynx-check prompt and report template paths as compatibility shims", () => {
    expect(read("src/runtime/lynx-check-prompt.ts").trim()).toBe(
      'export * from "../lynx-check/prompt.js";',
    );
    expect(read("src/discovery/lynx-check-report-template.ts").trim()).toBe(
      'export * from "../lynx-check/report-template.js";',
    );
  });
});
