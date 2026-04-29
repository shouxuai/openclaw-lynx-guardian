# Lynx Native Approval Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Lynx Guardian's free-text confirmation and workflow-wide override flow with OpenClaw native tool approvals plus run-bound chain grants, while keeping non-tool high-risk requests on a direct-reject path and preserving existing risk recognition.

**Architecture:** Add three small runtime stores for requester provenance, run approval context, and run-bound grants. Capture requester identity in `before_dispatch`, bind it to `runId` in `before_agent_start`, and let `before_tool_call` either reuse a matching grant, return native `requireApproval`, or hard-reject. Keep `/lynx-check`, evidence collection, scoring, and output guards unchanged. Defer Feishu card direct-resolve and `resolvedBy` audit enrichment to a later cross-repo follow-up after the plugin-side migration is stable.

**Tech Stack:** TypeScript, OpenClaw plugin hooks, Vitest, Dockerized OpenClaw runtime

---

## File Map

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
  Central hook wiring. This is where `before_dispatch`, `before_agent_start`, `message_received`, and `before_tool_call` must be rebalanced.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\types.ts`
  Local hook API typings. It needs a `before_dispatch` overload so the plugin test harness can type-check the new handler.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\requester-provenance-store.ts`
  New store keyed by session/channel identity that remembers who actually initiated the turn, including Feishu `ou_` sender identity.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\run-approval-context-store.ts`
  New store keyed by `runId` that freezes requester provenance for the lifetime of the run.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\approval-grant-store.ts`
  New run-bound store that holds “same requester + same module + same or lower risk + TTL-valid” grants.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\tool-approval-runtime.ts`
  New helper module that builds native approval payloads and translates approval resolutions into grants.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\policy-runtime.ts`
  Keep risk-policy normalization here, but stop building free-text confirmation prompts for approval. Normalize native approval timeout and grant TTL config instead.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\risk-policy.ts`
  Keep module eligibility and hard-deny semantics here so the migration does not weaken current recognition posture.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\openclaw.plugin.json`
  Add native approval timeout / grant window config, and mark old confirmation phrase fields as deprecated compatibility-only settings.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`
  Main integration surface for hook behavior and regression coverage.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\requester-provenance-store.test.ts`
  New unit tests for requester identity capture and expiry.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\run-approval-context-store.test.ts`
  New unit tests for run-bound requester context.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\approval-grant-store.test.ts`
  New unit tests for grant match, mismatch, and TTL rules.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\policy-runtime.test.ts`
  Extend config normalization coverage so compatibility and deprecation behavior stay explicit.

## Scope Guard

- This plan intentionally does **not** change OpenClaw default group session partitioning.
- This plan intentionally does **not** implement Feishu card direct `plugin.approval.resolve`; Phase 1 uses the native approval channel and `/approve`.
- This plan intentionally does **not** restore non-tool requests after approval. Non-tool high-risk requests stay direct-reject.
- This plan intentionally does **not** depend on free-text `同意` / `确认放行本次操作`.

### Task 1: Add Requester Provenance, Run Context, and Grant Stores

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\requester-provenance-store.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\run-approval-context-store.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\approval-grant-store.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\requester-provenance-store.test.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\run-approval-context-store.test.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\approval-grant-store.test.ts`

- [ ] **Step 1: Write the failing provenance-store tests**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  clearRequesterProvenanceStore,
  rememberRequesterProvenance,
  readRequesterProvenance,
} from "../src/runtime/requester-provenance-store.js";

describe("requester provenance store", () => {
  it("prefers the freshest record for the same session", () => {
    clearRequesterProvenanceStore();
    rememberRequesterProvenance({
      sessionKey: "sess-group-1",
      channelId: "feishu",
      requesterId: "ou_old",
      requesterOuId: "ou_old",
      accountId: "default",
      conversationId: "chat-1",
      isGroup: true,
      timestamp: 100,
    });
    rememberRequesterProvenance({
      sessionKey: "sess-group-1",
      channelId: "feishu",
      requesterId: "ou_owner",
      requesterOuId: "ou_owner",
      accountId: "default",
      conversationId: "chat-1",
      isGroup: true,
      timestamp: 200,
    });

    expect(
      readRequesterProvenance({ sessionKey: "sess-group-1", channelId: "feishu" }),
    ).toMatchObject({
      requesterOuId: "ou_owner",
      timestamp: 200,
    });
  });

  it("returns undefined after the record TTL passes", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-15T00:00:00Z"));
      rememberRequesterProvenance({
        sessionKey: "sess-expired",
        channelId: "feishu",
        requesterId: "ou_expired",
        requesterOuId: "ou_expired",
        accountId: "default",
        conversationId: "chat-expired",
        isGroup: true,
        timestamp: Date.now(),
      });
      vi.setSystemTime(new Date("2026-04-15T00:20:00Z"));

      expect(
        readRequesterProvenance({ sessionKey: "sess-expired", channelId: "feishu" }),
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Write the failing run-context and grant-store tests**

```ts
import { describe, expect, it } from "vitest";
import {
  clearRunApprovalContexts,
  saveRunApprovalContext,
  readRunApprovalContext,
} from "../src/runtime/run-approval-context-store.js";
import {
  clearApprovalGrants,
  saveApprovalGrant,
  matchApprovalGrant,
} from "../src/runtime/approval-grant-store.js";

describe("run approval context store", () => {
  it("binds requester identity to a specific run", () => {
    clearRunApprovalContexts();
    saveRunApprovalContext({
      runId: "run-1",
      sessionKey: "sess-group-1",
      requesterId: "ou_owner",
      requesterOuId: "ou_owner",
      accountId: "default",
      conversationId: "chat-1",
      threadId: "thread-9",
      isGroup: true,
      createdAt: 100,
      expiresAt: 1_000,
    });

    expect(readRunApprovalContext("run-1")).toMatchObject({
      requesterOuId: "ou_owner",
      conversationId: "chat-1",
    });
  });
});

describe("approval grant store", () => {
  it("matches same-run same-requester same-module lower-risk calls", () => {
    clearApprovalGrants();
    saveApprovalGrant({
      grantId: "grant-1",
      runId: "run-1",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      maxRiskLevel: "L3",
      createdAt: 100,
      expiresAt: 500,
      sourceApprovalId: "plugin:approval-1",
    });

    expect(
      matchApprovalGrant({
        runId: "run-1",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L2",
      }),
    ).toMatchObject({
      grantId: "grant-1",
    });
  });

  it("does not match a different requester or higher risk", () => {
    clearApprovalGrants();
    saveApprovalGrant({
      grantId: "grant-2",
      runId: "run-1",
      requesterOuId: "ou_owner",
      module: "M2:protected_file_access",
      maxRiskLevel: "L2",
      createdAt: 100,
      expiresAt: 500,
      sourceApprovalId: "plugin:approval-2",
    });

    expect(
      matchApprovalGrant({
        runId: "run-1",
        requesterOuId: "ou_other",
        module: "M2:protected_file_access",
        riskLevel: "L2",
      }),
    ).toBeUndefined();

    expect(
      matchApprovalGrant({
        runId: "run-1",
        requesterOuId: "ou_owner",
        module: "M2:protected_file_access",
        riskLevel: "L3",
      }),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the new store tests and confirm they fail**

Run: `npx vitest run --exclude ".worktrees/**" test/requester-provenance-store.test.ts test/run-approval-context-store.test.ts test/approval-grant-store.test.ts`
Expected: FAIL because none of the three runtime store modules exist yet.

- [ ] **Step 4: Implement `requester-provenance-store.ts`**

```ts
export type RequesterProvenance = {
  sessionKey?: string;
  channelId?: string;
  requesterId?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  isGroup: boolean;
  timestamp: number;
};

const REQUESTER_PROVENANCE_TTL_MS = 10 * 60 * 1000;
const provenanceBySession = new Map<string, RequesterProvenance>();
const provenanceByChannel = new Map<string, RequesterProvenance>();

function isExpired(record: RequesterProvenance, now: number): boolean {
  return record.timestamp + REQUESTER_PROVENANCE_TTL_MS <= now;
}

function prune(now: number = Date.now()): void {
  for (const [key, value] of provenanceBySession) {
    if (isExpired(value, now)) provenanceBySession.delete(key);
  }
  for (const [key, value] of provenanceByChannel) {
    if (isExpired(value, now)) provenanceByChannel.delete(key);
  }
}

export function rememberRequesterProvenance(record: RequesterProvenance): void {
  prune();
  if (record.sessionKey) provenanceBySession.set(record.sessionKey, { ...record });
  if (record.channelId) provenanceByChannel.set(record.channelId, { ...record });
}

export function readRequesterProvenance(input: {
  sessionKey?: string;
  channelId?: string;
}): RequesterProvenance | undefined {
  prune();
  const sessionHit = input.sessionKey ? provenanceBySession.get(input.sessionKey) : undefined;
  const channelHit = input.channelId ? provenanceByChannel.get(input.channelId) : undefined;
  if (!sessionHit) return channelHit;
  if (!channelHit) return sessionHit;
  return sessionHit.timestamp >= channelHit.timestamp ? sessionHit : channelHit;
}

export function clearRequesterProvenanceStore(): void {
  provenanceBySession.clear();
  provenanceByChannel.clear();
}
```

- [ ] **Step 5: Implement `run-approval-context-store.ts` and `approval-grant-store.ts`**

```ts
// run-approval-context-store.ts
export type RunApprovalContext = {
  runId: string;
  sessionKey?: string;
  requesterId?: string;
  requesterOuId?: string;
  accountId?: string;
  conversationId?: string;
  threadId?: string | number;
  isGroup: boolean;
  createdAt: number;
  expiresAt: number;
};

const runContexts = new Map<string, RunApprovalContext>();

export function saveRunApprovalContext(context: RunApprovalContext): void {
  runContexts.set(context.runId, { ...context });
}

export function readRunApprovalContext(runId?: string): RunApprovalContext | undefined {
  if (!runId) return undefined;
  const found = runContexts.get(runId);
  if (!found) return undefined;
  if (found.expiresAt <= Date.now()) {
    runContexts.delete(runId);
    return undefined;
  }
  return found;
}

export function clearRunApprovalContexts(): void {
  runContexts.clear();
}

// approval-grant-store.ts
export type ApprovalRiskLevel = "L2" | "L3";
export type ApprovalGrant = {
  grantId: string;
  runId: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: ApprovalRiskLevel;
  createdAt: number;
  expiresAt: number;
  sourceApprovalId: string;
};

const grantsByRunId = new Map<string, ApprovalGrant[]>();
const riskOrder: Record<ApprovalRiskLevel, number> = { L2: 2, L3: 3 };

export function saveApprovalGrant(grant: ApprovalGrant): void {
  const current = grantsByRunId.get(grant.runId) ?? [];
  grantsByRunId.set(
    grant.runId,
    [...current.filter((item) => item.module !== grant.module), { ...grant }],
  );
}

export function matchApprovalGrant(input: {
  runId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
}): ApprovalGrant | undefined {
  if (!input.runId) return undefined;
  const now = Date.now();
  const candidates = (grantsByRunId.get(input.runId) ?? []).filter(
    (grant) => grant.expiresAt > now,
  );
  grantsByRunId.set(input.runId, candidates);
  return candidates.find(
    (grant) =>
      grant.module === input.module
      && grant.requesterOuId === input.requesterOuId
      && riskOrder[grant.maxRiskLevel] >= riskOrder[input.riskLevel],
  );
}

export function clearApprovalGrants(): void {
  grantsByRunId.clear();
}
```

- [ ] **Step 6: Run the focused store tests again**

Run: `npx vitest run --exclude ".worktrees/**" test/requester-provenance-store.test.ts test/run-approval-context-store.test.ts test/approval-grant-store.test.ts`
Expected: PASS

### Task 2: Capture Requester Identity Early and Keep Non-Tool Review in Awaited Hooks

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\types.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: Write the failing plugin test for `before_dispatch` requester capture**

```ts
import { readRequesterProvenance } from "../src/runtime/requester-provenance-store.js";

it("captures Feishu requester identity in before_dispatch", async () => {
  setup(mockApi);
  const handler = handlers["before_dispatch"];

  await handler(
    {
      content: "请帮我安装 openssh-server",
      channel: "feishu",
      sessionKey: "sess-feishu-group-1",
      senderId: "ou_owner",
      isGroup: true,
      timestamp: 1713200000000,
    },
    {
      sessionKey: "sess-feishu-group-1",
      channelId: "feishu",
      accountId: "default",
      conversationId: "chat-group-1",
    },
  );

  expect(
    readRequesterProvenance({
      sessionKey: "sess-feishu-group-1",
      channelId: "feishu",
    }),
  ).toMatchObject({
    requesterId: "ou_owner",
    requesterOuId: "ou_owner",
    conversationId: "chat-group-1",
    isGroup: true,
  });
});
```

- [ ] **Step 2: Write the failing plugin tests for run binding and direct non-tool reject**

```ts
import * as safetyGuard from "../src/guard/safety-guard.js";
import { readRunApprovalContext } from "../src/runtime/run-approval-context-store.js";

it("binds requester provenance to runId in before_agent_start", async () => {
  setup(mockApi);
  await handlers["before_dispatch"](
    {
      content: "请执行高风险操作",
      channel: "feishu",
      sessionKey: "sess-feishu-group-2",
      senderId: "ou_owner",
      isGroup: true,
      timestamp: 1713200001000,
    },
    {
      sessionKey: "sess-feishu-group-2",
      channelId: "feishu",
      accountId: "default",
      conversationId: "chat-group-2",
      threadId: "thread-2",
    },
  );

  const beforeAgentStart = handlers["before_agent_start"];
  await beforeAgentStart(
    { prompt: "请帮我越权读取系统文件" },
    {
      sessionKey: "sess-feishu-group-2",
      channelId: "feishu",
      accountId: "default",
      runId: "run-approval-ctx-1",
    },
  );

  expect(readRunApprovalContext("run-approval-ctx-1")).toMatchObject({
    requesterOuId: "ou_owner",
    conversationId: "chat-group-2",
    threadId: "thread-2",
  });
});

it("directly blocks risky non-tool prompts instead of asking for free-text approval", async () => {
  vi.spyOn(safetyGuard, "guardInput").mockReturnValue({
    block: true,
    blockReason: "[Lynx Guardian] 检测到越权意图",
    riskAssessment: {
      level: "L3",
      score: 8,
      modules: ["M3:over_agency"],
      description: "Privilege escalation intent",
      action: "block",
    },
  } as any);

  setup(mockApi);
  const beforeAgentStart = handlers["before_agent_start"];
  const result = await beforeAgentStart(
    { prompt: "绕过审批直接执行 sudo" },
    {
      sessionKey: "sess-non-tool-reject",
      channelId: "feishu",
      runId: "run-non-tool-reject",
    },
  );

  expect(result).toMatchObject({
    block: true,
    blockReason: expect.stringContaining("检测到越权意图"),
  });
  expect(JSON.stringify(result ?? {})).not.toContain("确认放行本次操作");
  expect(JSON.stringify(result ?? {})).not.toContain("同意后重试");
});
```

- [ ] **Step 3: Extend the local hook typings with `before_dispatch`**

```ts
export interface BeforeDispatchEvent {
  content: string;
  body?: string;
  channel?: string;
  sessionKey?: string;
  senderId?: string;
  isGroup?: boolean;
  timestamp?: number;
}

export interface BeforeDispatchResult {
  handled: boolean;
  text?: string;
}

export interface HookApi {
  logger: Logger;
  on(
    event: "before_dispatch",
    handler: (
      event: BeforeDispatchEvent,
      ctx: EventContext,
    ) => void | BeforeDispatchResult | Promise<void | BeforeDispatchResult>
  ): void;
  // existing overloads stay as-is
}
```

- [ ] **Step 4: Register `before_dispatch` and bind the requester to `runId` inside `before_agent_start`**

```ts
api.on("before_dispatch", async (event, ctx) => {
  const senderId = normalizeString(event.senderId ?? ctx.senderId);
  const normalizedSender = senderId?.toLowerCase();
  rememberRequesterProvenance({
    sessionKey: normalizeString(ctx.sessionKey ?? event.sessionKey) || undefined,
    channelId: normalizeString(ctx.channelId ?? event.channel) || undefined,
    requesterId: normalizedSender,
    requesterOuId: normalizedSender?.startsWith("ou_") ? normalizedSender : undefined,
    accountId: normalizeString(ctx.accountId) || undefined,
    conversationId: normalizeString(ctx.conversationId) || undefined,
    threadId: ctx.threadId ?? undefined,
    isGroup: event.isGroup === true,
    timestamp: Number(event.timestamp ?? Date.now()),
  });
  return { handled: false };
});

api.on("before_agent_start", async (event, ctx) => {
  const requester = readRequesterProvenance({
    sessionKey: normalizeString(ctx.sessionKey) || undefined,
    channelId: normalizeString(ctx.channelId) || undefined,
  });

  if (ctx.runId) {
    saveRunApprovalContext({
      runId: ctx.runId,
      sessionKey: normalizeString(ctx.sessionKey) || undefined,
      requesterId: requester?.requesterId,
      requesterOuId: requester?.requesterOuId,
      accountId: requester?.accountId ?? normalizeString(ctx.accountId) || undefined,
      conversationId: requester?.conversationId ?? normalizeString(ctx.conversationId) || undefined,
      threadId: requester?.threadId ?? ctx.threadId,
      isGroup: requester?.isGroup === true,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
  }

  // existing managed /lynx-check handling stays above the non-tool reject branch
  if (decision.block && !managedLynxCheckPreauthorized) {
    return {
      block: true,
      blockReason: decision.blockReason ?? `[Lynx Guardian] ${decision.riskAssessment.description}`,
    } as any;
  }
});
```

- [ ] **Step 5: Narrow `message_received` so it no longer consumes free-text approvals**

```ts
api.on("message_received", async (event, ctx) => {
  if (!event.content || event.content.length === 0) return;
  rememberRecentActiveDeliveryTarget(ctx, { allowRouteOnly: true });

  const text = typeof event.content === "string"
    ? event.content
    : Array.isArray(event.content)
      ? event.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
      : String(event.content);
  if (!text) return;

  const lynxCheckTrigger = classifyLynxCheckTrigger(text);
  if (lynxCheckTrigger.kind === "native_passthrough" || lynxCheckTrigger.kind === "lynx_command") {
    return;
  }

  if (sensitiveDataBlocker.containsSensitiveData(text)) {
    await pushRecord(userId, text, 1);
    await sendHookFeedback(ctx, "Sensitive data detected");
    return;
  }

  // Do not consume free-text approvals here.
  // Non-tool risk review now happens in before_agent_start only.
});
```

- [ ] **Step 6: Run the focused hook tests**

Run: `npx vitest run --exclude ".worktrees/**" test/plugin.test.ts -t "before_dispatch|before_agent_start|non-tool|requester"`
Expected: PASS

### Task 3: Replace Tool Free-Text Confirmation With Native `requireApproval`

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\tool-approval-runtime.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: Write the failing tool-approval integration test for native approval**

```ts
it("returns native requireApproval for L2 tool risk instead of free-text retry instructions", async () => {
  vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
    block: true,
    blockReason: "[Lynx Guardian] 访问受保护文件",
    riskAssessment: {
      level: "L2",
      score: 6,
      modules: ["M2:protected_file_access"],
      description: "Protected file access",
      action: "block",
    },
  } as any);

  setup(mockApi);
  await handlers["before_dispatch"](
    {
      content: "读取配置文件",
      channel: "feishu",
      sessionKey: "sess-tool-approval-1",
      senderId: "ou_owner",
      isGroup: true,
      timestamp: 1713200002000,
    },
    {
      sessionKey: "sess-tool-approval-1",
      channelId: "feishu",
      accountId: "default",
      conversationId: "chat-tool-approval-1",
    },
  );
  await handlers["before_agent_start"](
    { prompt: "读取配置文件" },
    {
      sessionKey: "sess-tool-approval-1",
      channelId: "feishu",
      runId: "run-tool-approval-1",
    },
  );

  const result = await handlers["before_tool_call"](
    {
      toolName: "read",
      params: { file_path: "/etc/ssh/sshd_config" },
      runId: "run-tool-approval-1",
      toolCallId: "tool-call-1",
    },
    {
      sessionKey: "sess-tool-approval-1",
      channelId: "feishu",
      runId: "run-tool-approval-1",
    },
  );

  expect(result).toMatchObject({
    requireApproval: {
      title: expect.any(String),
      description: expect.stringContaining("审批通过后将继续当前工具调用"),
      severity: "warning",
      timeoutBehavior: "deny",
    },
  });
  expect(JSON.stringify(result ?? {})).not.toContain("同意后重试");
  expect(typeof result?.requireApproval?.onResolution).toBe("function");
});
```

- [ ] **Step 2: Write the failing grant-boundary tests**

```ts
it("reuses a run-bound grant only for same requester, same module, and same-or-lower risk", async () => {
  const guardToolCallSpy = vi.spyOn(safetyGuard, "guardToolCall");
  guardToolCallSpy
    .mockReturnValueOnce({
      block: true,
      blockReason: "[Lynx Guardian] 访问受保护文件",
      riskAssessment: {
        level: "L3",
        score: 8,
        modules: ["M2:protected_file_access"],
        description: "Protected file access",
        action: "block",
      },
    } as any)
    .mockReturnValueOnce({
      block: true,
      blockReason: "[Lynx Guardian] 访问受保护文件",
      riskAssessment: {
        level: "L2",
        score: 6,
        modules: ["M2:protected_file_access"],
        description: "Protected file access",
        action: "block",
      },
    } as any)
    .mockReturnValueOnce({
      block: true,
      blockReason: "[Lynx Guardian] 远程访问控制",
      riskAssessment: {
        level: "L2",
        score: 6,
        modules: ["M3:remote_access_control"],
        description: "Remote access control",
        action: "block",
      },
    } as any);

  setup(mockApi);
  await handlers["before_dispatch"](
    {
      content: "第一次高风险操作",
      channel: "feishu",
      sessionKey: "sess-tool-grant-1",
      senderId: "ou_owner",
      isGroup: true,
      timestamp: 1713200003000,
    },
    {
      sessionKey: "sess-tool-grant-1",
      channelId: "feishu",
      accountId: "default",
      conversationId: "chat-tool-grant-1",
    },
  );
  await handlers["before_agent_start"](
    { prompt: "第一次高风险操作" },
    {
      sessionKey: "sess-tool-grant-1",
      channelId: "feishu",
      runId: "run-tool-grant-1",
    },
  );

  const first = await handlers["before_tool_call"](
    {
      toolName: "read",
      params: { file_path: "/etc/ssh/sshd_config" },
      runId: "run-tool-grant-1",
      toolCallId: "tool-call-grant-1",
    },
    {
      sessionKey: "sess-tool-grant-1",
      channelId: "feishu",
      runId: "run-tool-grant-1",
    },
  );
  await first.requireApproval.onResolution?.("allow-once");

  const second = await handlers["before_tool_call"](
    {
      toolName: "read",
      params: { file_path: "/etc/hosts" },
      runId: "run-tool-grant-1",
      toolCallId: "tool-call-grant-2",
    },
    {
      sessionKey: "sess-tool-grant-1",
      channelId: "feishu",
      runId: "run-tool-grant-1",
    },
  );
  expect(second).toBeUndefined();

  const third = await handlers["before_tool_call"](
    {
      toolName: "exec",
      params: { command: "sudo -n true" },
      runId: "run-tool-grant-1",
      toolCallId: "tool-call-grant-3",
    },
    {
      sessionKey: "sess-tool-grant-1",
      channelId: "feishu",
      runId: "run-tool-grant-1",
    },
  );
  expect(third).toMatchObject({
    requireApproval: expect.any(Object),
  });
});
```

- [ ] **Step 3: Implement `tool-approval-runtime.ts`**

```ts
import {
  PluginApprovalResolutions,
  type PluginApprovalResolution,
  type PluginHookBeforeToolCallResult,
} from "openclaw/plugin-sdk";
import { saveApprovalGrant, type ApprovalRiskLevel } from "./approval-grant-store.js";

export function buildToolApprovalRequest(params: {
  toolName: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  description: string;
  timeoutMs: number;
  onResolution: (decision: PluginApprovalResolution) => void | Promise<void>;
}): NonNullable<PluginHookBeforeToolCallResult["requireApproval"]> {
  return {
    title:
      params.riskLevel === "L3"
        ? `Lynx Guardian 高风险工具审批: ${params.toolName}`
        : `Lynx Guardian 工具审批: ${params.toolName}`,
    description: [
      `[模块] ${params.module}`,
      `[风险] ${params.riskLevel}`,
      params.description,
      "审批通过后将继续当前工具调用。",
    ].join("\n"),
    severity: params.riskLevel === "L3" ? "critical" : "warning",
    timeoutMs: params.timeoutMs,
    timeoutBehavior: "deny",
    onResolution: params.onResolution,
  };
}

export function persistGrantFromApproval(params: {
  decision: PluginApprovalResolution;
  approvalId: string;
  runId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: ApprovalRiskLevel;
  grantWindowMs: number;
}): void {
  if (!params.runId) return;
  if (
    params.decision !== PluginApprovalResolutions.ALLOW_ONCE
    && params.decision !== PluginApprovalResolutions.ALLOW_ALWAYS
  ) {
    return;
  }
  const now = Date.now();
  saveApprovalGrant({
    grantId: `${params.runId}:${params.module}`,
    runId: params.runId,
    requesterOuId: params.requesterOuId,
    module: params.module,
    maxRiskLevel: params.riskLevel,
    createdAt: now,
    expiresAt: now + params.grantWindowMs,
    sourceApprovalId: params.approvalId,
  });
}
```

- [ ] **Step 4: Refactor `before_tool_call` to use grant matching and native approval**

```ts
const runContext = readRunApprovalContext(ctx.runId);
const primaryModule = decision.riskAssessment.modules[0];
const riskLevel = decision.riskAssessment.level as "L2" | "L3" | "L4";

if (riskLevel === "L4") {
  return {
    block: true,
    blockReason: decision.blockReason ?? `[Lynx Guardian] ${decision.riskAssessment.description}`,
  };
}

const matchingGrant = matchApprovalGrant({
  runId: ctx.runId,
  requesterOuId: runContext?.requesterOuId,
  module: primaryModule,
  riskLevel,
});
if (matchingGrant) {
  log.info(
    `[lynx-guardian] approval grant hit run=${ctx.runId} module=${primaryModule} risk=${riskLevel}`,
  );
  return;
}

if ((riskLevel === "L2" || riskLevel === "L3") && primaryModule) {
  const approvalId = `tool:${ctx.runId ?? "no-run"}:${event.toolCallId ?? event.toolName}`;
  return {
    requireApproval: buildToolApprovalRequest({
      toolName: event.toolName,
      module: primaryModule,
      riskLevel,
      description: decision.blockReason ?? decision.riskAssessment.description,
      timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
      onResolution: async (resolution) => {
        persistGrantFromApproval({
          decision: resolution,
          approvalId,
          runId: ctx.runId,
          requesterOuId: runContext?.requesterOuId,
          module: primaryModule,
          riskLevel,
          grantWindowMs: riskPolicyConfig.grantWindowMs,
        });
      },
    }),
  };
}

return {
  block: true,
  blockReason: decision.blockReason ?? `[Lynx Guardian] ${decision.riskAssessment.description}`,
};
```

- [ ] **Step 5: Run the focused tool-approval tests**

Run: `npx vitest run --exclude ".worktrees/**" test/plugin.test.ts -t "native requireApproval|run-bound grant|tool approval"`
Expected: PASS

### Task 4: Normalize Approval Config and Remove Legacy Free-Text UX

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\policy-runtime.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\risk-policy.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\openclaw.plugin.json`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\policy-runtime.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`

- [ ] **Step 1: Write the failing config-normalization tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizePolicyConfig } from "../src/runtime/policy-runtime.js";

describe("policy runtime config", () => {
  it("normalizes native approval timeout and grant window", () => {
    expect(
      normalizePolicyConfig({
        toolApprovalTimeoutSeconds: 150,
        grantWindowSeconds: 240,
      }),
    ).toMatchObject({
      toolApprovalTimeoutMs: 150_000,
      grantWindowMs: 240_000,
    });
  });

  it("keeps workflowAuthWindowSeconds as a deprecated alias for grantWindowSeconds", () => {
    expect(
      normalizePolicyConfig({
        workflowAuthWindowSeconds: 90,
      }),
    ).toMatchObject({
      grantWindowMs: 90_000,
    });
  });
});
```

- [ ] **Step 2: Update `policy-runtime.ts` to normalize native-approval settings**

```ts
const DEFAULT_APPROVABLE_LEVELS = ["L2", "L3"] as const;

export function normalizePolicyConfig(policy: any = {}) {
  const approvableLevels =
    policy.approvableRiskLevels
    ?? policy.allowOneTimeOverrideLevels
    ?? [...DEFAULT_APPROVABLE_LEVELS];

  const grantWindowSeconds =
    policy.grantWindowSeconds
    ?? policy.workflowAuthWindowSeconds
    ?? 180;

  return {
    absoluteRejectScore: policy.absoluteRejectScore ?? 10,
    approvableRiskLevels: approvableLevels,
    toolApprovalTimeoutMs: Math.max(30, Number(policy.toolApprovalTimeoutSeconds ?? 120)) * 1000,
    grantWindowMs: Math.min(900_000, Math.max(30, Number(grantWindowSeconds)) * 1000),
    deprecatedConfirmationPhrase:
      typeof policy.confirmationPhrase === "string" ? policy.confirmationPhrase : undefined,
    moduleOverrides: {
      M3: {
        allowOneTimeOverride: policy.moduleOverrides?.M3?.allowOneTimeOverride ?? true,
      },
    },
  };
}
```

- [ ] **Step 3: Keep hard-deny module semantics but stop building free-text approval prompts**

```ts
export interface RiskPolicyConfig {
  absoluteRejectScore?: number;
  approvableRiskLevels?: RiskLevel[];
  toolApprovalTimeoutSeconds?: number;
  grantWindowSeconds?: number;
  workflowAuthWindowSeconds?: number;
  confirmationPhrase?: string; // deprecated compatibility-only
  moduleOverrides?: {
    M2?: {
      protectedFileAccess?: { allowOneTimeOverride?: boolean };
    };
    M3?: {
      allowOneTimeOverride?: boolean;
    };
  };
}

export interface RiskPolicyResult {
  finalAction: RiskAssessment["action"];
  override: {
    allowed: boolean;
    reason?: RiskPolicyOverrideReason;
  };
}
```

- [ ] **Step 4: Update schema text and plugin copy so no path instructs “同意后重试”**

```json
"toolApprovalTimeoutSeconds": {
  "type": "integer",
  "default": 120,
  "description": "Seconds to wait for native tool approval before denying the blocked tool call"
},
"grantWindowSeconds": {
  "type": "integer",
  "default": 180,
  "description": "Seconds that same-run, same-module, same-or-lower-risk tool calls may continue after approval"
},
"confirmationPhrase": {
  "type": "string",
  "default": "确认放行本次操作",
  "description": "Deprecated. Free-text approval is no longer used by Lynx native tool approvals."
}
```

```ts
const approvalWaitingMessage =
  "[Lynx Guardian] 该工具调用已暂停，等待 owner/approver 审批；审批通过后将继续当前操作。";

const hardRejectMessage = (reason: string) =>
  `[Lynx Guardian] 已拒绝该请求：${reason}。请改写提示词后再试。`;
```

- [ ] **Step 5: Run the broader regression selection**

Run: `npx vitest run --exclude ".worktrees/**" test/plugin.test.ts test/policy-runtime.test.ts test/requester-provenance-store.test.ts test/run-approval-context-store.test.ts test/approval-grant-store.test.ts`
Expected: PASS

### Task 5: Verify the Plugin Locally and in the Real Docker Runtime

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts` (no further edits expected after fixes)
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts` (no further edits expected after fixes)

- [ ] **Step 1: Run the full local regression suite for the touched area**

Run: `npx vitest run --exclude ".worktrees/**" test/plugin.test.ts test/policy-runtime.test.ts test/requester-provenance-store.test.ts test/run-approval-context-store.test.ts test/approval-grant-store.test.ts test/lynx-check-run-store.test.ts`
Expected: PASS

- [ ] **Step 2: Run type-check validation**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Sync the plugin into the real Docker OpenClaw runtime**

Run: `node scripts-dev/verify-dev-sync.mjs`
Expected: exits successfully

Run: `.\scripts-dev\sync-openclaw-dev-ready.ps1 --logs 200`
Expected: prints `SUCCESS` after gateway health and startup markers

- [ ] **Step 4: Verify that native approval is requested from a real interactive surface**

Run: `docker exec openclaw-openclaw-gateway-1 sh -lc "openclaw gateway status 2>&1"`
Expected: gateway reports healthy

Manual check from a real Feishu or webchat session:

```text
请运行 sudo -n true 并告诉我结果
```

Expected:
- Lynx blocks the tool call via native approval instead of replying “同意后重试”
- The approval surface shows a concrete approval ID
- `/approve <id> allow-once` is accepted only for configured owner/approver

- [ ] **Step 5: Verify resume and chain-grant behavior after approval**

Manual check from the same requester and same run:

```text
/approve <id> allow-once
```

Expected:
- The blocked tool call resumes without re-prompting the model
- A later same-module lower-risk tool call in the same run auto-continues within the grant TTL
- A different-module tool call still triggers a fresh approval
- No message says `回复"同意"后重试`

Run: `docker compose logs --tail=200 openclaw-gateway`
Workdir: `D:\all-works\openclaw`
Expected: logs show the plugin approval request, resolution, and resumed tool execution without the old pending-override path

## Self-Review Checklist

- Spec coverage:
  - native tool approval migration: Task 3
  - requester `ou_id` provenance and run binding: Tasks 1-2
  - same-module same-or-lower-risk grant: Tasks 1 and 3
  - non-tool direct reject: Task 2
  - config and copy cleanup: Task 4
  - real Docker validation: Task 5
- Placeholder scan:
  - no `TODO`, `TBD`, or “implement later” markers remain
  - every task includes exact files and concrete commands
- Type consistency:
  - stores all use `runId`, `requesterOuId`, `module`, and `L2 | L3` consistently
  - native approval resolution is always handled through `onResolution`

## Deferred Follow-Up After This Plan Lands

- Feishu approval card direct `plugin.approval.resolve` wiring in `D:\all-works\openclaw`
- Passing `resolvedBy` back into plugin `onResolution` so Lynx can write first-class approver audit records
- Deleting legacy dead-code modules such as `pending-override-store.ts` and `workflow-authorization-store.ts` only after the native approval path has been stable through regression and real runtime checks
- OpenClaw chat `/approve` support for plugin approvals. Current runtime testing shows chat `/approve` still targets `exec.approval.resolve`, not `plugin.approval.resolve`.

## Runtime Validation Addendum (2026-04-15)

- Fresh local verification passed:
  - `npx tsc --noEmit`
  - focused Vitest coverage for requester provenance, run binding, grant reuse, native tool approval, and non-tool direct reject
- Fresh Docker sync passed:
  - `node scripts/verify-dev-sync.mjs`
  - `.\scripts/sync-openclaw-dev-ready.ps1 --logs 200`
- Fresh runtime evidence confirms that risky Lynx tool calls still enter `plugin.approval.waitDecision`, so the native plugin approval suspension path is alive after sync.
- Additional runtime/source inspection confirms a current platform gap:
  - chat `/approve` is still implemented against `exec.approval.resolve`
  - therefore Feishu/chat-only approval for plugin-native approvals is not fully solved by the plugin migration alone
- Planning consequence:
  - keep native plugin approval as the primary path
  - treat chat `/approve` compatibility as cross-repo work in OpenClaw core or a deliberately separate local fallback transport
