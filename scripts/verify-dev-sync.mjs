import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_GATEWAY_CONTAINER,
  assessGatewayLogs,
  buildInstallLocalConsoleRuntimeDepsShellCommand,
  buildDevSyncPlan,
  findStalePluginManagedDirectories,
  pickGatewayContainer,
  resolveOpenClawHome,
  shouldStagePath,
} from "./dev-sync-lib.mjs";
import {
  buildReadySyncSuccessMessage,
  buildPackageLocalConsoleServerArgs,
  buildCronStoreContainsJobShellCommand,
  buildCronStoreSyncShellCommand,
  extractContainerHealthStatus,
  hasGatewayReadyMarkers,
  resolveCronStoreSyncPaths,
} from "./ready-sync-lib.mjs";
import { packageLocalConsoleServer } from "./package-local-console-server-lib.mjs";
import { LOCAL_CONSOLE_INGEST_SCHEMA_VERSION } from "../shared/src/enums.js";

assert.equal(resolveOpenClawHome({
  platform: "win32",
  env: { USERPROFILE: "C:\\Users\\24716" },
}), path.win32.join("C:\\Users\\24716", ".openclaw"));

assert.equal(resolveOpenClawHome({
  platform: "win32",
  env: { USERPROFILE: "C:\\Users\\24716" },
  override: "D:\\custom-openclaw",
}), "D:\\custom-openclaw");

assert.equal(shouldStagePath(".git\\config"), false);
assert.equal(shouldStagePath("node_modules\\vitest\\index.js"), false);
assert.equal(shouldStagePath("backend\\node_modules\\better-sqlite3\\package.json"), false);
assert.equal(shouldStagePath("backend\\vendor\\modules.txt"), false);
assert.equal(shouldStagePath("backend\\dist\\lynx-server-linux-x64"), false);
assert.equal(shouldStagePath("frontend\\.vite\\deps\\chunk.js"), false);
assert.equal(shouldStagePath("backend\\test-temp\\smoke\\stdout.log"), false);
assert.equal(shouldStagePath(".worktrees\\output-result-intercept"), false);
assert.equal(shouldStagePath("dist\\index.js"), false);
assert.equal(shouldStagePath("backend\\dist\\main.js"), false);
assert.equal(shouldStagePath("server\\backend\\lynx-server-linux-x64"), true);
assert.equal(shouldStagePath("src\\utils.ts"), true);
assert.equal(shouldStagePath("skills\\lynx-guardian-lesson\\SKILL.md"), true);
assert.deepEqual(
  findStalePluginManagedDirectories({
    sourceNames: ["lynx-guardian-lesson", "project-reader"],
    targetNames: ["hello-world", "lynx-guardian-check-orchestrator", "lynx-guardian-lesson"],
  }),
  ["lynx-guardian-check-orchestrator"],
);

assert.equal(pickGatewayContainer([
  "postgresql",
  "openclaw-openclaw-gateway-1",
  "redis",
]), "openclaw-openclaw-gateway-1");
assert.equal(pickGatewayContainer(["postgresql", "redis"]), DEFAULT_GATEWAY_CONTAINER);

const plan = buildDevSyncPlan({
  repoRoot: "C:\\Users\\24716\\.openclaw\\extensions\\openclaw-lynx-guardian",
  pluginName: "openclaw-lynx-guardian",
  openclawHome: "C:\\Users\\24716\\.openclaw",
  containerName: "openclaw-openclaw-gateway-1",
});

assert.equal(plan.containerPluginPath, "/app/extensions/openclaw-lynx-guardian");
assert.equal(plan.hostHooksPath, "C:\\Users\\24716\\.openclaw\\hooks");
assert.equal(plan.hostSkillsPath, "C:\\Users\\24716\\.openclaw\\skills");
assert.match(
  buildInstallLocalConsoleRuntimeDepsShellCommand({
    containerPluginPath: plan.containerPluginPath,
  }),
  /\/app\/extensions\/openclaw-lynx-guardian\/server\/backend/,
);

assert.equal(assessGatewayLogs([
  "[lynx-guardian] Plugin loading...",
  "[lynx-guardian] Resources (hooks/skills) checked.",
].join("\n")).status, "ready");

const blocked = assessGatewayLogs(
  "blocked plugin candidate: world-writable path (/home/node/.openclaw/extensions/openclaw-lynx-guardian/index.ts, mode=777)",
);
assert.equal(blocked.status, "blocked");
assert.match(blocked.reason, /world-writable/i);

const stagedCopyLoaded = assessGatewayLogs([
  "blocked plugin candidate: world-writable path (/home/node/.openclaw/extensions/openclaw-lynx-guardian/index.ts, mode=777)",
  "[lynx-guardian] Plugin loading...",
].join("\n"));
assert.equal(stagedCopyLoaded.status, "ready");
assert.match(stagedCopyLoaded.reason, /staged path/i);

assert.equal(extractContainerHealthStatus('{"Status":"healthy","FailingStreak":0,"Log":[]}'), "healthy");
assert.equal(extractContainerHealthStatus('{"Status":"starting","FailingStreak":0,"Log":[]}'), "starting");
assert.equal(extractContainerHealthStatus("null"), "none");
assert.equal(extractContainerHealthStatus(""), "unknown");

assert.equal(hasGatewayReadyMarkers([
  "[lynx-guardian] Plugin loading...",
  "listening on ws://0.0.0.0:18789 (PID 7)",
].join("\n")), true);
assert.equal(hasGatewayReadyMarkers("[lynx-guardian] Plugin loading..."), false);
assert.equal(hasGatewayReadyMarkers("listening on ws://0.0.0.0:18789 (PID 7)"), false);

assert.equal(
  buildReadySyncSuccessMessage({
    containerName: "openclaw-openclaw-gateway-1",
    startedAt: "2026-04-12T02:29:31.194287003Z",
  }),
  "[lynx-dev-ready] SUCCESS: openclaw-openclaw-gateway-1 restarted and ready at 2026-04-12T02:29:31.194287003Z",
);

assert.deepEqual(
  buildPackageLocalConsoleServerArgs({
    packageScriptPath: "C:\\repo\\scripts\\package-local-console-server.mjs",
    repoRoot: "C:\\repo",
  }),
  [
    "C:\\repo\\scripts\\package-local-console-server.mjs",
    "--repo-root",
    "C:\\repo",
  ],
);

assert.equal(LOCAL_CONSOLE_INGEST_SCHEMA_VERSION, "lynx-server.ingest.v1");

const packageFixtureRoot = mkdtempSync(path.join(tmpdir(), "lynx-server-package-"));
try {
  const backendDist = path.join(packageFixtureRoot, "backend", "dist");
  const frontendDist = path.join(packageFixtureRoot, "frontend", "dist");
  mkdirSync(backendDist, { recursive: true });
  mkdirSync(frontendDist, { recursive: true });
  writeFileSync(path.join(backendDist, "lynx-server-linux-x64"), "", "utf8");
  writeFileSync(path.join(backendDist, "lynx-server-win32-x64.exe"), "", "utf8");
  writeFileSync(path.join(backendDist, "lynx-console-linux-x64"), "", "utf8");
  writeFileSync(path.join(frontendDist, "index.html"), "<!doctype html>", "utf8");

  const packageResult = packageLocalConsoleServer({ repoRoot: packageFixtureRoot });
  assert.deepEqual(
    readdirSync(packageResult.backendDir).sort(),
    ["lynx-server-linux-x64", "lynx-server-win32-x64.exe"],
  );
} finally {
  rmSync(packageFixtureRoot, { recursive: true, force: true });
}

const cronStorePaths = resolveCronStoreSyncPaths();
assert.equal(cronStorePaths.sourceStorePath, "/home/node/.openclaw/cron/jobs.json");
assert.equal(cronStorePaths.targetStorePath, "/home/node/.openclaw/docker-state/cron/jobs.json");
assert.match(buildCronStoreContainsJobShellCommand({
  storePath: cronStorePaths.sourceStorePath,
}), /grep -F 'lynx-guardian-scheduled-lynx-check' '\/home\/node\/\.openclaw\/cron\/jobs\.json'/);
assert.match(
  buildCronStoreSyncShellCommand(cronStorePaths),
  /cp '\/home\/node\/\.openclaw\/cron\/jobs\.json' '\/home\/node\/\.openclaw\/docker-state\/cron\/jobs\.json'/,
);
assert.match(
  buildCronStoreSyncShellCommand(cronStorePaths),
  /mkdir -p '\/home\/node\/\.openclaw\/docker-state\/cron'/,
);

console.log("[verify-dev-sync] all assertions passed");
