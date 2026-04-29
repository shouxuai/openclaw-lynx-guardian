# Plugin Approval Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal OpenClaw-version compatibility layer so Lynx uses native plugin approval on `2026.3.28` and newer runtimes, routes pre-`2026.3.28` or unknown approval traffic through the existing Feishu manual path when a Feishu route exists, and fails closed with a clear reason when no safe approval route is available.

**Architecture:** Keep the change surface small. Add one new runtime helper `src/runtime/plugin-approval-compat.ts` that classifies the OpenClaw runtime into `legacy`, `modern`, or `unknown`, then let `index.ts` use that helper to choose between native approval, Feishu local approval, or direct deny. Reuse the existing Feishu local approval machinery, including recent Feishu DM recovery, and do not redesign the current risk engine or approval stores.

**Tech Stack:** TypeScript, Vitest, OpenClaw plugin hooks, Lynx runtime stores, authenticated OpenClaw local API, Docker sync scripts

---

## File Map

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\plugin-approval-compat.ts`
  New compatibility adapter. Owns the version boundary, runtime-tier classification, and the native/local/deny decision.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\hook-capabilities.ts`
  Read-only helper dependency for version parsing and runtime-version discovery. Reuse it; do not duplicate version parsing logic.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
  Main integration point. Use the compat adapter before approval routing, keep current webchat native behavior on `2026.3.28+` runtimes, and route conservative tiers into the existing Feishu local approval path using recovered Feishu DM context.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin-approval-compat.test.ts`
  New focused unit tests for runtime-tier classification and transport decisions.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\approval-channel-alignment.test.ts`
  Extend the current hook-level suite to cover modern webchat native approval, legacy webchat fallback to Feishu local approval, and deny-without-route behavior.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\superpowers\specs\2026-04-20-plugin-approval-compatibility-design.md`
  Approved design reference. Read-only during implementation unless a real contradiction is discovered.

## Scope Guard

- Modify only the plugin repository under `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`.
- Do not modify `D:\all-works\openclaw`.
- Do not redesign risk recognition, evidence collection, or `L4` denial behavior.
- Do not replace the current Feishu local approval command model.
- Do not spread compatibility logic across multiple new runtime modules; keep the new logic concentrated in one helper file.
- Do not change `webchat` native approval wording on `2026.3.28+` runtimes.
- Do not rely on `test\plugin.test.ts` as the main regression surface for this change.

## Compatibility Rules To Implement

- `2026.3.28` is the first formal release that introduced plugin approval, and it is the compatibility boundary for this plan.
- `2026.3.31-beta.1` and `2026.4.7` are later historical refinements, but they do not create extra Lynx routing tiers in this implementation.
- Unknown runtime versions are treated conservatively.
- On `2026.3.28+` runtimes:
  - `webchat` uses native plugin approval.
  - `feishu` keeps Lynx local manual approval.
- On pre-`2026.3.28` or unknown runtimes:
  - if a recent Feishu DM route plus trusted approver context exists, route approval through Feishu local approval
  - otherwise deny with a clear "upgrade OpenClaw or configure Feishu approval" message

### Task 1: Add the Version Compatibility Adapter

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\plugin-approval-compat.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin-approval-compat.test.ts`

- [ ] **Step 1: Write the failing compatibility-adapter tests**

```ts
import { describe, expect, it } from "vitest";

import {
  PLUGIN_APPROVAL_INTRO_VERSION,
  classifyPluginApprovalRuntime,
  resolvePluginApprovalCompat,
} from "../src/runtime/plugin-approval-compat.js";

describe("plugin approval compatibility", () => {
  it("classifies runtime versions into legacy, modern, and unknown tiers", () => {
    expect(PLUGIN_APPROVAL_INTRO_VERSION).toBe("2026.3.28");

    expect(classifyPluginApprovalRuntime("2026.3.27")).toEqual({
      runtimeVersion: "2026.3.27",
      tier: "legacy",
    });
    expect(classifyPluginApprovalRuntime("2026.3.28")).toEqual({
      runtimeVersion: "2026.3.28",
      tier: "modern",
    });
    expect(classifyPluginApprovalRuntime("2026.4.7")).toEqual({
      runtimeVersion: "2026.4.7",
      tier: "modern",
    });
    expect(classifyPluginApprovalRuntime(undefined)).toEqual({
      runtimeVersion: "unknown",
      tier: "unknown",
    });
  });

  it("keeps 2026.3.28+ webchat runtimes on native plugin approval", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.28",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "native-webchat",
      transport: "native",
      runtimeTier: "modern",
    });
  });

  it("routes legacy webchat runtimes to feishu local approval when a feishu route exists", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.27",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: true,
        hasFeishuFallbackContext: true,
      }),
    ).toMatchObject({
      mode: "feishu-local",
      transport: "local-chat",
      runtimeTier: "legacy",
    });
  });

  it("fails closed on conservative runtimes without a feishu route", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.27",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
      runtimeTier: "legacy",
    });

    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: undefined,
        currentChannelProfile: "other",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
      runtimeTier: "unknown",
    });
  });
});
```

- [ ] **Step 2: Run the new compatibility tests and verify they fail**

Run: `npx vitest run test/plugin-approval-compat.test.ts`

Expected: FAIL because `src/runtime/plugin-approval-compat.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal compatibility adapter**

```ts
import {
  getOpenClawRuntimeVersion,
  isVersionAtLeast,
} from "./hook-capabilities.js";

export const PLUGIN_APPROVAL_INTRO_VERSION = "2026.3.28";

export type PluginApprovalCompatTier =
  | "legacy"
  | "modern"
  | "unknown";

export type PluginApprovalCompatMode =
  | "native-webchat"
  | "feishu-local"
  | "deny-no-route";

export type PluginApprovalCompatDecision = {
  runtimeVersion: string;
  runtimeTier: PluginApprovalCompatTier;
  mode: PluginApprovalCompatMode;
  transport: "native" | "local-chat" | "none";
  blockReason?: string;
};

export function classifyPluginApprovalRuntime(
  runtimeVersion = getOpenClawRuntimeVersion(),
): { runtimeVersion: string; tier: PluginApprovalCompatTier } {
  const normalized = runtimeVersion?.trim();
  if (!normalized) {
    return { runtimeVersion: "unknown", tier: "unknown" };
  }
  if (!isVersionAtLeast(normalized, PLUGIN_APPROVAL_INTRO_VERSION)) {
    return { runtimeVersion: normalized, tier: "legacy" };
  }
  return { runtimeVersion: normalized, tier: "modern" };
}

function buildNoRouteReason(tier: PluginApprovalCompatTier): string {
  if (tier === "unknown") {
    return "[Lynx Guardian] 当前 OpenClaw 版本无法可靠识别，且未配置可用的 Feishu 审批通道，无法放行本次操作。请升级 OpenClaw 或配置 Feishu 审批。";
  }
  return "[Lynx Guardian] 当前 OpenClaw 版本低于 2026.3.28，且未配置可用的 Feishu 审批通道，无法放行本次操作。请升级 OpenClaw 或配置 Feishu 审批。";
}

export function resolvePluginApprovalCompat(params: {
  runtimeVersion?: string;
  currentChannelProfile: "webchat" | "feishu" | "other";
  hasFeishuApproverRoute: boolean;
  hasFeishuFallbackContext: boolean;
}): PluginApprovalCompatDecision {
  const runtime = classifyPluginApprovalRuntime(params.runtimeVersion);

  if (params.currentChannelProfile === "feishu") {
    if (params.hasFeishuApproverRoute) {
      return {
        runtimeVersion: runtime.runtimeVersion,
        runtimeTier: runtime.tier,
        mode: "feishu-local",
        transport: "local-chat",
      };
    }
    return {
      runtimeVersion: runtime.runtimeVersion,
      runtimeTier: runtime.tier,
      mode: "deny-no-route",
      transport: "none",
      blockReason: "[Lynx Guardian] 当前请求要求 Feishu 本地审批，但未配置可用的 Feishu 审批人，无法放行本次操作。",
    };
  }

  if (runtime.tier === "modern" && params.currentChannelProfile === "webchat") {
    return {
      runtimeVersion: runtime.runtimeVersion,
      runtimeTier: runtime.tier,
      mode: "native-webchat",
      transport: "native",
    };
  }

  if (params.hasFeishuApproverRoute && params.hasFeishuFallbackContext) {
    return {
      runtimeVersion: runtime.runtimeVersion,
      runtimeTier: runtime.tier,
      mode: "feishu-local",
      transport: "local-chat",
    };
  }

  return {
    runtimeVersion: runtime.runtimeVersion,
    runtimeTier: runtime.tier,
    mode: "deny-no-route",
    transport: "none",
    blockReason: buildNoRouteReason(runtime.tier),
  };
}
```

- [ ] **Step 4: Run the compatibility tests and verify they pass**

Run: `npx vitest run test/plugin-approval-compat.test.ts`

Expected: PASS with four tests green.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/plugin-approval-compat.ts test/plugin-approval-compat.test.ts
git commit -m "feat: add plugin approval compatibility adapter"
```

### Task 2: Wire the Adapter Into Approval Routing With Focused Hook Tests

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\approval-channel-alignment.test.ts`

- [ ] **Step 1: Extend the hook-level alignment tests before touching `index.ts`**

```ts
import {
  rememberRecentActiveDeliveryTarget,
  resetRecentActiveDeliveryTargets,
} from "../src/runtime/recent-active-delivery.js";
```

```ts
beforeEach(() => {
  vi.stubEnv("OPENCLAW_VERSION", "2026.3.28");
  resetRecentActiveDeliveryTargets();
});

afterEach(() => {
  resetRecentActiveDeliveryTargets();
});
```

```ts
it("keeps modern webchat runtimes native and free of feishu wording", async () => {
  vi.stubEnv("OPENCLAW_VERSION", "2026.3.28");
  configureOwnerApproval();

  await handlers.before_agent_start(
    { prompt: APPROVAL_PROBE_PROMPT },
    {
      sessionKey: "sess-webchat-native",
      channelId: "webchat",
      runId: "run-webchat-native",
    },
  );

  const result = await handlers.before_tool_call(
    {
      toolName: "read",
      params: { path: "LYNX_APPROVAL_TEST.md" },
      runId: "run-webchat-native",
      toolCallId: "tool-webchat-native",
    },
    {
      sessionKey: "sess-webchat-native",
      channelId: "webchat",
      runId: "run-webchat-native",
    },
  );

  expect(result).toMatchObject({
    requireApproval: expect.any(Object),
  });
  expect(JSON.stringify(result)).not.toContain("Feishu");
  expect(JSON.stringify(result)).not.toContain("/lynx-approve");
});
```

```ts
it("routes legacy webchat runtimes through feishu local approval when a recent owner dm route exists", async () => {
  vi.stubEnv("OPENCLAW_VERSION", "2026.3.27");
  configureOwnerApproval();

  rememberRecentActiveDeliveryTarget(
    {
      sessionKey: "sess-feishu-owner-dm",
      channelId: "feishu",
      messageProvider: "feishu",
      senderId: "ou_owner",
      to: "user:ou_owner",
      accountId: "default",
      sendMessage: vi.fn().mockResolvedValue(undefined),
    } as any,
    { allowRouteOnly: true },
  );

  await handlers.before_agent_start(
    { prompt: APPROVAL_PROBE_PROMPT },
    {
      sessionKey: "sess-webchat-legacy",
      channelId: "webchat",
      runId: "run-webchat-legacy",
    },
  );

  const result = await handlers.before_tool_call(
    {
      toolName: "read",
      params: { path: "LYNX_APPROVAL_TEST.md" },
      runId: "run-webchat-legacy",
      toolCallId: "tool-webchat-legacy",
    },
    {
      sessionKey: "sess-webchat-legacy",
      channelId: "webchat",
      runId: "run-webchat-legacy",
    },
  );

  expect(result).toMatchObject({
    block: true,
    blockReason: expect.stringContaining("/lynx-approve"),
  });
  expect(result).not.toHaveProperty("requireApproval");

  const token = /\/lynx-approve\s+([a-z0-9]+)/i.exec(String((result as any).blockReason ?? ""))?.[1];
  expect(token).toBeTruthy();

  const approvalReply = await handlers.before_dispatch(
    {
      content: `/lynx-approve ${token} allow-once`,
      channel: "feishu",
      sessionKey: "sess-feishu-owner-dm",
      senderId: "ou_owner",
      isGroup: false,
      timestamp: Date.now(),
    },
    {
      sessionKey: "sess-feishu-owner-dm",
      channelId: "feishu",
      accountId: "default",
      conversationId: "user:ou_owner",
      senderId: "ou_owner",
    },
  );

  expect(approvalReply).toMatchObject({
    handled: false,
    text: expect.stringContaining("正在继续执行"),
  });
});
```

```ts
it("fails closed for legacy webchat runtimes without a feishu route", async () => {
  vi.stubEnv("OPENCLAW_VERSION", "2026.3.27");
  configureOwnerApproval();

  await handlers.before_agent_start(
    { prompt: APPROVAL_PROBE_PROMPT },
    {
      sessionKey: "sess-webchat-no-route",
      channelId: "webchat",
      runId: "run-webchat-no-route",
    },
  );

  const result = await handlers.before_tool_call(
    {
      toolName: "read",
      params: { path: "LYNX_APPROVAL_TEST.md" },
      runId: "run-webchat-no-route",
      toolCallId: "tool-webchat-no-route",
    },
    {
      sessionKey: "sess-webchat-no-route",
      channelId: "webchat",
      runId: "run-webchat-no-route",
    },
  );

  expect(result).toMatchObject({
    block: true,
    blockReason: expect.stringContaining("升级 OpenClaw 或配置 Feishu 审批"),
  });
  expect(result).not.toHaveProperty("requireApproval");
});
```

- [ ] **Step 2: Run the focused alignment suite and verify it fails**

Run: `npx vitest run test/approval-channel-alignment.test.ts`

Expected: FAIL because `index.ts` still routes approvals by older channel-only logic and does not apply the new `2026.3.28` compatibility boundary.

- [ ] **Step 3: Wire `index.ts` to the compatibility helper with the smallest possible change set**

```ts
import {
  resolvePluginApprovalCompat,
} from "./src/runtime/plugin-approval-compat.js";
```

```ts
const runtimeVersion = getOpenClawRuntimeVersion();
const fallbackFeishuApprovalContext = recoverFeishuDmApprovalContextFromRecentRoute();
const currentApprovalChannelProfile = effectiveRunApprovalContext.channelProfile
  ?? resolveChannelProfile(ctx?.messageProvider ?? ctx?.channelId ?? ctx?.channel);

const compatDecision = resolvePluginApprovalCompat({
  runtimeVersion,
  currentChannelProfile: currentApprovalChannelProfile,
  hasFeishuApproverRoute: localApprovalApproverOuIds.length > 0,
  hasFeishuFallbackContext: Boolean(
    fallbackFeishuApprovalContext?.channelProfile === "feishu"
      && fallbackFeishuApprovalContext?.requesterOuId
      && fallbackFeishuApprovalContext?.conversationId,
  ),
});

if (compatDecision.mode === "deny-no-route") {
  return {
    block: true,
    blockReason: compatDecision.blockReason ?? "Approval unavailable",
  };
}

const approvalRouteContext = compatDecision.mode === "feishu-local"
  ? (fallbackFeishuApprovalContext?.channelProfile === "feishu"
      ? fallbackFeishuApprovalContext
      : effectiveRunApprovalContext)
  : effectiveRunApprovalContext;
```

```ts
const toolApprovalChannelProfile = approvalRouteContext.channelProfile
  ?? currentApprovalChannelProfile;
const toolApprovalChannelId = normalizeString(ctx?.channelId ?? ctx?.channel)
  || (toolApprovalChannelProfile === "other" ? undefined : toolApprovalChannelProfile);
const preferredToolApprovalTransport = compatDecision.transport;
const approvalSessionKey = compatDecision.mode === "feishu-local" && currentApprovalChannelProfile !== "feishu"
  ? undefined
  : normalizeString(ctx.sessionKey) || undefined;
```

```ts
const feishuLocalApproval = await handleFeishuLocalToolApproval({
  ctx,
  channelProfile: toolApprovalChannelProfile,
  channelId: toolApprovalChannelId,
  requesterOuId: approvalRouteContext.requesterOuId,
  conversationId: approvalRouteContext.conversationId,
  accountId: approvalRouteContext.accountId,
  approverOuIds: localApprovalApproverOuIds,
  approvalId: `lynx:ssg:${ctx.runId ?? "no-run"}:${event.toolCallId ?? toolName}:${primaryModule}`,
  toolName,
  module: primaryModule,
  riskLevel: approvalRiskLevel,
  promptText: runApprovalContext?.promptText,
  protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(toolName, params),
  timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
  grantWindowMs: riskPolicyConfig.grantWindowMs,
  approvalSessionKey,
});
```

```ts
async function handleFeishuLocalToolApproval(params: {
  ctx: any;
  channelProfile?: "webchat" | "feishu" | "other";
  channelId?: string;
  requesterOuId?: string;
  conversationId?: string;
  accountId?: string;
  approverOuIds: string[];
  approvalId: string;
  toolName: string;
  module: string;
  riskLevel: "L2" | "L3";
  promptText?: string;
  protectedTargetSummary?: string;
  timeoutMs: number;
  grantWindowMs: number;
  approvalSessionKey?: string;
}): Promise<{ handled: boolean; blockReason?: string }> {
  const localApproval = registerLocalToolApproval({
    pendingId: params.approvalId,
    sessionKey: params.approvalSessionKey,
    channelProfile: "feishu",
    channelId: params.channelId,
    accountId: params.accountId,
    requesterOuId: params.requesterOuId,
    requestFingerprint,
    approverOuIds: params.approverOuIds,
    conversationId: params.conversationId,
    module: params.module,
    riskLevel: params.riskLevel,
    toolName: params.toolName,
    promptText: params.promptText,
    timeoutMs: params.timeoutMs,
    onResolution: (_resolution) => {},
  });
}
```

- [ ] **Step 4: Run the hook-level alignment suite and verify it passes**

Run: `npx vitest run test/approval-channel-alignment.test.ts`

Expected: PASS with:

- modern `webchat` returning native `requireApproval`
- legacy `webchat` returning `/lynx-approve` text when a recent Feishu route exists
- legacy `webchat` returning a clear deny when no Feishu route exists

- [ ] **Step 5: Run the helper and hook suites together**

Run: `npx vitest run test/plugin-approval-compat.test.ts test/approval-channel-alignment.test.ts test/hook-capabilities.test.ts`

Expected: PASS with all focused compatibility and version tests green.

- [ ] **Step 6: Commit**

```bash
git add index.ts test/approval-channel-alignment.test.ts
git commit -m "feat: route plugin approvals by runtime compatibility"
```

### Task 3: Validate Through Real OpenClaw Runtime

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\superpowers\plans\2026-04-20-plugin-approval-compatibility.md`
  Only if a real runtime discrepancy forces an update to the plan notes before handoff.

- [ ] **Step 1: Run the focused local safety checks**

Run: `npx tsc --noEmit`

Expected: PASS

Run: `npx vitest run test/plugin-approval-compat.test.ts test/approval-channel-alignment.test.ts test/hook-capabilities.test.ts`

Expected: PASS

- [ ] **Step 2: Inspect the local OpenClaw package version used by the plugin**

Run:

```bash
node -e "const fs=require('fs'); const path=require('path'); const sdk=require.resolve('openclaw/plugin-sdk'); const pkg=JSON.parse(fs.readFileSync(path.join(path.dirname(sdk),'..','..','package.json'),'utf8')); console.log(pkg.version || 'unknown');"
```

Expected:

- prints a concrete OpenClaw version such as `2026.4.11`
- if the version is `>= 2026.3.28`, the runtime should follow the modern native branch
- if the version is `< 2026.3.28`, the runtime should follow the conservative branch

- [ ] **Step 3: Sync the plugin into the real runtime**

Run: `node scripts/verify-dev-sync.mjs`

Expected: success output with no sync blockers

Run: `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`

Expected: the gateway restarts cleanly and the trailing log assessment is not `blocked`

- [ ] **Step 4: Validate the approval probe through the authenticated OpenClaw API**

Run:

```powershell
$headers = @{
  Authorization = "Bearer 3394aded9042bf1e387f980b3a110c32c71ba964b1c4b40a"
  "Content-Type" = "application/json"
}

$body = @{
  model = "openclaw/main"
  messages = @(
    @{
      role = "user"
      content = "请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。"
    }
  )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:18789/v1/chat/completions `
  -Headers $headers `
  -Body $body
```

Expected:

- if the local runtime is `>= 2026.3.28`, the resulting approval path stays native and the visible result does not mention `Feishu` or `/lynx-approve`
- if the local runtime is `< 2026.3.28` and a Feishu route is available, the result contains the Feishu local approval command
- if the local runtime is `< 2026.3.28` or unknown and no Feishu route is available, the result is a direct deny that tells the operator to upgrade OpenClaw or configure Feishu approval

- [ ] **Step 5: Check supporting logs for the actual branch taken**

Run: `Get-Content "$env:USERPROFILE\.openclaw\lynx\hook-probe.log" -Tail 200`

Expected:

- modern runtime: log lines show native approval path selection and no Feishu fallback deny reason
- conservative runtime with Feishu route: log lines show Feishu local approval path selection
- conservative runtime without route: log lines show compatibility deny reason

- [ ] **Step 6: Commit**

```bash
git add src/runtime/plugin-approval-compat.ts index.ts test/plugin-approval-compat.test.ts test/approval-channel-alignment.test.ts
git commit -m "test: validate plugin approval compatibility routing"
```

## Self-Review

- Spec coverage:
  - version history and single compatibility boundary: Task 1
  - minimal-change adapter file: Task 1
  - `index.ts` integration with smallest possible wiring: Task 2
  - modern webchat native path: Task 2
  - pre-`2026.3.28` conservative fallback and fail-closed behavior: Task 2
  - real OpenClaw validation path: Task 3
- Placeholder scan:
  - no `TODO`, `TBD`, or deferred implementation markers remain
  - all tasks contain explicit files, code, commands, and expected results
- Type consistency:
  - helper names are consistent across tasks: `classifyPluginApprovalRuntime`, `resolvePluginApprovalCompat`
  - runtime tiers are consistent across tasks: `legacy`, `modern`, `unknown`
  - compat modes are consistent across tasks: `native-webchat`, `feishu-local`, `deny-no-route`

Plan complete and saved to `docs/superpowers/plans/2026-04-20-plugin-approval-compatibility.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
