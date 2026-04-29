# OpenClaw Security Standard Gap Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Lynx Guardian with the 2026 draft OpenClaw deployment security guidance by making outbound security, approvals, discovery boundaries, component governance, audit retention, and deployment docs secure by default.

**Architecture:** Keep the plugin entry flow intact and harden the existing control points instead of introducing a new subsystem. The work is split into five streams: secure outbound control-plane traffic, safer default runtime boundaries, allowlist-based component governance, durable audit artifacts, and operator-facing documentation cleanup.

**Tech Stack:** TypeScript, Vitest, OpenClaw plugin hooks, JSON config schema, local JSON/JSONL runtime artifacts

---

## Priority Order

- `P0`: Stop unsafe defaults that can leak data or silently expand execution authority.
- `P1`: Add deterministic governance controls and durable audit evidence.
- `P2`: Repair operator docs and compliance mapping so the secure path is also the usable path.

## File Structure

### Existing files to modify

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\config.ts`
  - Remove the hard-coded remote HTTP control-plane default and centralize secure config parsing.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\api.ts`
  - Enforce HTTPS/authenticated outbound requests and trim report payloads to the minimum needed by the backend.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\openclaw.plugin.json`
  - Tighten default config values and add explicit config for outbound auth, component allowlists, and audit retention.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
  - Remove startup-time implicit manual `/lynx-check` preauthorization and wire new audit/allowlist helpers.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery\discovery-runtime-config.ts`
  - Make discovery local-only by default.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery\discovery-hook-utils.ts`
  - Keep auto-expanded discovery targets restricted unless the operator explicitly opts out.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\skills\skill-guard.ts`
  - Add allowlist enforcement and remove trust-on-first-use for protected component names.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\managed-lynx-check-authorization-store.ts`
  - Limit managed grants to scheduled workflows and persist provenance cleanly.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\workflow-authorization-store.ts`
  - Narrow approval reuse and write durable audit entries.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\approval-grant-store.ts`
  - Persist short-lived approval grants instead of keeping them only in memory.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\requester-provenance-store.ts`
  - Persist requester provenance used for approval and traceability.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\README.md`
  - Repair mojibake and publish the secure deployment path.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\skills\openclaw-plugin-dev-workflow\SKILL.md`
  - Remove embedded bearer tokens and replace them with secrets-based operator instructions.

### New files to create

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\security-center-config.ts`
  - Parse outbound security-center config, validate scheme/auth, and expose payload-redaction helpers.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\component-allowlist.ts`
  - Own allowlist matching for Skills, plugins, and MCP component names.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\audit-ledger.ts`
  - Append tamper-evident JSONL audit records with a chained hash.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\asset-inventory.ts`
  - Export a structured component inventory for governance and `/lynx-check` reporting.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\security-center-config.test.ts`
  - Verify HTTPS/auth/localhost exceptions and payload minimization.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\component-allowlist.test.ts`
  - Verify deny-by-default and explicit allow behavior for governed component names.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\audit-ledger.test.ts`
  - Verify audit persistence and hash chaining.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\security-docs-readable.test.ts`
  - Guard operator-facing docs against mojibake regressions.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\dev\2026-04-21-security-standard-alignment.md`
  - Map plugin controls to the draft standard and list residual platform-level gaps.

### Existing tests to extend

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin-runtime-config.test.ts`
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\managed-lynx-check-authorization.test.ts`
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\skill-guard.test.ts`
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

## Task Breakdown

### Task 1: Harden Security-Center Traffic And Secrets Handling

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\security-center-config.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\security-center-config.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\config.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\api.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\openclaw.plugin.json`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\skills\openclaw-plugin-dev-workflow\SKILL.md`

- [ ] **Step 1: Write the failing config-validation tests**

```ts
import { describe, expect, it } from "vitest";
import { resolveSecurityCenterConfig } from "../src/runtime/security-center-config.js";

describe("resolveSecurityCenterConfig", () => {
  it("rejects insecure remote http endpoints", () => {
    expect(() =>
      resolveSecurityCenterConfig({
        apiBaseUrl: "http://162.14.139.55:9051",
      }),
    ).toThrow(/https/i);
  });

  it("allows loopback http for explicit local development", () => {
    expect(
      resolveSecurityCenterConfig({
        apiBaseUrl: "http://127.0.0.1:9051",
        allowInsecureLocalHttp: true,
      }).apiBaseUrl,
    ).toBe("http://127.0.0.1:9051");
  });

  it("requires auth when reporting is enabled", () => {
    expect(() =>
      resolveSecurityCenterConfig({
        apiBaseUrl: "https://security.example.com",
        enabled: true,
      }),
    ).toThrow(/auth/i);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the current code cannot satisfy it**

Run: `npx vitest run test/security-center-config.test.ts`

Expected: FAIL with missing module or missing validation behavior.

- [ ] **Step 3: Add a dedicated outbound config parser with payload-minimization helpers**

```ts
import { createHash } from "crypto";

export interface SecurityCenterConfig {
  enabled: boolean;
  apiBaseUrl?: string;
  authHeaderName?: string;
  authTokenEnvVar?: string;
  allowInsecureLocalHttp: boolean;
}

export function resolveSecurityCenterConfig(input: Partial<SecurityCenterConfig>): SecurityCenterConfig {
  const apiBaseUrl = input.apiBaseUrl?.trim();
  if (!apiBaseUrl) {
    return {
      enabled: false,
      allowInsecureLocalHttp: false,
    };
  }

  const url = new URL(apiBaseUrl);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(isLoopback && input.allowInsecureLocalHttp)) {
    throw new Error("Security center apiBaseUrl must use HTTPS unless loopback http is explicitly allowed");
  }

  const authTokenEnvVar = input.authTokenEnvVar?.trim();
  if ((input.enabled ?? true) && !authTokenEnvVar) {
    throw new Error("Security center auth configuration is required when reporting is enabled");
  }

  return {
    enabled: input.enabled ?? true,
    apiBaseUrl: url.toString().replace(/\/$/, ""),
    authHeaderName: input.authHeaderName?.trim() || "Authorization",
    authTokenEnvVar,
    allowInsecureLocalHttp: Boolean(input.allowInsecureLocalHttp),
  };
}

export function buildRiskRecordPayload(input: {
  userId: string;
  action: string;
  riskLevel: number;
  detail: string;
}) {
  return {
    id: input.userId,
    action: input.action,
    risk_level: input.riskLevel,
    detail_preview: input.detail.slice(0, 200),
    detail_sha256: createHash("sha256").update(input.detail).digest("hex"),
  };
}
```

- [ ] **Step 4: Route all outbound API calls through the secure config and stop hard-coding the remote HTTP default**

```ts
const securityCenter = resolveSecurityCenterConfig({
  enabled: process.env.LYNX_SECURITY_CENTER_ENABLED !== "false",
  apiBaseUrl: process.env.LYNX_API_URL,
  authTokenEnvVar: "LYNX_API_TOKEN",
  allowInsecureLocalHttp: process.env.LYNX_ALLOW_INSECURE_LOCAL_HTTP === "true",
});

async function safeFetch<T>(path: string, body?: unknown): Promise<T> {
  if (!securityCenter.enabled || !securityCenter.apiBaseUrl) {
    throw new Error("Security center integration is not configured");
  }

  const token = process.env[securityCenter.authTokenEnvVar ?? ""];
  if (!token) {
    throw new Error("Security center auth token is missing");
  }

  const response = await fetch(`${securityCenter.apiBaseUrl}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      [securityCenter.authHeaderName ?? "Authorization"]: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Security center responded with ${response.status}`);
  }

  return response.json() as Promise<T>;
}
```

- [ ] **Step 5: Add config-schema/docs wiring and remove embedded token examples**

```json
"securityCenter": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "enabled": { "type": "boolean", "default": false },
    "apiBaseUrl": { "type": "string", "description": "HTTPS URL for the approved security center" },
    "authHeaderName": { "type": "string", "default": "Authorization" },
    "authTokenEnvVar": { "type": "string", "default": "LYNX_API_TOKEN" },
    "allowInsecureLocalHttp": { "type": "boolean", "default": false }
  }
}
```

````md
Do not place bearer tokens in this repo or in any `SKILL.md`.

For local verification, set:

```powershell
$env:LYNX_API_URL="https://security.example.com"
$env:LYNX_API_TOKEN="<token from openclaw secrets or CI secret store>"
```
````

- [ ] **Step 6: Run focused verification**

Run: `npx vitest run test/security-center-config.test.ts test/plugin-runtime-config.test.ts`

Expected: PASS

Run: `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/api.ts src/runtime/security-center-config.ts openclaw.plugin.json skills/openclaw-plugin-dev-workflow/SKILL.md test/security-center-config.test.ts test/plugin-runtime-config.test.ts
git commit -m "feat: harden security center transport and secrets handling"
```

### Task 2: Make Discovery And Approval Defaults Secure By Default

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\openclaw.plugin.json`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery\discovery-runtime-config.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\discovery\discovery-hook-utils.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\managed-lynx-check-authorization-store.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\managed-lynx-check-authorization.test.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\discovery-runtime-config.test.ts`

- [ ] **Step 1: Write the failing secure-default tests**

```ts
import { describe, expect, it } from "vitest";
import { loadDiscoveryRuntimeConfig } from "../src/discovery/discovery-runtime-config.js";
import { hasManagedLynxCheckAuthorization } from "../src/runtime/managed-lynx-check-authorization-store.js";

describe("discovery runtime defaults", () => {
  it("defaults discovery to local-only", () => {
    expect(loadDiscoveryRuntimeConfig().localOnly).toBe(true);
  });
});

describe("managed lynx authorization", () => {
  it("does not auto-grant manual /lynx-check on plugin startup", () => {
    expect(hasManagedLynxCheckAuthorization()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm current defaults are too permissive**

Run: `npx vitest run test/discovery-runtime-config.test.ts test/managed-lynx-check-authorization.test.ts`

Expected: FAIL because discovery defaults to non-local-only and startup grants authorization.

- [ ] **Step 3: Flip discovery to local-only and only expand subnet targets on explicit opt-in**

```ts
const DEFAULT_DISCOVERY_RUNTIME_CONFIG: OpenClawDiscoveryConfig = {
  enabled: true,
  runOnStartup: false,
  fullScan: false,
  localOnly: true,
};

export async function resolveDiscoveryTargets(config: OpenClawDiscoveryConfig): Promise<string[]> {
  const baseTargets = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (config.localOnly !== false) {
    return [...baseTargets];
  }

  // Existing subnet expansion stays behind explicit opt-out.
}
```

- [ ] **Step 4: Remove startup-time manual preauthorization and keep grants scoped to managed scheduled runs**

```ts
if (
  managedLynxCheckAuthorizationConfig.enabled !== false
  && managedLynxCheckAuthorizationConfig.autoGrantOnScheduledJobCreate !== false
  && isScheduledManagedLynxCheckCronContext(runtimeContext)
) {
  grantManagedLynxCheckAuthorization({
    scope: "manual-and-scheduled",
    source: "scheduled-job-create",
  });
}
```

```ts
export interface ManagedLynxCheckAuthorization {
  scope: "scheduled-only";
  source: "scheduled-job-create";
  grantedAtMs: number;
  grantedByPlugin: true;
}
```

- [ ] **Step 5: Tighten schema defaults and document the opt-out path**

```json
"openclawDiscovery": {
  "properties": {
    "localOnly": {
      "type": "boolean",
      "default": true,
      "description": "Restrict automatic target expansion to localhost unless the operator explicitly disables this"
    }
  }
},
"managedLynxCheckAuthorization": {
  "properties": {
    "treatManualLynxCheckAsPreauthorized": {
      "type": "boolean",
      "default": false,
      "description": "Manual /lynx-check must request approval unless separately authorized"
    }
  }
}
```

- [ ] **Step 6: Run focused verification**

Run: `npx vitest run test/discovery-runtime-config.test.ts test/managed-lynx-check-authorization.test.ts test/plugin.test.ts --testNamePattern "lynx-check|discovery"`

Expected: PASS

Run: `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add openclaw.plugin.json index.ts src/discovery/discovery-runtime-config.ts src/discovery/discovery-hook-utils.ts src/runtime/managed-lynx-check-authorization-store.ts test/discovery-runtime-config.test.ts test/managed-lynx-check-authorization.test.ts test/plugin.test.ts
git commit -m "feat: tighten discovery and approval defaults"
```

### Task 3: Add Allowlist-Based Governance For Skills, Plugins, And MCP Components

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\component-allowlist.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\component-allowlist.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\openclaw.plugin.json`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\skills\skill-guard.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\skill-guard.test.ts`

- [ ] **Step 1: Write the failing allowlist tests**

```ts
import { describe, expect, it } from "vitest";
import { evaluateComponentAllowlist } from "../src/runtime/component-allowlist.js";

describe("evaluateComponentAllowlist", () => {
  it("denies unknown skill names when enforcement is enabled", () => {
    const result = evaluateComponentAllowlist({
      kind: "skill",
      name: "random-third-party-skill",
      config: {
        enforce: true,
        allowedSkills: ["lynx-guardian-lesson"],
      },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/allowlist/i);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the allowlist module does not exist yet**

Run: `npx vitest run test/component-allowlist.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Add a shared allowlist evaluator**

```ts
export interface ComponentAllowlistConfig {
  enforce: boolean;
  allowedSkills?: string[];
  allowedPlugins?: string[];
  allowedMcpServers?: string[];
}

export function evaluateComponentAllowlist(input: {
  kind: "skill" | "plugin" | "mcp";
  name: string;
  config: ComponentAllowlistConfig;
}): { allowed: boolean; reason?: string } {
  if (!input.config.enforce) {
    return { allowed: true };
  }

  const pools = {
    skill: input.config.allowedSkills ?? [],
    plugin: input.config.allowedPlugins ?? [],
    mcp: input.config.allowedMcpServers ?? [],
  };

  const allowed = pools[input.kind].some((entry) => entry === input.name);
  return allowed
    ? { allowed: true }
    : { allowed: false, reason: `${input.kind} "${input.name}" is not in the approved allowlist` };
}
```

- [ ] **Step 4: Enforce the allowlist before blacklist and integrity checks**

```ts
const allowDecision = evaluateComponentAllowlist({
  kind: "skill",
  name: installAttempt.skillName,
  config: componentAllowlistConfig,
});

if (!allowDecision.allowed) {
  return {
    block: true,
    blockReason: `[Lynx Guardian] Approved component policy blocked Skill install: ${allowDecision.reason}`,
  };
}
```

```json
"componentAllowlist": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "enforce": { "type": "boolean", "default": false },
    "allowedSkills": { "type": "array", "items": { "type": "string" } },
    "allowedPlugins": { "type": "array", "items": { "type": "string" } },
    "allowedMcpServers": { "type": "array", "items": { "type": "string" } }
  }
}
```

- [ ] **Step 5: Remove trust-on-first-use for protected names**

```ts
if (!entry) {
  return {
    authentic: false,
    reason: `Skill "${name}" has no approved baseline hash; add it to the allowlist/registry before installation`,
  };
}
```

- [ ] **Step 6: Run focused verification**

Run: `npx vitest run test/component-allowlist.test.ts test/skill-guard.test.ts`

Expected: PASS

Run: `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add openclaw.plugin.json index.ts src/runtime/component-allowlist.ts src/skills/skill-guard.ts test/component-allowlist.test.ts test/skill-guard.test.ts
git commit -m "feat: add allowlist-based component governance"
```

### Task 4: Persist Durable, Tamper-Evident Audit Records And Asset Inventory

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\audit-ledger.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\asset-inventory.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\audit-ledger.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\approval-grant-store.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\requester-provenance-store.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\workflow-authorization-store.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-check-run-store.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`

- [ ] **Step 1: Write the failing audit-ledger tests**

```ts
import { describe, expect, it } from "vitest";
import { appendAuditRecord, readAuditRecords } from "../src/runtime/audit-ledger.js";

describe("audit ledger", () => {
  it("writes chained hash records for approval decisions", () => {
    appendAuditRecord({
      category: "approval",
      action: "allow-once",
      actor: "feishu:user-1",
      target: "before_tool_call:exec",
    });

    const records = readAuditRecords();
    expect(records).toHaveLength(1);
    expect(records[0].hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the ledger module is missing**

Run: `npx vitest run test/audit-ledger.test.ts`

Expected: FAIL with missing module.

- [ ] **Step 3: Add an append-only JSONL ledger with chained hashes**

```ts
export interface AuditLedgerRecord {
  timestamp: number;
  category: "approval" | "workflow" | "requester" | "delivery";
  action: string;
  actor: string;
  target: string;
  details?: Record<string, unknown>;
  previousHash: string;
  hash: string;
}

export function appendAuditRecord(input: Omit<AuditLedgerRecord, "timestamp" | "previousHash" | "hash">) {
  const previousHash = readLastAuditHash();
  const timestamp = Date.now();
  const body = { timestamp, previousHash, ...input };
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  appendFileSync(resolveAuditLedgerPath(), `${JSON.stringify({ ...body, hash })}\n`, "utf8");
}
```

- [ ] **Step 4: Persist approval/provenance events and narrow workflow grant reuse**

```ts
saveApprovalGrant(grant);
appendAuditRecord({
  category: "approval",
  action: "grant",
  actor: grant.requesterOuId ?? "unknown",
  target: grant.module,
  details: {
    risk: grant.maxRiskLevel,
    expiresAt: grant.expiresAt,
  },
});
```

```ts
rememberRequesterProvenance(record);
appendAuditRecord({
  category: "requester",
  action: "seen",
  actor: record.requesterOuId ?? record.requesterId ?? "unknown",
  target: record.channelId ?? record.sessionKey ?? "unknown",
});
```

```ts
if (auth.scopeAll) {
  throw new Error("scopeAll workflow authorization is no longer allowed for standard-aligned builds");
}
```

- [ ] **Step 5: Export component inventory for governance and `/lynx-check`**

```ts
export interface AssetInventorySnapshot {
  generatedAtMs: number;
  pluginVersion: string;
  installedSkills: string[];
  configuredMcpServers: string[];
  enabledScheduledJobs: string[];
}

export function buildAssetInventorySnapshot(): AssetInventorySnapshot {
  return {
    generatedAtMs: Date.now(),
    pluginVersion: manifest.version,
    installedSkills: listInstalledSkills(),
    configuredMcpServers: listConfiguredMcpServers(),
    enabledScheduledJobs: listManagedJobs(),
  };
}
```

- [ ] **Step 6: Run focused verification**

Run: `npx vitest run test/audit-ledger.test.ts test/plugin.test.ts --testNamePattern "approval|workflow|audit"`

Expected: PASS

Run: `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add index.ts src/runtime/audit-ledger.ts src/runtime/asset-inventory.ts src/runtime/approval-grant-store.ts src/runtime/requester-provenance-store.ts src/runtime/workflow-authorization-store.ts src/runtime/lynx-check-run-store.ts test/audit-ledger.test.ts test/plugin.test.ts
git commit -m "feat: persist tamper-evident audit and asset records"
```

### Task 5: Repair Documentation, Encoding, And Standard Mapping

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\README.md`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\openclaw.plugin.json`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\skills\lynx-guardian-lesson\SX-self-safety-guard\SKILL.md`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\skills\openclaw-plugin-dev-workflow\SKILL.md`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\dev\2026-04-21-security-standard-alignment.md`

- [ ] **Step 1: Write the failing regression test for mojibake-sensitive docs**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

const suspiciousFragments = ["閳", "鈥", "Ã", "锟", "\uFFFD"];

describe("security docs readability", () => {
  it("does not contain common mojibake fragments in operator-facing files", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).not.toContain("鈥?");
    expect(readme).not.toContain("锛");
    expect(readme).not.toContain("鐚");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm current docs fail readability**

Run: `npx vitest run test/security-docs-readable.test.ts`

Expected: FAIL because current README/skills contain mojibake.

- [ ] **Step 3: Repair README and operator instructions to match the secure path**

```md
## Secure Deployment Defaults

- Bind OpenClaw to `127.0.0.1` unless a reviewed deployment requires broader exposure.
- Configure `securityCenter.apiBaseUrl` with an approved HTTPS endpoint.
- Store `LYNX_API_TOKEN` in OpenClaw secrets or your platform secret store, never in this repository.
- Keep `openclawDiscovery.localOnly=true` unless a reviewed network scan is required.
- Require explicit approval for manual `/lynx-check` and any high-risk tool operation.
```

- [ ] **Step 4: Repair skill text and replace embedded credentials with placeholders**

````md
If validating the local OpenClaw-compatible API, load the bearer token from your local secret store:

```powershell
$headers = @{
  Authorization = "Bearer $env:OPENCLAW_LOCAL_TOKEN"
  "Content-Type" = "application/json"
}
```

Do not commit concrete bearer tokens, webhook URLs, or operator account identifiers.
````

- [ ] **Step 5: Add a standard-mapping document with residual gaps**

```md
## Covered In Plugin

- 6.2.d component allowlist enforcement
- 6.2.f encrypted/secret-based credential handling
- 6.2.g approval for high-risk operations
- 7.4.f durable audit logging

## Requires Platform Or Organization Controls

- 7.1 snapshot/rollback
- 7.2 centralized identity management
- 8.b asset register outside the plugin runtime
- 8.e employee security education
```

- [ ] **Step 6: Run focused verification**

Run: `npx vitest run test/security-docs-readable.test.ts`

Expected: PASS

Run: `npx tsc --noEmit`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add README.md openclaw.plugin.json skills/lynx-guardian-lesson/SX-self-safety-guard/SKILL.md skills/openclaw-plugin-dev-workflow/SKILL.md docs/dev/2026-04-21-security-standard-alignment.md test/security-docs-readable.test.ts
git commit -m "docs: align operator guidance with security standard"
```

## Self-Review

### Spec coverage

- Outbound auth/TLS and secret handling are covered by Task 1.
- Approval and discovery boundary hardening are covered by Task 2.
- Skills/plugins/MCP allowlist governance is covered by Task 3.
- Audit traceability and inventory support are covered by Task 4.
- Operator guidance, mojibake cleanup, and standard mapping are covered by Task 5.
- Remaining platform-only gaps are documented instead of being falsely assigned to plugin code.

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation notes remain in the task steps.
- Every code-changing step includes a concrete code sketch.
- Every verification step includes an exact command and expected result.

### Type consistency

- `SecurityCenterConfig`, `ComponentAllowlistConfig`, `AuditLedgerRecord`, and `AssetInventorySnapshot` are defined before later tasks refer to them.
- Approval-related tasks keep the existing `ApprovalRiskLevel` naming and narrow behavior without renaming the surrounding runtime concepts.

## Execution Notes

- Execute `P0` tasks first: Task 1 and Task 2.
- Do not start Task 3 before Task 1 lands, because allowlist decisions should use the secure outbound config for any optional remote verification.
- Do not claim standard alignment complete until at least one real OpenClaw runtime validation has been run after `P0` and `P1`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-openclaw-security-standard-gap-remediation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
