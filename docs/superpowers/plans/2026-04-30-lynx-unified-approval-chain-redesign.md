# Lynx Unified Approval And Chain Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace duplicate approval prompts with one system approval surface per risky operation, make temporary release lifecycle-safe, and make advanced chain pages explain which prompts and operations they cover.

**Architecture:** Lynx owns risk classification, hard-deny boundaries, temporary release scope, and local-console audit data. OpenClaw native exec approval remains the authority for executing commands; non-exec L3 tools use system plugin/generic approval. OpenClaw core needs one small approval-context extension before Lynx risk text can appear inside the native exec approval card.

**Tech Stack:** TypeScript plugin runtime, Go local-console backend, React + Vite frontend, SQLite, focused Vitest, focused Go contract tests, Playwright/Chrome screenshot checks for rendered webview verification.

---

## Source Spec

Implement against:

- `docs/superpowers/specs/2026-04-30-lynx-unified-approval-chain-redesign-spec.md`

Keep these product constraints active:

- Do not modify `问答记录` in this pass.
- Do not prioritize plugin sync-path changes in this pass.
- Do not edit `D:\all-works\openclaw` until the user explicitly expands edit scope for OpenClaw core.
- Do not claim native exec approval can show Lynx risk context until OpenClaw core accepts and renders a plugin approval-context field.

## File Map

Lynx plugin runtime:

- Create: `src/approval/tool-approval-surface.ts`
- Modify: `src/approval/approval-bridge.ts`
- Modify: `src/approval/approval-prompts.ts`
- Modify: `src/hooks/tool-hooks.ts`
- Modify: `src/hooks/input-hooks.ts`
- Modify: `src/hooks/lifecycle-hooks.ts`
- Modify: `src/console/event-builder.ts`
- Modify: `src/types.ts`

Lynx tests:

- Create: `test/tool-approval-surface.test.ts`
- Modify: `test/tool-approval-runtime.test.ts`
- Modify: `test/approval-channel-alignment.test.ts`
- Modify: `test/local-console-event-builder.test.ts`
- Modify: `test/plugin.test.ts`
- Modify: `test/regression.test.ts`

Go backend:

- Modify: `backend/internal/api/dto.go`
- Modify: `backend/internal/repo/chains.go`
- Modify: `backend/internal/routes/chains.go`
- Modify: `backend/internal/chain/service.go`
- Modify: `backend/internal/repo/grants.go`
- Test: `backend/test/grants_routes_contract_test.go`
- Create: `backend/test/chains_prompt_coverage_contract_test.go`

Frontend:

- Modify: `frontend/src/api/chains.ts`
- Modify: `frontend/src/api/grants.ts`
- Modify: `frontend/src/app/nav-config.ts`
- Modify: `frontend/src/components/layout/TopBar.tsx`
- Modify: `frontend/src/components/layout/SidebarNav.tsx`
- Modify: `frontend/src/components/layout/ConsoleLayout.tsx`
- Modify: `frontend/src/pages/ChainsPage.tsx`
- Modify: `frontend/src/pages/GrantsPage.tsx`
- Modify: `frontend/src/styles/theme.css`
- Modify: `frontend/test/pages/ChainsPage.test.tsx`
- Modify: `frontend/test/pages/GrantsPage.test.tsx`
- Modify: `frontend/test/app/App.test.tsx`

OpenClaw core gated by user approval:

- Modify: `D:\all-works\openclaw\src\plugins\hook-types.ts`
- Modify: `D:\all-works\openclaw\src\agents\pi-tools.before-tool-call.ts`
- Modify: `D:\all-works\openclaw\src\agents\pi-tool-definition-adapter.ts`
- Modify: `D:\all-works\openclaw\src\agents\bash-tools.exec-types.ts`
- Modify: `D:\all-works\openclaw\src\agents\bash-tools.exec-runtime.ts`
- Modify: `D:\all-works\openclaw\src\agents\bash-tools.exec-host-gateway.ts`
- Test: `D:\all-works\openclaw\src\plugins\hooks.before-tool-call.test.ts`
- Test: `D:\all-works\openclaw\src\agents\pi-tools.before-tool-call.e2e.test.ts`
- Test: `D:\all-works\openclaw\src\agents\bash-tools.exec-host-shared.test.ts`

---

## Phase 0: Pre-Flight

### Task 0.1: Confirm Dirty Baseline

**Files:** none

- [ ] **Step 1: Check current repo status**

Run:

```powershell
git status --short
```

Expected known dirty files before this plan:

```text
 M server/backend/lynx-server-linux-x64
 M server/backend/lynx-server-win32-x64.exe
 M src/guard/safety-guard.ts
 M src/hooks/input-hooks.ts
 M test/approval-channel-alignment.test.ts
 M test/safety-guard.test.ts
```

- [ ] **Step 2: Confirm the new Superpowers docs read as UTF-8**

Run:

```powershell
node -e "const fs=require('fs'); for (const p of ['docs/superpowers/specs/2026-04-30-lynx-unified-approval-chain-redesign-spec.md','docs/superpowers/plans/2026-04-30-lynx-unified-approval-chain-redesign.md']) { const s=fs.readFileSync(p,'utf8'); console.log('--- '+p); console.log(s.slice(0,800)); }"
```

Expected:

- Chinese text is readable.
- The plan states that OpenClaw core changes are gated by explicit user approval.

---

## Phase 1: Approval Surface Routing In Lynx

### Task 1.1: Add A Small Approval Surface Classifier

**Files:**

- Create: `src/approval/tool-approval-surface.ts`
- Create: `test/tool-approval-surface.test.ts`

- [ ] **Step 1: Write the failing classifier tests**

Add `test/tool-approval-surface.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveToolApprovalSurface } from "../src/approval/tool-approval-surface.js";

describe("tool approval surface routing", () => {
  it("hard-denies L4 instead of requesting approval", () => {
    expect(resolveToolApprovalSurface({
      toolName: "exec",
      riskLevel: "L4",
      modules: ["M5:credential_theft"],
      nativeExecApprovalAvailable: true,
      systemPluginApprovalAvailable: true,
    }).surface).toBe("hard-deny");
  });

  it("routes risky exec to native exec approval context", () => {
    expect(resolveToolApprovalSurface({
      toolName: "exec",
      riskLevel: "L3",
      modules: ["chain_context"],
      nativeExecApprovalAvailable: true,
      systemPluginApprovalAvailable: true,
    })).toMatchObject({
      surface: "exec-native",
      requiresOpenClawApprovalContext: true,
    });
  });

  it("routes risky non-exec tools to system plugin approval", () => {
    for (const toolName of ["read", "write", "edit", "cron", "gateway", "feishu_doc"]) {
      expect(resolveToolApprovalSurface({
        toolName,
        riskLevel: "L3",
        modules: ["M2:protected_file_access"],
        nativeExecApprovalAvailable: true,
        systemPluginApprovalAvailable: true,
      }).surface).toBe("plugin-native");
    }
  });

  it("fails closed when non-exec L3 has no approval route", () => {
    expect(resolveToolApprovalSurface({
      toolName: "read",
      riskLevel: "L3",
      modules: ["M2:protected_file_access"],
      nativeExecApprovalAvailable: false,
      systemPluginApprovalAvailable: false,
    })).toMatchObject({
      surface: "block-no-approval-route",
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
npx vitest run test/tool-approval-surface.test.ts --no-color
```

Expected:

- Fails because `src/approval/tool-approval-surface.ts` does not exist.

- [ ] **Step 3: Add the classifier implementation**

Create `src/approval/tool-approval-surface.ts`:

```ts
export type ApprovalSurface =
  | "allow"
  | "hard-deny"
  | "exec-native"
  | "plugin-native"
  | "block-no-approval-route";

export type ApprovalRiskLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type ToolApprovalSurfaceInput = {
  toolName: string;
  riskLevel: ApprovalRiskLevel;
  modules: string[];
  nativeExecApprovalAvailable: boolean;
  systemPluginApprovalAvailable: boolean;
};

export type ToolApprovalSurfaceResult = {
  surface: ApprovalSurface;
  requiresOpenClawApprovalContext: boolean;
  reason: string;
};

const NON_EXEC_APPROVAL_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "cron",
  "gateway",
  "feishu_doc",
  "feishu_drive",
  "feishu_wiki",
  "feishu_bitable_update_record",
  "feishu_bitable_create_record",
]);

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

export function resolveToolApprovalSurface(input: ToolApprovalSurfaceInput): ToolApprovalSurfaceResult {
  const toolName = normalizeToolName(input.toolName);
  if (input.riskLevel === "L4") {
    return {
      surface: "hard-deny",
      requiresOpenClawApprovalContext: false,
      reason: "L4 is not approvable",
    };
  }
  if (input.riskLevel !== "L2" && input.riskLevel !== "L3") {
    return {
      surface: "allow",
      requiresOpenClawApprovalContext: false,
      reason: "risk level does not require approval",
    };
  }
  if (toolName === "exec") {
    return input.nativeExecApprovalAvailable
      ? {
          surface: "exec-native",
          requiresOpenClawApprovalContext: true,
          reason: "exec must use OpenClaw native exec approval",
        }
      : {
          surface: "plugin-native",
          requiresOpenClawApprovalContext: false,
          reason: "native exec approval is unavailable",
        };
  }
  if (NON_EXEC_APPROVAL_TOOLS.has(toolName)) {
    return input.systemPluginApprovalAvailable
      ? {
          surface: "plugin-native",
          requiresOpenClawApprovalContext: false,
          reason: "non-exec risky tool uses system plugin approval",
        }
      : {
          surface: "block-no-approval-route",
          requiresOpenClawApprovalContext: false,
          reason: "no approval route for risky non-exec tool",
        };
  }
  return {
    surface: "plugin-native",
    requiresOpenClawApprovalContext: false,
    reason: "risky tool uses plugin approval",
  };
}
```

- [ ] **Step 4: Verify the classifier test passes**

Run:

```powershell
npx vitest run test/tool-approval-surface.test.ts --no-color
```

Expected:

- Pass.

### Task 1.2: Use The Classifier In Tool Hooks

**Files:**

- Modify: `src/hooks/tool-hooks.ts`
- Modify: `test/approval-channel-alignment.test.ts`
- Modify: `test/plugin.test.ts`

- [ ] **Step 1: Add failing tests for duplicate approval prevention**

Extend `test/approval-channel-alignment.test.ts` with tests that assert:

```ts
expect(result?.requireApproval).toBeUndefined();
expect(JSON.stringify(result ?? {})).not.toContain("/approve");
expect(JSON.stringify(result ?? {})).not.toContain("确认放行本次操作");
```

Use an L3 `exec` tool-call fixture with native approval available.

- [ ] **Step 2: Run the focused test**

Run:

```powershell
npx vitest run test/approval-channel-alignment.test.ts --no-color
```

Expected:

- Fails because `tool-hooks.ts` still returns `requireApproval` for exec in the Lynx path.

- [ ] **Step 3: Route exec L2/L3 away from Lynx plugin approval**

In `src/hooks/tool-hooks.ts`, before returning `requireApproval: buildToolApprovalRequest(...)`, call `resolveToolApprovalSurface(...)`.

Required behavior:

```ts
if (surface.surface === "hard-deny") {
  return { block: true, blockReason };
}

if (surface.surface === "exec-native") {
  // Until OpenClaw core supports approvalContext, do not create a second Lynx approval popup.
  // Keep audit/local-console records, then let OpenClaw exec approval handle execution.
  return {};
}

if (surface.surface === "block-no-approval-route") {
  return {
    block: true,
    blockReason: "[Lynx Guardian] 当前通道无法完成安全审批，已阻止该高风险操作。",
  };
}
```

For `plugin-native`, keep `buildToolApprovalRequest(...)`.

- [ ] **Step 4: Verify focused approval tests**

Run:

```powershell
npx vitest run test/tool-approval-surface.test.ts test/approval-channel-alignment.test.ts --no-color
```

Expected:

- Pass or fail only on assertions that need fixture updates.
- No L3 exec fixture returns Lynx plugin `requireApproval`.

---

## Phase 2: OpenClaw Core Approval Context Extension

This phase is gated. Do not edit `D:\all-works\openclaw` until the user explicitly authorizes OpenClaw core changes.

### Task 2.1: Add A Hook Approval Context Field In OpenClaw Core

**Files:**

- Modify: `D:\all-works\openclaw\src\plugins\hook-types.ts`
- Modify: `D:\all-works\openclaw\src\plugins\hooks.before-tool-call.test.ts`

- [ ] **Step 1: Add failing hook type/merge tests**

In `hooks.before-tool-call.test.ts`, add a case where a plugin returns:

```ts
approvalContext: {
  title: "Lynx Guardian",
  description: "[Lynx Guardian] L3 高风险：命令执行涉及敏感路径。",
  severity: "critical",
}
```

Expected merged hook result:

```ts
expect(result?.approvalContext).toMatchObject({
  title: "Lynx Guardian",
  severity: "critical",
});
```

- [ ] **Step 2: Extend hook result type**

In `hook-types.ts`, add:

```ts
export type PluginApprovalContext = {
  title?: string;
  description: string;
  severity?: "info" | "warning" | "critical";
  sourcePluginId?: string;
};
```

Then add to `PluginHookBeforeToolCallResult`:

```ts
approvalContext?: PluginApprovalContext;
```

- [ ] **Step 3: Merge first approval context**

In the hook merger, keep the first plugin approval context and attach `sourcePluginId` when absent.

- [ ] **Step 4: Run focused OpenClaw hook tests**

Run from `D:\all-works\openclaw`:

```powershell
npx vitest run src/plugins/hooks.before-tool-call.test.ts --no-color
```

Expected:

- Pass.

### Task 2.2: Carry Approval Context To Exec Approval Warning Text

**Files:**

- Modify: `D:\all-works\openclaw\src\agents\pi-tools.before-tool-call.ts`
- Modify: `D:\all-works\openclaw\src\agents\pi-tool-definition-adapter.ts`
- Modify: `D:\all-works\openclaw\src\agents\bash-tools.exec-types.ts`
- Modify: `D:\all-works\openclaw\src\agents\bash-tools.exec-runtime.ts`
- Modify: `D:\all-works\openclaw\src\agents\bash-tools.exec-host-gateway.ts`
- Test: `D:\all-works\openclaw\src\agents\pi-tools.before-tool-call.e2e.test.ts`
- Test: `D:\all-works\openclaw\src\agents\bash-tools.exec-host-shared.test.ts`

- [ ] **Step 1: Add failing tests**

Add one before-tool-call e2e test:

```ts
expect(outcome).toMatchObject({
  blocked: false,
  approvalContext: {
    description: expect.stringContaining("Lynx Guardian"),
  },
});
```

Add one exec approval pending message test:

```ts
expect(text).toContain("[Lynx Guardian]");
expect(text).toContain("L3");
expect(text).toContain("Reply with: /approve");
```

- [ ] **Step 2: Extend `HookOutcome`**

In `pi-tools.before-tool-call.ts`, change:

```ts
type HookOutcome =
  | { blocked: true; reason: string }
  | { blocked: false; params: unknown; approvalContext?: PluginApprovalContext };
```

When `hookResult?.approvalContext` exists, return it with the non-blocked outcome.

- [ ] **Step 3: Attach context to exec warning text**

In the exec path, format approval context as:

```ts
function formatApprovalContextWarning(ctx?: PluginApprovalContext): string {
  if (!ctx?.description.trim()) return "";
  const title = ctx.title?.trim() || "Plugin approval context";
  return `${title}\n${ctx.description.trim()}`;
}
```

Append the formatted text to the existing `warnings` array before `buildExecApprovalPendingToolResult(...)` creates the approval-pending payload.

- [ ] **Step 4: Run focused OpenClaw tests**

Run from `D:\all-works\openclaw`:

```powershell
npx vitest run src/agents/pi-tools.before-tool-call.e2e.test.ts src/agents/bash-tools.exec-host-shared.test.ts --no-color
```

Expected:

- Pass.

### Task 2.3: Emit Approval Context From Lynx For Exec

**Files:**

- Modify: `src/hooks/tool-hooks.ts`
- Modify: `src/types.ts`
- Modify: `test/approval-channel-alignment.test.ts`

- [ ] **Step 1: Add failing Lynx test**

Assert that risky `exec` returns no `requireApproval` and includes:

```ts
expect((result as any).approvalContext.description).toContain("[Lynx Guardian]");
expect((result as any).approvalContext.description).toContain("L3");
```

- [ ] **Step 2: Add the returned context**

When `resolveToolApprovalSurface(...).surface === "exec-native"`, return:

```ts
return {
  approvalContext: {
    title: "Lynx Guardian",
    description: buildLynxApprovalContextText({
      module: primaryModule,
      riskLevel: approvalRiskLevel,
      reason: blockReason,
      scope: "仅当前链路、当前命令和同等风险范围",
    }),
    severity: approvalRiskLevel === "L3" ? "critical" : "warning",
  },
} as any;
```

- [ ] **Step 3: Run Lynx tests**

Run:

```powershell
npx vitest run test/approval-channel-alignment.test.ts --no-color
```

Expected:

- Pass once OpenClaw hook type support is available.

---

## Phase 3: Temporary Release Scope And Lifecycle

### Task 3.1: Extend In-Memory Grant Scope

**Files:**

- Modify: `src/approval/approval-bridge.ts`
- Modify: `test/tool-approval-runtime.test.ts`

- [ ] **Step 1: Add failing grant scope tests**

Add tests that verify:

```ts
expect(matchApprovalGrant({
  chainId: "chain-1",
  sessionKey: "session-1",
  requesterOuId: "ou-a",
  toolName: "exec",
  module: "M2:protected_file_access",
  riskLevel: "L3",
  targetFingerprint: "cmd:abc",
})).toBeTruthy();

expect(matchApprovalGrant({
  chainId: "chain-1",
  sessionKey: "session-1",
  requesterOuId: "ou-a",
  toolName: "exec",
  module: "M2:protected_file_access",
  riskLevel: "L3",
  targetFingerprint: "cmd:expanded",
})).toBeUndefined();
```

- [ ] **Step 2: Extend `ApprovalGrant`**

Add fields:

```ts
chainId?: string;
sessionKey?: string;
runId?: string;
toolName?: string;
targetFingerprint?: string;
revokedReason?: string;
```

- [ ] **Step 3: Match by exact or narrower scope**

Implement matching rules:

- session key must match when both sides have it
- chain id must match when both sides have it
- requester id must match
- module must match
- tool name must match
- risk level must be same or lower
- target fingerprint must match exactly for the first pass

- [ ] **Step 4: Run focused test**

Run:

```powershell
npx vitest run test/tool-approval-runtime.test.ts --no-color
```

Expected:

- Pass.

### Task 3.2: Clear Plugin Memory Grants On Lifecycle End

**Files:**

- Modify: `src/approval/approval-bridge.ts`
- Modify: `src/hooks/lifecycle-hooks.ts`
- Modify: `src/hooks/output-hooks.ts`
- Test: `test/tool-approval-runtime.test.ts`

- [ ] **Step 1: Add failing lifecycle tests**

Test that:

```ts
saveApprovalGrant({
  grantId: "grant-1",
  sessionKey: "session-1",
  chainId: "chain-1",
  requesterOuId: "ou-a",
  module: "M2:protected_file_access",
  toolName: "exec",
  targetFingerprint: "cmd:abc",
  maxRiskLevel: "L3",
  createdAt: 1,
  expiresAt: Date.now() + 60_000,
  sourceApprovalId: "approval-1",
});

expect(revokeApprovalGrantsForLifecycle({
  sessionKey: "session-1",
  chainId: "chain-1",
  reason: "agent_end",
})).toBe(1);
```

- [ ] **Step 2: Implement lifecycle revocation helper**

Add:

```ts
export function revokeApprovalGrantsForLifecycle(input: {
  sessionKey?: string;
  chainId?: string;
  runId?: string;
  reason: string;
}): number {
  let revoked = 0;
  for (const [sourceKey, grants] of approvalGrantsBySource) {
    const active = grants.filter((grant) => {
      const sameSession = input.sessionKey && grant.sessionKey === input.sessionKey;
      const sameChain = input.chainId && grant.chainId === input.chainId;
      const sameRun = input.runId && grant.runId === input.runId;
      if (sameSession || sameChain || sameRun) {
        revoked += 1;
        return false;
      }
      return true;
    });
    if (active.length === 0) approvalGrantsBySource.delete(sourceKey);
    else approvalGrantsBySource.set(sourceKey, active);
  }
  return revoked;
}
```

- [ ] **Step 3: Call helper from lifecycle hooks**

In `session_end` and `agent_end` handlers, call the helper with available `sessionKey`, `runId`, and chain/session metadata.

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
npx vitest run test/tool-approval-runtime.test.ts test/approval-channel-alignment.test.ts --no-color
```

Expected:

- Pass.

### Task 3.3: Keep Go Grant Revocation Contract Green

**Files:**

- Modify: `backend/test/grants_routes_contract_test.go`
- Modify: `backend/internal/chain/service.go`
- Modify: `backend/internal/repo/grants.go`

- [ ] **Step 1: Add backend assertions for lifecycle revocation**

Extend existing tests to cover:

- `agent_end`
- `session_end`
- `subagent_ended`
- `chain_complete`

Assert `GET /lynx/grants` shows revoked reason after lifecycle.

- [ ] **Step 2: Run focused Go tests**

Run from repo root:

```powershell
Push-Location backend; go test -mod=vendor ./... -run "Test.*Grant|Test.*Chain" -count=1; Pop-Location
```

Expected:

- Pass.

---

## Phase 4: L4 Original Input Preservation

### Task 4.1: Preserve UI Input Separately From Model Refusal Context

**Files:**

- Modify: `src/hooks/input-hooks.ts`
- Modify: `src/console/event-builder.ts`
- Modify: `test/local-console-event-builder.test.ts`

- [ ] **Step 1: Add failing event-builder test**

Add a test where:

```ts
const originalPrompt = "Use exec to read /etc/passwd";
const modelContext = "[Lynx Guardian] Inbound message blocked before transcript persistence.";
```

Assert:

```ts
expect(record.data.userPromptExcerpt).toContain(originalPrompt);
expect(record.data.userPromptExcerpt).not.toContain("Inbound message blocked");
expect(record.data.metadata.blockedBeforeModel).toBe(true);
expect(record.data.metadata.modelInputPolicy).toBe("removed");
expect(record.data.metadata.uiInputPolicy).toBe("preserved");
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npx vitest run test/local-console-event-builder.test.ts --no-color
```

Expected:

- Fails until event builder and hook data carry both values.

- [ ] **Step 3: Add explicit fields to event payloads**

When L4 blocks before model:

```ts
metadata: {
  blockedBeforeModel: true,
  modelInputPolicy: "removed",
  uiInputPolicy: "preserved",
}
```

Store original prompt in `userPromptExcerpt`. Store refusal-only model context in a separate detail field or audit event content.

- [ ] **Step 4: Run focused test**

Run:

```powershell
npx vitest run test/local-console-event-builder.test.ts test/regression.test.ts --no-color
```

Expected:

- Pass.

---

## Phase 5: Chain Prompt Coverage Backend

### Task 5.1: Add Covered Prompt Fields To Chain API

**Files:**

- Modify: `backend/internal/api/dto.go`
- Modify: `backend/internal/repo/chains.go`
- Modify: `backend/internal/routes/chains.go`
- Create: `backend/test/chains_prompt_coverage_contract_test.go`

- [ ] **Step 1: Add failing backend contract test**

Create a test that inserts two QA records with the same `session_key` and then calls:

```text
GET /lynx/chains/agent%3Amain%3Amain
```

Assert:

```go
expectString(t, prompts[0], "userPromptExcerpt", "first prompt")
expectString(t, prompts[1], "userPromptExcerpt", "second prompt")
expectInt(t, detail, "promptCount", 2)
```

- [ ] **Step 2: Run failing backend test**

Run:

```powershell
Push-Location backend; go test -mod=vendor ./test -run TestChainPromptCoverage -count=1; Pop-Location
```

Expected:

- Fails because chain detail does not expose covered prompts.

- [ ] **Step 3: Add DTO fields**

Add chain detail fields:

```go
type ChainCoveredPrompt struct {
    QaRecordID        string `json:"qaRecordId"`
    RunID             string `json:"runId,omitempty"`
    UserPromptExcerpt string `json:"userPromptExcerpt"`
    RiskLevel         string `json:"riskLevel,omitempty"`
    StartedAtMs       int64  `json:"startedAtMs,omitempty"`
    Status            string `json:"status,omitempty"`
}
```

Attach:

```go
CoveredPrompts []ChainCoveredPrompt `json:"coveredPrompts"`
PromptCount    int                   `json:"promptCount"`
```

- [ ] **Step 4: Query prompts from QA records**

In `ChainRepository`, join or query `qa_records` by `session_key` or `chain_id` mapping. Use chronological order by `started_at_ms`.

- [ ] **Step 5: Run backend tests**

Run:

```powershell
Push-Location backend; go test -mod=vendor ./... -run "TestChainPromptCoverage|TestGrants" -count=1; Pop-Location
```

Expected:

- Pass.

---

## Phase 6: Frontend Advanced Pages

### Task 6.1: Make 多轮链路 Explain Covered Prompts

**Files:**

- Modify: `frontend/src/api/chains.ts`
- Modify: `frontend/src/pages/ChainsPage.tsx`
- Modify: `frontend/test/pages/ChainsPage.test.tsx`

- [ ] **Step 1: Add failing frontend test**

In `ChainsPage.test.tsx`, mock chain detail with:

```ts
coveredPrompts: [
  { qaRecordId: "qa-1", userPromptExcerpt: "first prompt", riskLevel: "L2", startedAtMs: 1 },
  { qaRecordId: "qa-2", userPromptExcerpt: "second prompt", riskLevel: "L3", startedAtMs: 2 },
],
promptCount: 2,
```

Assert:

```ts
expect(await screen.findByText("覆盖的输入词")).toBeInTheDocument();
expect(screen.getByText("first prompt")).toBeInTheDocument();
expect(screen.getByText("second prompt")).toBeInTheDocument();
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npx vitest run frontend/test/pages/ChainsPage.test.tsx --no-color
```

Expected:

- Fails until the page renders covered prompts.

- [ ] **Step 3: Update API type and page detail**

Add `coveredPrompts` and `promptCount` to the chain DTO and render a detail panel section titled `覆盖的输入词`.

- [ ] **Step 4: Run frontend test**

Run:

```powershell
npx vitest run frontend/test/pages/ChainsPage.test.tsx --no-color
```

Expected:

- Pass.

### Task 6.2: Rename 链路授权 To 临时放行

**Files:**

- Modify: `frontend/src/api/grants.ts`
- Modify: `frontend/src/pages/GrantsPage.tsx`
- Modify: `frontend/src/app/nav-config.ts`
- Modify: `frontend/src/components/layout/TopBar.tsx`
- Modify: `frontend/test/pages/GrantsPage.test.tsx`
- Modify: `frontend/test/app/App.test.tsx`

- [ ] **Step 1: Add failing naming tests**

Assert:

```ts
expect(screen.getByText("临时放行")).toBeInTheDocument();
expect(screen.queryByText("链路授权")).not.toBeInTheDocument();
```

- [ ] **Step 2: Keep route compatibility**

Keep `/webview/grants` route for this pass. Change user-facing labels only:

- nav label: `临时放行`
- page title: `临时放行`
- table title: `临时放行列表`

- [ ] **Step 3: Update copy**

Use this page description:

```text
展示审批通过后在当前链路内短期生效的放行范围、失效时间和撤销原因。
```

- [ ] **Step 4: Run frontend tests**

Run:

```powershell
npx vitest run frontend/test/pages/GrantsPage.test.tsx frontend/test/app/App.test.tsx --no-color
```

Expected:

- Pass.

### Task 6.3: Fix Mobile Layout For Advanced Pages

**Files:**

- Modify: `frontend/src/components/layout/ConsoleLayout.tsx`
- Modify: `frontend/src/components/layout/SidebarNav.tsx`
- Modify: `frontend/src/components/layout/TopBar.tsx`
- Modify: `frontend/src/styles/theme.css`
- Modify: `frontend/test/app/App.test.tsx`

- [ ] **Step 1: Add layout test**

Add a test that renders at mobile width and asserts:

```ts
expect(container.querySelector(".console-content")).toBeTruthy();
expect(container.querySelector(".console-shell")).toHaveAttribute("data-mobile-nav", "closed");
```

- [ ] **Step 2: Add mobile nav state**

In `ConsoleLayout.tsx`, add mobile nav state:

```tsx
const [mobileNavOpen, setMobileNavOpen] = useState(false);
```

Pass it to `SidebarNav` and expose a topbar menu button.

- [ ] **Step 3: Update CSS**

In `frontend/src/styles/theme.css`, under `@media (max-width: 900px)`, make:

```css
.console-shell {
  grid-template-columns: 1fr;
}

.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  transform: translateX(-100%);
  z-index: 30;
}

.console-shell[data-mobile-nav="open"] .sidebar {
  transform: translateX(0);
}

.console-content {
  grid-column: 1;
  min-height: calc(100vh - 48px);
}
```

- [ ] **Step 4: Run app test**

Run:

```powershell
npx vitest run frontend/test/app/App.test.tsx --no-color
```

Expected:

- Pass.

---

## Phase 7: Old Prompt Cleanup

### Task 7.1: Remove Deprecated Free-Text Approval From User-Facing Copy

**Files:**

- Modify: `src/approval/approval-prompts.ts`
- Modify: `src/runtime/policy-runtime.ts`
- Modify: `openclaw.plugin.json`
- Modify: `test/plugin.test.ts`
- Modify: `test/risk-policy.test.ts`

- [ ] **Step 1: Add or tighten tests**

Assert:

```ts
expect(JSON.stringify(result ?? {})).not.toContain("确认放行本次操作");
expect(JSON.stringify(result ?? {})).not.toContain("如果你之前习惯回复");
```

- [ ] **Step 2: Remove proactive prompt lines**

Remove text that tells the user to reply with:

```text
确认放行本次操作
```

Keep parser compatibility only if an existing legacy test proves it is needed.

- [ ] **Step 3: Run focused tests**

Run:

```powershell
npx vitest run test/plugin.test.ts test/risk-policy.test.ts --no-color
```

Expected:

- Pass or show only pre-existing unrelated historical failures. If broad files are noisy, rerun exact test names around approval prompt behavior.

---

## Phase 8: Verification

### Task 8.1: Typecheck And Focused Test Gate

**Files:** none

- [ ] **Step 1: Typecheck**

Run:

```powershell
npx tsc --noEmit
```

Expected:

- Pass.

- [ ] **Step 2: Focused frontend tests**

Run:

```powershell
npx vitest run frontend/test/pages/ChainsPage.test.tsx frontend/test/pages/GrantsPage.test.tsx frontend/test/app/App.test.tsx --no-color
```

Expected:

- Pass.

- [ ] **Step 3: Focused backend tests**

Run:

```powershell
Push-Location backend; go test -mod=vendor ./... -run "TestChainPromptCoverage|TestGrants" -count=1; Pop-Location
```

Expected:

- Pass.

### Task 8.2: Runtime Validation

**Files:** none

- [ ] **Step 1: Sync with current usable path**

Run:

```powershell
node scripts/verify-dev-sync.mjs
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
```

Expected:

- Gateway restarts.
- Health endpoint returns 200.
- If the known bundled path issue appears, record it and validate against the loaded runtime path that actually runs.

- [ ] **Step 2: Validate health**

Run:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz | Select-Object StatusCode,Content
```

Expected:

```text
StatusCode 200
```

- [ ] **Step 3: Validate page APIs**

Run:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:18789/lynx/chains | ConvertTo-Json -Depth 8
Invoke-RestMethod -Uri http://127.0.0.1:18789/lynx/grants | ConvertTo-Json -Depth 8
Invoke-RestMethod -Uri http://127.0.0.1:18789/lynx/approvals | ConvertTo-Json -Depth 8
```

Expected:

- Chains include prompt coverage after backend change.
- Grants page data still loads.
- Approvals page data still loads.

- [ ] **Step 4: Browser screenshot verification**

Use Playwright or the available Chrome CDP fallback to capture:

- `/webview/chains` desktop and mobile
- `/webview/grants` desktop and mobile
- `/webview/approvals` desktop and mobile

Expected:

- Mobile content appears in the first viewport.
- `多轮链路` shows covered prompts.
- `/webview/grants` user-facing text reads `临时放行`.

### Task 8.3: Approval Behavior Runtime Proof

**Files:** none

- [ ] **Step 1: Non-exec L3 proof**

Trigger one controlled non-exec risky read or edit fixture that should require plugin approval.

Expected:

- One system plugin/generic approval surface.
- No duplicate Lynx chat prompt.
- No `/approve ... allow-once` text after native/system UI appears.

- [ ] **Step 2: Exec L3 proof**

Trigger one controlled exec fixture.

Expected before OpenClaw approval-context support:

- No Lynx plugin approval popup.
- OpenClaw native exec approval remains the execution authority.
- Lynx risk context may be absent from the exec card; record this as blocked by OpenClaw core extension.

Expected after OpenClaw approval-context support:

- One OpenClaw native exec approval card.
- Card includes Lynx risk context.
- Approval creates a temporary release scoped to the operation.

- [ ] **Step 3: L4 proof**

Trigger a controlled L4 fixture that attempts a hard-deny category.

Expected:

- No approval prompt.
- Model receives only refusal context.
- UI/API preserves original input and marks it not sent to model.

---

## Self-Review Checklist

- [ ] Each known bug has a task: duplicate approval, stale memory grants, non-exec approval, L4 input preservation, chain prompt coverage, naming, old confirmation prompt, mobile layout.
- [ ] `问答记录` is not modified in the first implementation pass.
- [ ] OpenClaw core edits are gated by explicit user approval.
- [ ] There are no placeholder steps.
- [ ] Tests are focused before implementation changes.
- [ ] Runtime proof requires real OpenClaw path before claiming behavior changed.

