# Lynx Guardian Plugin Runtime Slimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the Lynx Guardian plugin `src/` tree to a thin OpenClaw execution layer after the Go control-plane migration, reaching the second-stage slimming target.

**Architecture:** Create a strict `src/api/` boundary for Go control-plane and legacy remote-service requests, then consolidate scattered runtime files by feature ownership. Delete or reduce Go-owned plugin strategy/state modules while preserving local L4 hard-deny, sync-only output protection, and channel delivery bridges.

**Tech Stack:** TypeScript ESM plugin, Vitest, Go+Gin local control plane, shared TypeScript DTOs, OpenClaw Docker runtime sync.

---

## Spec Inputs

- `docs/superpowers/specs/2026-04-29-lynx-guardian-plugin-runtime-slimming-spec.md`
- `docs/superpowers/specs/2026-04-28-lynx-guardian-go-control-plane-remediation-spec.md`
- `docs/superpowers/specs/2026-04-28-lynx-guardian-module-contracts-spec.md`
- Supplemental context: `docs/planning/2026-04-28-213741-lynx-guardian-modular-remediation`

## Baseline

Measure before starting:

```powershell
Get-ChildItem src -Recurse -File -Filter *.ts | Measure-Object | Select-Object Count
Get-ChildItem src -Directory | ForEach-Object {
  $count=(Get-ChildItem $_.FullName -Recurse -File -Filter *.ts | Measure-Object).Count
  [PSCustomObject]@{Dir=$_.Name; TsFiles=$count}
} | Sort-Object TsFiles -Descending
Get-Content index.ts | Measure-Object -Line
```

Expected current baseline:

- `src/**/*.ts`: 98 files.
- `src/runtime/**/*.ts`: 60 files.
- `src/guard/**/*.ts`: 21 files.
- `index.ts`: about 3517 lines.

## Second-Stage Target

- `src/**/*.ts` at or below 60 files.
- `src/runtime/**/*.ts` at or below 20 files.
- `src/guard/**/*.ts` at or below 10 files.
- `index.ts` below 2200 lines.
- `src/api.ts` is a compatibility shim only.
- `/lynx/internal/v1` request declarations live only in `src/api/go-control-plane.ts`.
- `/api/v1` remote-service request declarations live only in `src/api/remote-safety-service.ts`.

## File Map

### Create

- `src/api/go-control-plane.ts`
- `src/api/remote-safety-service.ts`
- `src/api/index.ts`
- `src/approval/approval-bridge.ts`
- `src/approval/approval-context.ts`
- `src/approval/approval-fingerprint.ts`
- `src/delivery/message-delivery.ts`
- `src/delivery/recent-delivery.ts`
- `src/lynx-check/lynx-check-bridge.ts`
- `src/lynx-check/scheduled-lynx-check.ts`
- `src/console/ingest-client.ts`
- `src/console/event-builder.ts`
- `src/console/runtime.ts`
- `src/console/token-usage.ts`
- `src/local-guard/local-l4-fast-path.ts`
- `src/local-guard/output-protection.ts`
- `test/api-boundary.test.ts`
- `test/runtime-slimming-audit.test.ts`

### Modify

- `index.ts`
- `src/api.ts`
- `src/runtime/decision-broker.ts`
- `src/runtime/hook-decision-handlers.ts`
- `src/runtime/local-console-client.ts`
- `src/runtime/local-console-gateway-routes.ts`
- `src/runtime/remote-weighting-service.ts`
- `src/runtime/api-risk-adapter.ts`
- `src/guard/safety-guard.ts`
- `src/guard/result-guard.ts`
- `src/skills/skill-guard.ts`
- `src/discovery/manual-lynx-check.ts`
- affected tests under `test/`

### Delete After Consumers Move

- `src/runtime/decision-client.ts`
- `src/runtime/approval-grant-store.ts`
- `src/runtime/local-tool-approval-store.ts`
- `src/runtime/pending-tool-approval-store.ts`
- `src/runtime/run-approval-context-store.ts`
- `src/runtime/workflow-authorization-store.ts`
- `src/runtime/feishu-local-approval-grant-store.ts`
- `src/runtime/feishu-local-approval-replay-store.ts`
- `src/runtime/feishu-run-continuation-store.ts`
- `src/runtime/tool-approval-runtime.ts`
- `src/runtime/approval-request-fingerprint.ts`
- `src/runtime/plugin-approval-compat.ts`
- `src/runtime/lynx-check-run-store.ts`
- `src/runtime/managed-lynx-check-authorization-store.ts`
- `src/runtime/scheduled-lynx-check.ts`
- `src/runtime/lynx-message-delivery.ts`
- `src/runtime/lynx-feishu-direct-delivery.ts`
- `src/runtime/recent-active-delivery.ts`
- `src/runtime/message-decoration.ts`
- `src/runtime/local-console-token-hook.ts`
- `src/runtime/local-console-session-token-estimator.ts`
- `src/runtime/local-console-event-builder.ts`
- `src/runtime/local-console-hook-handlers.ts`
- `src/guard/policy/evidence-bundle-builder.ts`
- `src/guard/policy/evidence-scorer.ts`
- `src/guard/policy/policy-engine.ts`
- `src/guard/policy/environment-profile.ts`
- `src/guard/policy/attack-graph.ts`
- `src/guard/policy/artifact-taint-store.ts`

## Task 1: Add API Boundary Tests

**Files:**

- Create: `test/api-boundary.test.ts`

- [x] **Step 1: Write failing API boundary tests**

Create `test/api-boundary.test.ts`:

```ts
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
```

- [x] **Step 2: Run the boundary tests and confirm they fail**

Run:

```powershell
npx vitest run test/api-boundary.test.ts
```

Expected: FAIL, listing current files such as `src/api.ts` and `src/runtime/local-console-client.ts`.

- [x] **Step 3: Commit the failing test**

```powershell
git add test/api-boundary.test.ts
git commit -m "test: capture plugin api boundary"
```

## Task 2: Centralize API Requests Under `src/api`

**Files:**

- Create: `src/api/go-control-plane.ts`
- Create: `src/api/remote-safety-service.ts`
- Create: `src/api/index.ts`
- Modify: `src/api.ts`
- Modify: `src/runtime/decision-broker.ts`
- Modify: `src/runtime/local-console-client.ts`
- Modify: `src/runtime/remote-weighting-service.ts`
- Modify: `src/runtime/api-risk-adapter.ts`
- Delete after imports move: `src/runtime/decision-client.ts`

- [x] **Step 1: Move remote service implementation**

Move the implementation currently in `src/api.ts` into `src/api/remote-safety-service.ts`. The exported names remain:

```ts
export async function registerUser(id: string): Promise<RegisterResponse>;
export async function checkContent(id: string, content: string, contentType: 1 | 2): Promise<ContentCheckResponse>;
export async function checkTool(id: string, content: string): Promise<ToolCheckResponse>;
export async function pushRecord(id: string, content: string, riskLevel: number): Promise<PushRecordResponse>;
export async function checkPublicAccess(id: string, publicIP: string, port: number): Promise<PublicAccessCheckResponse>;
export async function fetchMaliciousSkillBlacklist(): Promise<SkillBlacklistResponse>;
export async function checkSkill(id: string, skillName: string, skillHash: string): Promise<SkillCheckResponse>;
```

- [x] **Step 2: Replace `src/api.ts` with a compatibility shim**

Replace the body of `src/api.ts`:

```ts
export * from "./api/remote-safety-service.js";
```

- [x] **Step 3: Create the Go control-plane client**

Create `src/api/go-control-plane.ts`:

```ts
import type { DecisionRequest, DecisionResponse } from "../../shared/src/decision.js";
import type { LocalConsoleRuntimeConfig } from "../runtime/local-console-config.js";

export type GoDecisionEndpoint = "input" | "tool" | "output" | "install";

export interface GoControlPlaneClientOptions {
  baseUrl?: string;
  config?: Pick<LocalConsoleRuntimeConfig, "baseUrl">;
  getToken?: () => string;
  fetchImpl?: typeof fetch;
}

export class GoControlPlaneClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoControlPlaneClientOptions) {
    this.baseUrl = (options.baseUrl ?? options.config?.baseUrl ?? "").replace(/\/+$/, "");
    this.getToken = options.getToken ?? (() => "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!this.baseUrl) {
      throw new Error("GoControlPlaneClient requires a local console base URL.");
    }
    if (!this.fetchImpl) {
      throw new Error("GoControlPlaneClient requires fetch.");
    }
  }

  decideInput(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    return this.postDecision("input", request, signal);
  }

  decideTool(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    return this.postDecision("tool", request, signal);
  }

  decideOutput(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    return this.postDecision("output", request, signal);
  }

  decideInstall(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    return this.postDecision("install", request, signal);
  }

  private async postDecision(
    endpoint: GoDecisionEndpoint,
    request: DecisionRequest,
    signal?: AbortSignal,
  ): Promise<DecisionResponse> {
    return this.postJson<DecisionResponse>(`/lynx/internal/v1/decision/${endpoint}`, request, signal);
  }

  async postJson<TResponse>(path: string, body: unknown, signal?: AbortSignal): Promise<TResponse> {
    const token = this.getToken().trim();
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Go control-plane API responded with HTTP ${response.status}`);
    }
    return response.json() as Promise<TResponse>;
  }
}
```

- [x] **Step 4: Add the API barrel**

Create `src/api/index.ts`:

```ts
export * from "./go-control-plane.js";
export * from "./remote-safety-service.js";
```

- [x] **Step 5: Update runtime imports**

Replace imports:

```ts
import { DecisionClient } from "./decision-client.js";
```

with:

```ts
import { GoControlPlaneClient } from "../api/go-control-plane.js";
```

Replace remote API imports:

```ts
} from "../api.js";
```

with:

```ts
} from "../api/remote-safety-service.js";
```

- [x] **Step 6: Delete the old decision client**

Delete `src/runtime/decision-client.ts` after all imports are moved.

- [x] **Step 7: Verify API boundary**

Run:

```powershell
npx vitest run test/api-boundary.test.ts
npx tsc --noEmit
```

Expected: tests pass and TypeScript compiles.

- [x] **Step 8: Commit Task 2**

```powershell
git add src/api src/api.ts src/runtime/decision-broker.ts src/runtime/local-console-client.ts src/runtime/remote-weighting-service.ts src/runtime/api-risk-adapter.ts test/api-boundary.test.ts
git add -u src/runtime/decision-client.ts
git commit -m "refactor: centralize plugin api boundaries"
```

## Task 3: Consolidate Approval Runtime Bridge

**Files:**

- Create: `src/approval/approval-bridge.ts`
- Create: `src/approval/approval-context.ts`
- Create: `src/approval/approval-fingerprint.ts`
- Modify: `index.ts`
- Modify: `src/runtime/hook-decision-handlers.ts`
- Delete after imports move: approval-related runtime files listed in the File Map
- Test: existing approval tests under `test/`

- [x] **Step 1: Create approval fingerprint module**

Move `buildApprovalRequestFingerprint` into `src/approval/approval-fingerprint.ts` and export:

```ts
export interface ApprovalFingerprintInput {
  sessionKey?: string;
  toolName?: string;
  command?: string;
  targetUri?: string;
  requesterId?: string;
  channelId?: string;
}

export function buildApprovalRequestFingerprint(input: ApprovalFingerprintInput): string {
  return [
    input.sessionKey ?? "",
    input.toolName ?? "",
    input.command ?? "",
    input.targetUri ?? "",
    input.requesterId ?? "",
    input.channelId ?? "",
  ].join("|");
}
```

- [x] **Step 2: Create approval context module**

Move short-lived approval context and provenance helpers into `src/approval/approval-context.ts`. Preserve these exports used by `index.ts`:

```ts
export {
  readRunApprovalContext,
  saveRunApprovalContext,
  claimRequesterProvenance,
  readRequesterProvenance,
  rememberRequesterProvenance,
};
```

- [x] **Step 3: Create approval bridge module**

Move ephemeral stores and approval runtime helpers into `src/approval/approval-bridge.ts`. Preserve these exports:

```ts
export {
  buildToolApprovalRequest,
  consumeFeishuLocalApprovalGrant,
  consumeFeishuLocalApprovalReplay,
  discardLocalToolApproval,
  getOrCreatePendingToolApproval,
  listLocalToolApprovalsForSession,
  matchApprovalGrant,
  matchFeishuRunContinuation,
  persistGrantFromApproval,
  readLocalToolApprovalByToken,
  registerLocalToolApproval,
  resolvePluginApprovalCompat,
  saveFeishuLocalApprovalGrant,
  saveFeishuLocalApprovalReplay,
  saveFeishuRunContinuation,
  toApprovalRiskLevel,
};
```

Keep durable grant write-through through the Go control-plane client.

- [x] **Step 4: Update imports**

Update `index.ts` and runtime modules to import from `src/approval/*` instead of `src/runtime/*` approval files.

- [x] **Step 5: Delete old approval files**

Delete:

```text
src/runtime/approval-grant-store.ts
src/runtime/local-tool-approval-store.ts
src/runtime/pending-tool-approval-store.ts
src/runtime/run-approval-context-store.ts
src/runtime/workflow-authorization-store.ts
src/runtime/feishu-local-approval-grant-store.ts
src/runtime/feishu-local-approval-replay-store.ts
src/runtime/feishu-run-continuation-store.ts
src/runtime/tool-approval-runtime.ts
src/runtime/approval-request-fingerprint.ts
src/runtime/plugin-approval-compat.ts
```

- [x] **Step 6: Verify approval bridge**

Run:

```powershell
npx vitest run test/*approval*.test.ts
npx tsc --noEmit
```

Expected: approval tests and compile pass.

- [x] **Step 7: Commit Task 3**

```powershell
git add src/approval index.ts src/runtime/hook-decision-handlers.ts
git add -u src/runtime
git commit -m "refactor: consolidate approval bridge"
```

## Task 4: Consolidate Lynx Check Bridge

**Files:**

- Create: `src/lynx-check/lynx-check-bridge.ts`
- Create: `src/lynx-check/scheduled-lynx-check.ts`
- Create: `src/lynx-check/report-producers.ts`
- Modify: `index.ts`
- Modify: `src/discovery/manual-lynx-check.ts`
- Delete after imports move: `src/runtime/lynx-check-run-store.ts`, `src/runtime/managed-lynx-check-authorization-store.ts`, `src/runtime/scheduled-lynx-check.ts`

- [x] **Step 1: Create `lynx-check-bridge.ts`**

Move the local artifact bridge and Go task write-through helpers into `src/lynx-check/lynx-check-bridge.ts`. Preserve these exports:

```ts
export {
  createLynxCheckRun,
  appendLynxCheckRunEvent,
  completeLynxCheckRun,
  failLynxCheckRun,
  readLatestLynxCheckRun,
  grantManagedLynxCheckAuthorization,
  hasManagedLynxCheckAuthorization,
};
```

- [x] **Step 2: Create `scheduled-lynx-check.ts`**

Move scheduled check reconciliation into `src/lynx-check/scheduled-lynx-check.ts`. Preserve:

```ts
export {
  reconcileScheduledLynxCheck,
  resolveScheduledLynxCheckConfig,
};
```

- [x] **Step 3: Create `report-producers.ts`**

Move report producer orchestration into `src/lynx-check/report-producers.ts`. Export:

```ts
export {
  formatAuditSummary,
  runMaliciousScriptScan,
  runSecurityAudit,
};
```

- [x] **Step 4: Update imports and delete old files**

Update `index.ts` and `src/discovery/manual-lynx-check.ts`, then delete:

```text
src/runtime/lynx-check-run-store.ts
src/runtime/managed-lynx-check-authorization-store.ts
src/runtime/scheduled-lynx-check.ts
```

- [x] **Step 5: Verify Lynx Check tests**

Run:

```powershell
npx vitest run test/*lynx-check*.test.ts test/scheduled-lynx-check.test.ts
npx tsc --noEmit
```

Expected: focused tests and compile pass. If `test/scheduled-lynx-check.test.ts` is historical and still failing for pre-existing reasons, document the exact failure and keep the new bridge tests passing.

- [x] **Step 6: Commit Task 4**

```powershell
git add src/lynx-check index.ts src/discovery/manual-lynx-check.ts
git add -u src/runtime
git commit -m "refactor: consolidate lynx check bridge"
```

## Task 5: Consolidate Delivery Bridge

**Files:**

- Create: `src/delivery/message-delivery.ts`
- Create: `src/delivery/recent-delivery.ts`
- Modify: `index.ts`
- Modify: `src/lynx-check/lynx-check-bridge.ts`
- Delete after imports move: `src/runtime/lynx-message-delivery.ts`, `src/runtime/lynx-feishu-direct-delivery.ts`, `src/runtime/recent-active-delivery.ts`, `src/runtime/message-decoration.ts`

- [x] **Step 1: Create message delivery module**

Move outbound message formatting, Feishu direct delivery, and delivery result recording into `src/delivery/message-delivery.ts`. Preserve:

```ts
export {
  appendLocalConsoleWebviewFootnote,
  deliverLynxFeishuApprovalPromptDirectly,
  deliverLynxMessage,
  isTrustedManagedLynxCheckReportText,
};
```

- [x] **Step 2: Create recent delivery module**

Move recent route recovery into `src/delivery/recent-delivery.ts`. Preserve:

```ts
export {
  readRecentActiveDelivery,
  rememberRecentActiveDelivery,
  recoverFeishuDmApprovalContextFromRecentRoute,
};
```

- [x] **Step 3: Update imports and delete old files**

Update all consumers, then delete:

```text
src/runtime/lynx-message-delivery.ts
src/runtime/lynx-feishu-direct-delivery.ts
src/runtime/recent-active-delivery.ts
src/runtime/message-decoration.ts
```

- [x] **Step 4: Verify delivery focused tests**

Run:

```powershell
npx vitest run test/*delivery*.test.ts test/*feishu*.test.ts
npx tsc --noEmit
```

Expected: focused tests and compile pass.

- [x] **Step 5: Commit Task 5**

```powershell
git add src/delivery index.ts src/lynx-check/lynx-check-bridge.ts
git add -u src/runtime
git commit -m "refactor: consolidate delivery bridge"
```

## Task 6: Consolidate Local Console Bridge

**Files:**

- Create: `src/console/ingest-client.ts`
- Create: `src/console/event-builder.ts`
- Create: `src/console/runtime.ts`
- Create: `src/console/token-usage.ts`
- Modify: `index.ts`
- Modify: `src/api/go-control-plane.ts`
- Delete after imports move: local-console runtime files listed in the File Map

- [x] **Step 1: Move ingest client**

Move `createLocalConsoleIngestClient` and ingest types from `src/runtime/local-console-client.ts` into `src/console/ingest-client.ts`. Remove decision URL building from the ingest client.

- [x] **Step 2: Move event builder**

Move event construction from `src/runtime/local-console-event-builder.ts` into `src/console/event-builder.ts`.

- [x] **Step 3: Move console runtime helpers**

Move config, auth, port, launch, supervisor, gateway-route registration, heartbeat filtering, and local-console hook helpers into `src/console/runtime.ts`. Preserve exports currently consumed by `index.ts`.

- [x] **Step 4: Move token usage bridge**

Move token hook and token estimator into `src/console/token-usage.ts`. Keep token source semantics aligned with Go: `actual`, `estimated`, and `unavailable`.

- [x] **Step 5: Delete replaced local-console files**

Delete files after imports move:

```text
src/runtime/local-console-client.ts
src/runtime/local-console-event-builder.ts
src/runtime/local-console-token-hook.ts
src/runtime/local-console-session-token-estimator.ts
src/runtime/local-console-hook-handlers.ts
```

Keep files such as config/auth/port/launch/supervisor only until their exports are merged into `src/console/runtime.ts`, then delete the originals in the same task.

- [x] **Step 6: Verify local console bridge**

Run:

```powershell
npx vitest run test/*local-console*.test.ts test/*token*.test.ts
npx tsc --noEmit
```

Expected: focused tests and compile pass.

- [x] **Step 7: Commit Task 6**

```powershell
git add src/console src/api/go-control-plane.ts index.ts
git add -u src/runtime
git commit -m "refactor: consolidate local console bridge"
```

## Task 7: Slim Guard To Local Enforcement Only

**Files:**

- Create: `src/local-guard/local-l4-fast-path.ts`
- Create: `src/local-guard/output-protection.ts`
- Modify: `src/guard/safety-guard.ts`
- Modify: `src/guard/result-guard.ts`
- Modify: `src/runtime/hook-decision-handlers.ts`
- Modify: `index.ts`
- Delete after imports move: Go-owned `src/guard/policy/*` files listed in the File Map

- [x] **Step 1: Move local L4 enforcement**

Move hard-deny logic required without Go into `src/local-guard/local-l4-fast-path.ts`. Export:

```ts
export {
  evaluateLocalL4Input,
  evaluateLocalL4ToolCall,
  evaluateLocalL4Output,
};
```

These functions must cover plugin-disable, config mutation, protected secret reads, prompt/developer instruction extraction, explicit approval bypass, concealed execution chains, and high-confidence exfiltration.

- [x] **Step 2: Move sync-only output protection**

Move persisted-output redaction and blocking into `src/local-guard/output-protection.ts`. Export:

```ts
export {
  guardAssistantPersistence,
  guardOutputText,
  guardToolResultPersistence,
};
```

- [x] **Step 3: Reduce `safety-guard.ts` to a compatibility facade**

Keep `guardInput`, `guardToolCall`, and `guardOutput` only as wrappers around local L4 and Go decision handling. Remove internal evidence scoring, semantic scoring, long-term session escalation, and policy arbitration from the active path.

- [x] **Step 4: Delete Go-owned policy modules**

Delete:

```text
src/guard/policy/evidence-bundle-builder.ts
src/guard/policy/evidence-scorer.ts
src/guard/policy/policy-engine.ts
src/guard/policy/environment-profile.ts
src/guard/policy/attack-graph.ts
src/guard/policy/artifact-taint-store.ts
```

If a type is still required, move that type into `src/local-guard/local-l4-fast-path.ts` or `shared/src/decision.ts` instead of keeping the policy directory alive.

- [x] **Step 5: Verify local guard behavior**

Run:

```powershell
npx vitest run test/local-l4-fast-path.test.ts test/output-guard-redesign.test.ts test/*safety*.test.ts
npx tsc --noEmit
```

Expected:

- local L4 deny still blocks without Go;
- normal business output is unchanged;
- PEM/API key/system prompt leakage remains blocked or redacted;
- compile passes.

- [x] **Step 6: Commit Task 7**

```powershell
git add src/local-guard src/guard/safety-guard.ts src/guard/result-guard.ts src/runtime/hook-decision-handlers.ts index.ts
git add -u src/guard/policy
git commit -m "refactor: slim guard to local enforcement"
```

## Task 8: Thin `index.ts` Into Hook Orchestration

**Files:**

- Create: `src/hooks/setup.ts`
- Create: `src/hooks/input-hooks.ts`
- Create: `src/hooks/tool-hooks.ts`
- Create: `src/hooks/output-hooks.ts`
- Create: `src/hooks/lifecycle-hooks.ts`
- Modify: `index.ts`

- [x] **Step 1: Create hook setup module**

Create `src/hooks/setup.ts` with:

```ts
import type { OpenClawPluginApi } from "../types.js";

export interface LynxHookRuntime {
  registerInputHooks(api: OpenClawPluginApi): void;
  registerToolHooks(api: OpenClawPluginApi): void;
  registerOutputHooks(api: OpenClawPluginApi): void;
  registerLifecycleHooks(api: OpenClawPluginApi): void;
}

export function registerLynxHooks(api: OpenClawPluginApi, runtime: LynxHookRuntime): void {
  runtime.registerInputHooks(api);
  runtime.registerToolHooks(api);
  runtime.registerOutputHooks(api);
  runtime.registerLifecycleHooks(api);
}
```

- [x] **Step 2: Move input hook handlers**

Move `message_received`, `before_dispatch`, `before_agent_start`, and `before_prompt_build` registration into `src/hooks/input-hooks.ts`.

- [x] **Step 3: Move tool hook handlers**

Move `before_tool_call`, `after_tool_call`, and approval-resolution command handling into `src/hooks/tool-hooks.ts`.

- [x] **Step 4: Move output hook handlers**

Move `llm_output`, `before_message_write`, `tool_result_persist`, and `message_sending` registration into `src/hooks/output-hooks.ts`.

- [x] **Step 5: Move lifecycle hooks**

Move startup, shutdown, scheduled check reconciliation, install hooks, subagent hooks, and local console startup wiring into `src/hooks/lifecycle-hooks.ts`.

- [x] **Step 6: Reduce `index.ts`**

Make `index.ts` contain imports, `setup(api)`, runtime construction, and `registerLynxHooks(api, runtime)`. Keep line count below 2200 in this task.

- [x] **Step 7: Verify hook refactor**

Run:

```powershell
npx vitest run test/plugin.test.ts test/decision-broker.test.ts test/output-guard-redesign.test.ts
npx tsc --noEmit
```

Expected: focused tests and compile pass. If historical `test/plugin.test.ts` still has known unrelated failures, capture the failing test names and run the new hook-specific tests plus compile before moving on.

- [x] **Step 8: Commit Task 8**

```powershell
git add src/hooks index.ts
git commit -m "refactor: thin plugin hook orchestration"
```

## Task 9: Add Final Runtime Slimming Audit

**Files:**

- Create: `test/runtime-slimming-audit.test.ts`
- Modify: imports or files needed to satisfy audit

- [x] **Step 1: Add final audit test**

Create `test/runtime-slimming-audit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "fs";
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

  it("keeps policy-engine files out of the active plugin path", () => {
    const policyFiles = listTsFiles(join(repoRoot, "src"))
      .map((file) => relative(repoRoot, file).replace(/\\/g, "/"))
      .filter((file) => file.startsWith("src/guard/policy/"));

    expect(policyFiles).toEqual([]);
  });
});
```

- [x] **Step 2: Run the audit**

Run:

```powershell
npx vitest run test/runtime-slimming-audit.test.ts test/api-boundary.test.ts
```

Expected: PASS only after the second-stage target is reached.

- [x] **Step 3: Fix remaining imports or remove unused files**

Use TypeScript compile and the audit output to remove remaining unused compatibility files. Do not delete files that still protect local L4, sync-only output, or delivery bridge behavior.

- [x] **Step 4: Commit Task 9**

```powershell
git add test/runtime-slimming-audit.test.ts src index.ts
git add -u src
git commit -m "test: enforce plugin slimming boundary"
```

## Task 10: Full Verification And Runtime Proof

**Files:**

- Modify only packaging scripts if sync shows a real packaging gap.

- [x] **Step 1: Run local TypeScript and root tests**

Run:

```powershell
npx tsc --noEmit
npx vitest run --reporter=json --outputFile=test-results/root-vitest-plugin-slimming.json
```

Expected:

- TypeScript passes.
- Root Vitest passes with the new API boundary and slimming audit tests.

Verification notes:

- `npx tsc --noEmit` passed.
- `npx vitest run --reporter=json --outputFile=test-results/root-vitest-plugin-slimming.json` passed with 145 suites and 557 tests.
- During this pass, `test/manual-lynx-check.test.ts` was corrected to mock `src/api/remote-safety-service.ts`, matching the slimmed API boundary.

- [x] **Step 2: Run backend and frontend checks**

Run:

```powershell
Push-Location backend
go test ./... -count=1
Pop-Location
Push-Location frontend
npx vitest run --reporter=verbose
npx vite build --debug
Pop-Location
```

Expected: Go, frontend tests, and frontend build pass.

Verification notes:

- `Push-Location backend; go test ./... -count=1; Pop-Location` passed.
- `Push-Location frontend; npx vitest run --reporter=verbose; npx vite build --debug; Pop-Location` passed.
- Frontend verification covered 17 files and 38 tests, then completed the Vite build.

- [x] **Step 3: Verify sync readiness**

Run:

```powershell
node scripts/verify-dev-sync.mjs
```

Expected: no blocking packaging error.

Verification notes:

- `node scripts/verify-dev-sync.mjs` passed after adding coverage for the real dev log pattern where the host-mounted duplicate candidate is world-writable but the staged `/app/extensions/openclaw-lynx-guardian` plugin copy loads successfully.

- [x] **Step 4: Sync into real OpenClaw runtime**

Run:

```powershell
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
```

Expected:

- backend and frontend package successfully;
- hooks and skills sync;
- gateway restarts;
- gateway log assessment is not blocked.

Verification notes:

- `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200` passed.
- The wrapper built and packaged backend/frontend outputs, synced hooks and skills, staged the plugin into `/app/extensions/openclaw-lynx-guardian`, restarted the gateway, synced the cron Docker state copy, restarted again, and reported success.

- [x] **Step 5: Verify gateway health**

Run:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz
```

Expected: HTTP 200.

Verification notes:

- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz` returned HTTP 200 with `{"ok":true,"status":"live"}`.

- [x] **Step 6: Run authenticated live probes**

Use the current local bearer token and call the OpenAI-compatible endpoint with these scenarios:

```powershell
$headers = @{
  Authorization = "Bearer 3394aded9042bf1e387f980b3a110c32c71ba964b1c4b40a"
  "Content-Type" = "application/json"
}

$body = @{
  model = "openclaw/main"
  messages = @(@{ role = "user"; content = "reply with pong only" })
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:18789/v1/chat/completions `
  -Headers $headers `
  -Body $body
```

Then run representative requests for:

- normal business text;
- system prompt extraction;
- approval bypass wording;
- `/lynx-check`.

Expected:

- normal request is not blocked;
- system prompt extraction remains denied;
- approval bypass remains warn/approval/block according to Go decision;
- `/lynx-check` still creates a Go task and delivery evidence.

Verification notes:

- Authenticated `openclaw/main` probes verified normal business output, system/developer prompt extraction refusal, and approval-bypass refusal.
- Go decision API evidence included `task12-final2-system` as `L4 deny block:true`, `task12-final2-bypass` as `L3 require_approval block:false requiresApproval:true`, and `task12-final2-tool` plus `task12-final2-exfil` as `L4 deny`.
- `/lynx-check` completed with artifact `C:\Users\24716\.openclaw\lynx\check-runs\lynx-check-1777438505070-nk61a3.result.json`; the result status was `completed`, `sendSucceeded=true`, and the Go `/lynx/lynx-checks` row showed `deliveryStatus=sent`.

- [x] **Step 7: Record final file-count evidence**

Run:

```powershell
Get-ChildItem src -Recurse -File -Filter *.ts | Measure-Object | Select-Object Count
Get-ChildItem src -Directory | ForEach-Object {
  $count=(Get-ChildItem $_.FullName -Recurse -File -Filter *.ts | Measure-Object).Count
  [PSCustomObject]@{Dir=$_.Name; TsFiles=$count}
} | Sort-Object TsFiles -Descending
Get-Content index.ts | Measure-Object -Line
```

Expected:

- `src/**/*.ts <= 60`
- `src/runtime/**/*.ts <= 20`
- `src/guard/**/*.ts <= 10`
- `index.ts < 2200`

Verification notes:

- `src/**/*.ts = 59`
- `src/runtime/**/*.ts = 17`
- `src/guard/**/*.ts = 7`
- `index.ts = 762` lines
- Largest remaining ownership directories: `discovery = 7`, `hooks = 5`, `console = 4`, `local-guard = 3`, `lynx-check = 3`, `skills = 2`, `delivery = 2`, `api = 2`, `approval = 1`.

- [x] **Step 8: Commit runtime packaging changes if needed**

Only run this if packaging scripts changed:

```powershell
git add scripts/sync-openclaw-dev-ready.ps1 scripts/package-local-console-server.mjs
git commit -m "build: package slimmed plugin runtime"
```

Verification notes:

- No packaging scripts needed changes.
- The dev sync log assessment scripts changed because the real runtime loads the staged plugin even when OpenClaw logs the host-mounted duplicate as world-writable; these changes are committed with Task 10 verification evidence instead of committing generated `server/` artifacts.

## Final Acceptance Checklist

- [x] API requests are centralized under `src/api`.
- [x] Local Go control-plane API and remote security-service API are separated.
- [x] `src/api.ts` is a shim only.
- [x] Approval bridge files are consolidated under `src/approval`.
- [x] Lynx Check bridge files are consolidated under `src/lynx-check`.
- [x] Delivery bridge files are consolidated under `src/delivery`.
- [x] Local console bridge files are consolidated under `src/console`.
- [x] Guard code keeps local enforcement only.
- [x] Go-owned policy/state modules are deleted from active plugin path.
- [x] `index.ts` is below 2200 lines and reads as hook orchestration.
- [x] `src/**/*.ts` is at or below 60 files.
- [x] `src/runtime/**/*.ts` is at or below 20 files.
- [x] `src/guard/**/*.ts` is at or below 10 files.
- [x] Local L4 hard deny still works without Go.
- [x] Sync-only output protection still works without Go.
- [x] Real OpenClaw runtime verification passes after sync.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-lynx-guardian-plugin-runtime-slimming.md`.

Recommended execution mode:

1. Subagent-Driven: split API boundary, approval bridge, Lynx Check bridge, delivery/console bridge, guard slimming, and index thinning into separate workers. Workers must not explicitly switch models.
2. Inline Execution: execute tasks in this session with `executing-plans`, completing and verifying one task before marking its checkboxes.

Start with Task 1 and Task 2 before deleting any runtime or guard files.
