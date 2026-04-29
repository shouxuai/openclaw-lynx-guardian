# Feishu Approval Entry Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile Feishu "approve and resume the blocked tool call" path with a plugin-local `/lynx-approve` retry-grant flow that works inside Feishu chat, remains owner-`ou_id` gated, and leaves `webchat` native approval behavior unchanged.

**Architecture:** Split approval behavior by channel at the Lynx plugin boundary. `webchat` keeps the current OpenClaw native `requireApproval` path and pending-tool-approval continuation semantics; `feishu` gets a fully local flow: direct approval prompt delivery, owner-only `/lynx-approve <token> allow-once|deny`, a short-lived one-time retry grant bound to a request fingerprint, and a same-run continuation window that only covers same-module same-or-lower-risk follow-up tool calls. Guard detection, evidence collection, strong-intent instant deny, and `L4` hard deny stay exactly as they are.

**Tech Stack:** TypeScript, Vitest, OpenClaw plugin hooks, Feishu HTTP APIs, Docker/OpenClaw runtime sync scripts

---

## File Map

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\approval-request-fingerprint.ts`
  New helper for deterministic request fingerprinting from Feishu requester identity, normalized prompt text, tool identity, module, and protected-target summary.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\feishu-local-approval-grant-store.ts`
  New Feishu-only retry-grant store with TTL, one-time consume semantics, and request-fingerprint matching.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\feishu-run-continuation-store.ts`
  New short-lived same-run continuation window store for post-retry same-module same-or-lower-risk tool chains.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-feishu-direct-delivery.ts`
  New Lynx-owned outbound Feishu sender for approval prompts when hook-local `sendMessage` is unavailable.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\local-tool-approval-store.ts`
  Extend pending local approval records to include `requestFingerprint` and tighter Feishu dedup behavior.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\run-approval-context-store.ts`
  Extend run-scoped approval context to carry normalized prompt text for later request fingerprinting.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
  Rewire the Feishu approval entry flow: consume `/lynx-approve`, persist retry grants, check retry grants and continuation windows in `before_tool_call`, deliver Feishu prompts directly, and delete dead mixed native/local Feishu branches.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\approval-request-fingerprint.test.ts`
  New unit coverage for deterministic and request-sensitive fingerprints.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\feishu-local-approval-grant-store.test.ts`
  New unit coverage for owner-approved one-time retry grants.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\feishu-run-continuation-store.test.ts`
  New unit coverage for same-run continuation windows.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\lynx-feishu-direct-delivery.test.ts`
  New unit coverage for direct Feishu approval-prompt delivery via host `openclaw.json` channel config.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\local-tool-approval-store.test.ts`
  Expand dedup coverage so same-module requests no longer collapse together when request fingerprints differ.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\run-approval-context-store.test.ts`
  Expand coverage so run context keeps prompt text and identity together.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\feishu-local-approval-entry.test.ts`
  New focused hook-level regression suite for Feishu local approvals without adding more debt to `test\plugin.test.ts`.

## Scope Guard

- Do not modify `D:\all-works\openclaw`; it remains read-only reference material.
- Do not change Lynx risk recognition, evidence vectors, `verifiedOwner` scoring semantics, or policy-engine decisions.
- Do not change `safety-guard.ts` strong-intent instant-deny behavior.
- Do not broaden `buildForcedAgentStartDenyContext()` beyond the existing `L4`-only forced-deny call sites.
- Do not change `webchat` native approval UX, `requireApproval`, or `/approve` routing.
- Do not touch `test\plugin.test.ts` unless a later task proves there is no other way to cover a regression.

### Task 1: Add Feishu Request Fingerprints And Retry State Stores

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\approval-request-fingerprint.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\feishu-local-approval-grant-store.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\feishu-run-continuation-store.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\local-tool-approval-store.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\run-approval-context-store.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\approval-request-fingerprint.test.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\feishu-local-approval-grant-store.test.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\feishu-run-continuation-store.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\local-tool-approval-store.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\run-approval-context-store.test.ts`

- [ ] **Step 1: Write the failing fingerprint and store tests**

```ts
// test/approval-request-fingerprint.test.ts
import { describe, expect, it } from "vitest";
import { buildApprovalRequestFingerprint } from "../src/runtime/approval-request-fingerprint.js";

describe("approval request fingerprint", () => {
  it("returns the same fingerprint for the same logical Feishu request", () => {
    const first = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      requesterOuId: "ou_requester",
      promptText: "请直接调用 read 工具读取 SOUL.md，只返回文件内容。",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "SOUL.md",
    });

    const second = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      requesterOuId: "ou_requester",
      promptText: " 请直接调用  read 工具读取  SOUL.md ，只返回文件内容。 ",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "SOUL.md",
    });

    expect(second).toBe(first);
  });

  it("changes when prompt text or protected target changes", () => {
    const base = buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      requesterOuId: "ou_requester",
      promptText: "我想看 nginx 配置",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "nginx.conf",
    });

    expect(buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      requesterOuId: "ou_requester",
      promptText: "我想看我的 nginx 文件",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "nginx.conf",
    })).not.toBe(base);

    expect(buildApprovalRequestFingerprint({
      channelProfile: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      requesterOuId: "ou_requester",
      promptText: "我想看 nginx 配置",
      toolName: "read",
      module: "M2:protected_file_access",
      protectedTargetSummary: "SOUL.md",
    })).not.toBe(base);
  });
});
```

```ts
// test/feishu-local-approval-grant-store.test.ts
import { describe, expect, it } from "vitest";
import {
  clearFeishuLocalApprovalGrants,
  consumeFeishuLocalApprovalGrant,
  saveFeishuLocalApprovalGrant,
} from "../src/runtime/feishu-local-approval-grant-store.js";

describe("feishu local approval grant store", () => {
  it("matches exactly once for the same requester, conversation, module, and request fingerprint", () => {
    clearFeishuLocalApprovalGrants();
    const now = Date.now();
    saveFeishuLocalApprovalGrant({
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      requesterOuId: "ou_requester",
      module: "M2:protected_file_access",
      maxRiskLevel: "L3",
      requestFingerprint: "fp-1",
      grantedByOuId: "ou_owner",
      createdAt: now,
      expiresAt: now + 120_000,
      remainingUses: 1,
    });

    expect(consumeFeishuLocalApprovalGrant({
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      requesterOuId: "ou_requester",
      module: "M2:protected_file_access",
      riskLevel: "L2",
      requestFingerprint: "fp-1",
    })).toMatchObject({ grantedByOuId: "ou_owner" });

    expect(consumeFeishuLocalApprovalGrant({
      channelProfile: "feishu",
      channelId: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      requesterOuId: "ou_requester",
      module: "M2:protected_file_access",
      riskLevel: "L2",
      requestFingerprint: "fp-1",
    })).toBeUndefined();
  });
});
```

```ts
// test/local-tool-approval-store.test.ts
it("does not reuse the same token when the Feishu request fingerprint differs", () => {
  const first = registerLocalToolApproval({
    pendingId: "pending-1",
    channelProfile: "feishu",
    channelId: "feishu",
    accountId: "default",
    conversationId: "user:ou_requester",
    requesterOuId: "ou_requester",
    approverOuIds: ["ou_owner"],
    module: "M2:protected_file_access",
    riskLevel: "L3",
    toolName: "read",
    requestFingerprint: "fp-nginx",
    timeoutMs: 60_000,
    onResolution: () => {},
  });

  const second = registerLocalToolApproval({
    pendingId: "pending-2",
    channelProfile: "feishu",
    channelId: "feishu",
    accountId: "default",
    conversationId: "user:ou_requester",
    requesterOuId: "ou_requester",
    approverOuIds: ["ou_owner"],
    module: "M2:protected_file_access",
    riskLevel: "L3",
    toolName: "read",
    requestFingerprint: "fp-soul",
    timeoutMs: 60_000,
    onResolution: () => {},
  });

  expect(second.created).toBe(true);
  expect(second.approval?.approvalToken).not.toBe(first.approval?.approvalToken);
});
```

- [ ] **Step 2: Run the new focused runtime-store slice and verify it fails**

Run: `npx vitest run test/approval-request-fingerprint.test.ts test/feishu-local-approval-grant-store.test.ts test/feishu-run-continuation-store.test.ts test/local-tool-approval-store.test.ts test/run-approval-context-store.test.ts`

Expected: FAIL because the fingerprint helper and Feishu-specific grant/continuation stores do not exist yet, and `local-tool-approval-store.ts` does not understand `requestFingerprint`.

- [ ] **Step 3: Implement the new runtime primitives**

```ts
// src/runtime/approval-request-fingerprint.ts
import { createHash } from "crypto";

function normalizePromptText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function buildApprovalRequestFingerprint(params: {
  channelProfile: "feishu";
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  promptText: string;
  toolName: string;
  module: string;
  protectedTargetSummary?: string;
}): string {
  const parts = [
    params.channelProfile,
    params.accountId ?? "",
    params.conversationId ?? "",
    params.requesterOuId ?? "",
    normalizePromptText(params.promptText),
    params.toolName,
    params.module,
    params.protectedTargetSummary ?? "",
  ];
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 24);
}
```

```ts
// src/runtime/feishu-local-approval-grant-store.ts
export type FeishuLocalApprovalGrant = {
  channelProfile: "feishu";
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  maxRiskLevel: "L2" | "L3";
  requestFingerprint: string;
  grantedByOuId: string;
  createdAt: number;
  expiresAt: number;
  remainingUses: 1;
};

export function consumeFeishuLocalApprovalGrant(input: {
  channelProfile: "feishu";
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  riskLevel: "L2" | "L3";
  requestFingerprint: string;
}): FeishuLocalApprovalGrant | undefined {
  // prune expired grants, match exact requester scope + fingerprint,
  // enforce same-or-lower risk, then decrement remainingUses to zero
}
```

```ts
// src/runtime/local-tool-approval-store.ts
export type LocalToolApproval = {
  approvalToken: string;
  pendingId: string;
  requestFingerprint?: string;
  // existing fields...
};

function buildDedupKey(input: {
  sessionKey?: string;
  channelProfile?: ChannelProfile;
  channelId?: string;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  module: string;
  requestFingerprint?: string;
}): string | undefined {
  const sourceParts = [
    input.channelProfile ?? "",
    input.channelId ?? "",
    input.accountId ?? "",
    input.conversationId ?? "",
    input.requesterOuId ?? "",
    input.module,
    input.requestFingerprint ?? "",
  ];
  if (sourceParts.some((part) => part.length > 0)) {
    return sourceParts.join("::");
  }
  return input.sessionKey ? `${input.sessionKey}::${input.module}::${input.requestFingerprint ?? ""}` : undefined;
}
```

- [ ] **Step 4: Run the focused runtime-store slice again and verify it passes**

Run: `npx vitest run test/approval-request-fingerprint.test.ts test/feishu-local-approval-grant-store.test.ts test/feishu-run-continuation-store.test.ts test/local-tool-approval-store.test.ts test/run-approval-context-store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the foundational runtime state changes**

```bash
git add src/runtime/approval-request-fingerprint.ts src/runtime/feishu-local-approval-grant-store.ts src/runtime/feishu-run-continuation-store.ts src/runtime/local-tool-approval-store.ts src/runtime/run-approval-context-store.ts test/approval-request-fingerprint.test.ts test/feishu-local-approval-grant-store.test.ts test/feishu-run-continuation-store.test.ts test/local-tool-approval-store.test.ts test/run-approval-context-store.test.ts
git commit -m "feat: add feishu approval fingerprint and retry state stores"
```

### Task 2: Add A Real Lynx-Owned Feishu Approval Prompt Delivery Path

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-feishu-direct-delivery.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\lynx-feishu-direct-delivery.test.ts`

- [ ] **Step 1: Write the failing direct-delivery tests**

```ts
// test/lynx-feishu-direct-delivery.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  resetDirectFeishuApprovalDeliveryForTests,
  sendDirectFeishuApprovalMessage,
} from "../src/runtime/lynx-feishu-direct-delivery.js";

describe("lynx feishu direct delivery", () => {
  const openclawHome = join(process.cwd(), "test-temp", "direct-feishu");
  const hostConfigPath = join(openclawHome, ".openclaw", "openclaw.json");

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("HOME", openclawHome);
    vi.stubEnv("USERPROFILE", openclawHome);
    resetDirectFeishuApprovalDeliveryForTests();
    rmSync(openclawHome, { recursive: true, force: true });
  });

  it("sends a DM approval prompt using open_id when conversationId is user:ou_xxx", async () => {
    mkdirSync(dirname(hostConfigPath), { recursive: true });
    writeFileSync(hostConfigPath, JSON.stringify({
      channels: {
        feishu: {
          enabled: true,
          appId: "cli_test_app",
          appSecret: "test_secret",
          domain: "feishu",
        },
      },
    }, null, 2));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          tenant_access_token: "tenant-token",
          expire: 7200,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          data: { message_id: "om_feishu_direct_prompt" },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as any);

    const result = await sendDirectFeishuApprovalMessage({
      conversationId: "user:ou_requester",
      content: "请回复 /lynx-approve abc123 allow-once",
      logger: { info() {}, warn() {} },
    });

    expect(result).toMatchObject({ delivered: true, transport: "feishu-direct" });
    expect(String(fetchMock.mock.calls[1]?.[0] ?? "")).toContain("/open-apis/im/v1/messages");
    expect(String(fetchMock.mock.calls[1]?.[0] ?? "")).toContain("receive_id_type=open_id");
  });

  it("fails closed when host Feishu channel config is missing", async () => {
    const result = await sendDirectFeishuApprovalMessage({
      conversationId: "user:ou_requester",
      content: "prompt",
      logger: { info() {}, warn() {} },
    });

    expect(result).toMatchObject({ delivered: false, transport: "none" });
  });
});
```

- [ ] **Step 2: Run the direct-delivery tests and verify they fail**

Run: `npx vitest run test/lynx-feishu-direct-delivery.test.ts`

Expected: FAIL because `src/runtime/lynx-feishu-direct-delivery.ts` does not exist yet.

- [ ] **Step 3: Implement Feishu direct delivery with host channel config lookup**

```ts
// src/runtime/lynx-feishu-direct-delivery.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { resolveRuntimeHomeDir } from "./plugin-runtime-helpers.js";

type DirectDeliveryResult = {
  delivered: boolean;
  transport: "feishu-direct" | "none";
  reason?: string;
};

function resolveFeishuReceiveTarget(conversationId: string): {
  receiveId: string;
  receiveIdType: "chat_id" | "open_id" | "user_id";
} | null {
  const normalized = conversationId.trim();
  if (normalized.startsWith("user:")) {
    return { receiveId: normalized.slice("user:".length), receiveIdType: "open_id" };
  }
  if (normalized.startsWith("dm:")) {
    return { receiveId: normalized.slice("dm:".length), receiveIdType: "open_id" };
  }
  return { receiveId: normalized, receiveIdType: "chat_id" };
}

export async function sendDirectFeishuApprovalMessage(params: {
  conversationId?: string;
  content: string;
  logger?: Pick<Console, "info" | "warn">;
}): Promise<DirectDeliveryResult> {
  // read ~/.openclaw/openclaw.json -> channels.feishu
  // fetch tenant_access_token
  // POST /open-apis/im/v1/messages?receive_id_type=...
  // return delivered=false instead of throwing when config or conversation target is unavailable
}

export function resetDirectFeishuApprovalDeliveryForTests(): void {
  // clear cached token/config between tests
}
```

- [ ] **Step 4: Run the direct-delivery tests again and verify they pass**

Run: `npx vitest run test/lynx-feishu-direct-delivery.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the direct-delivery module**

```bash
git add src/runtime/lynx-feishu-direct-delivery.ts test/lynx-feishu-direct-delivery.test.ts
git commit -m "feat: add direct feishu approval prompt delivery"
```

### Task 3: Consume `/lynx-approve` Into Retry Grants Instead Of Resuming Blocked Runs

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\feishu-local-approval-entry.test.ts`

- [ ] **Step 1: Write the failing Feishu approval-entry tests**

```ts
// test/feishu-local-approval-entry.test.ts
it("consumes an owner /lynx-approve reply in before_dispatch and tells the requester to resend", async () => {
  setup(mockApi);
  await handlers["before_agent_start"](
    {
      prompt: "我想看 nginx 配置",
      messages: [{ role: "user", content: "我想看 nginx 配置" }],
    },
    {
      sessionKey: "sess-feishu-entry",
      channelId: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      runId: "run-feishu-entry",
      senderId: "ou_requester",
    },
  );

  const first = await handlers["before_tool_call"](
    {
      toolName: "read",
      params: { file_path: "/etc/nginx/nginx.conf" },
      runId: "run-feishu-entry",
      toolCallId: "tool-1",
    },
    {
      sessionKey: "sess-feishu-entry",
      channelId: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      runId: "run-feishu-entry",
      senderId: "ou_requester",
    },
  );

  expect(first).toMatchObject({
    block: true,
    blockReason: expect.stringContaining("/lynx-approve"),
  });

  const token = String(first.blockReason).match(/\/lynx-approve\s+([a-z0-9]+)\s+allow-once/i)?.[1];
  const reply = await handlers["before_dispatch"](
    {
      content: `/lynx-approve ${token} allow-once`,
      channel: "feishu",
      senderId: "ou_owner",
      timestamp: Date.now(),
    },
    {
      sessionKey: "sess-feishu-entry",
      channelId: "feishu",
      accountId: "default",
      conversationId: "user:ou_requester",
      senderId: "ou_owner",
    },
  );

  expect(reply).toMatchObject({
    handled: true,
    text: expect.stringContaining("请原请求人在当前 Feishu 会话重发刚才的请求"),
  });
});

it("rejects /lynx-approve from a non-owner ou_id", async () => {
  // seed a pending local approval, then assert before_dispatch replies
  // with '当前 ou_id 无审批权限' and does not create a retry grant
});
```

- [ ] **Step 2: Run the focused Feishu approval-entry tests and verify they fail**

Run: `npx vitest run test/feishu-local-approval-entry.test.ts`

Expected: FAIL because the current flow still resolves the pending approval promise and claims the blocked tool call will continue.

- [ ] **Step 3: Rewire Feishu approval replies around retry grants**

```ts
// index.ts
function resolveFeishuLocalToolApprovalReply(params: {
  event: any;
  ctx: any;
  localApprovalReply: {
    command: "lynx-approve";
    token?: string;
    resolution: "allow-once" | "deny";
  };
}): { handled: boolean; replyText?: string } {
  const actorOuId = resolveActorOuId(params.event, params.ctx);
  if (!actorOuId) {
    return { handled: true, replyText: "[Lynx Guardian] 当前审批只接受带 Feishu ou_id 的回复。" };
  }

  const localApproval = params.localApprovalReply.token
    ? readLocalToolApprovalByToken(params.localApprovalReply.token)
    : undefined;
  if (!localApproval) {
    return { handled: true, replyText: "[Lynx Guardian] 审批 token 无效或已过期。" };
  }
  if (!canActorResolveLocalToolApproval(actorOuId, localApproval)) {
    return { handled: true, replyText: "[Lynx Guardian] 当前 ou_id 无审批权限。" };
  }

  if (params.localApprovalReply.resolution === "deny") {
    localApproval.resolve("deny");
    return { handled: true, replyText: "[Lynx Guardian] 已拒绝本次操作。" };
  }

  saveFeishuLocalApprovalGrant({
    channelProfile: "feishu",
    channelId: localApproval.channelId,
    accountId: localApproval.accountId,
    conversationId: localApproval.conversationId,
    requesterOuId: localApproval.requesterOuId,
    module: localApproval.module,
    maxRiskLevel: localApproval.maxRiskLevel,
    requestFingerprint: localApproval.requestFingerprint!,
    grantedByOuId: actorOuId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 2 * 60 * 1000,
    remainingUses: 1,
  });
  localApproval.resolve("allow-once");
  return {
    handled: true,
    replyText: "[Lynx Guardian] 已批准本次操作。请原请求人在当前 Feishu 会话重发刚才的请求。",
  };
}
```

```ts
// index.ts in before_agent_start
const promptText = resolveAgentStartPromptText(event);
if (ctx.runId) {
  saveRunApprovalContext({
    runId: ctx.runId,
    sessionKey,
    channelProfile,
    approvalTransport,
    requesterId: approvalContextSeed.requesterId,
    requesterOuId: approvalContextSeed.requesterOuId,
    accountId: approvalContextSeed.accountId,
    conversationId: normalizedApprovalConversationId,
    threadId: approvalContextSeed.threadId,
    isGroup: approvalContextSeed.isGroup,
    promptText,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 60 * 1000,
  });
}
```

- [ ] **Step 4: Run the focused Feishu approval-entry tests again and verify they pass**

Run: `npx vitest run test/feishu-local-approval-entry.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the Feishu approval-entry rewrite**

```bash
git add index.ts test/feishu-local-approval-entry.test.ts
git commit -m "fix: convert feishu local approval replies into retry grants"
```

### Task 4: Split `before_tool_call` By Channel And Apply Feishu Retry Semantics

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\feishu-local-approval-entry.test.ts`

- [ ] **Step 1: Add failing hook-level tests for retry grant consumption and chained continuation**

```ts
it("allows the retried Feishu request after a matching retry grant is consumed", async () => {
  // first call -> block and emit /lynx-approve token
  // owner reply -> create retry grant
  // second before_agent_start + before_tool_call with same prompt and same tool target -> allow
});

it("requires a new approval when the follow-up tool call changes module or raises risk", async () => {
  // after a retried request enters, same-module lower-risk follow-up should pass,
  // but switching from M2 to M3 or from L2 to L3 should block again
});
```

- [ ] **Step 2: Run the focused hook-level tests and verify they fail**

Run: `npx vitest run test/feishu-local-approval-entry.test.ts`

Expected: FAIL because `before_tool_call` still routes Feishu requests through native approval scaffolding or local pending-wait semantics.

- [ ] **Step 3: Rewrite the Feishu branch in `before_tool_call`**

```ts
// index.ts
const isFeishuLocalApproval = preferredToolApprovalTransport === "local-chat"
  && (effectiveRunApprovalContext.channelProfile ?? resolveChannelProfile(ctx?.channelId ?? ctx?.channel)) === "feishu";

if (isFeishuLocalApproval) {
  const promptText = normalizeString(runApprovalContext?.promptText) || "";
  const requestFingerprint = buildApprovalRequestFingerprint({
    channelProfile: "feishu",
    accountId: effectiveRunApprovalContext.accountId,
    conversationId: effectiveRunApprovalContext.conversationId,
    requesterOuId: effectiveRunApprovalContext.requesterOuId,
    promptText,
    toolName,
    module: primaryModule,
    protectedTargetSummary: summarizeProtectedToolTarget(toolName, params),
  });

  const continuation = readFeishuRunContinuationWindow({
    runId: ctx.runId,
    requesterOuId: effectiveRunApprovalContext.requesterOuId,
    module: primaryModule,
    riskLevel: approvalRiskLevel,
  });
  if (continuation) {
    return;
  }

  const grant = consumeFeishuLocalApprovalGrant({
    channelProfile: "feishu",
    channelId: normalizeString(ctx?.channelId ?? ctx?.channel) || "feishu",
    accountId: effectiveRunApprovalContext.accountId,
    conversationId: effectiveRunApprovalContext.conversationId,
    requesterOuId: effectiveRunApprovalContext.requesterOuId,
    module: primaryModule,
    riskLevel: approvalRiskLevel,
    requestFingerprint,
  });
  if (grant) {
    saveFeishuRunContinuationWindow({
      runId: ctx.runId,
      channelProfile: "feishu",
      requesterOuId: effectiveRunApprovalContext.requesterOuId,
      module: primaryModule,
      maxRiskLevel: grant.maxRiskLevel,
      createdAt: Date.now(),
      expiresAt: Date.now() + 2 * 60 * 1000,
    });
    return;
  }

  const localApproval = registerLocalToolApproval({
    pendingId: approvalId,
    sessionKey: normalizeString(ctx?.sessionKey) || undefined,
    channelProfile: "feishu",
    channelId: normalizeString(ctx?.channelId ?? ctx?.channel) || "feishu",
    accountId: effectiveRunApprovalContext.accountId,
    requesterOuId: effectiveRunApprovalContext.requesterOuId,
    approverOuIds: localApprovalApproverOuIds,
    conversationId: effectiveRunApprovalContext.conversationId,
    module: primaryModule,
    riskLevel: approvalRiskLevel,
    toolName,
    requestFingerprint,
    timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
    onResolution: () => {},
  });

  const delivered = await sendDirectFeishuApprovalMessage({
    conversationId: effectiveRunApprovalContext.conversationId,
    content: buildFeishuLocalToolApprovalPrompt({
      approvalToken: localApproval.approval!.approvalToken,
      module: primaryModule,
      riskLevel: approvalRiskLevel,
      toolName,
      timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
    }),
    logger: log,
  });
  if (!delivered.delivered) {
    discardLocalToolApproval(localApproval.approval?.approvalToken);
    return {
      block: true,
      blockReason: "[Lynx Guardian] 审批提示发送失败，已拒绝本次操作。",
    };
  }
  return {
    block: true,
    blockReason: buildFeishuLocalApprovalPendingBlockReason({
      approvalToken: localApproval.approval!.approvalToken,
      toolName,
      module: primaryModule,
      riskLevel: approvalRiskLevel,
    }),
  };
}
```

- [ ] **Step 4: Preserve the native path for `webchat` and other non-Feishu routes**

```ts
// index.ts
const pendingApproval = preferredToolApprovalTransport === "local-chat"
  ? undefined
  : ctx.runId
  ? getOrCreatePendingToolApproval({
      runId: ctx.runId,
      requesterOuId: effectiveRunApprovalContext.requesterOuId,
      module: primaryModule,
      riskLevel: approvalRiskLevel ?? "L2",
      timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
      pendingId: approvalId,
    })
  : undefined;

// keep existing native requireApproval path below this point unchanged
return {
  requireApproval: buildToolApprovalRequest({
    toolName,
    module: primaryModule,
    riskLevel: approvalRiskLevel,
    description: blockReason,
    timeoutMs: riskPolicyConfig.toolApprovalTimeoutMs,
    onResolution: resolveApproval,
  }),
};
```

- [ ] **Step 5: Run the hook-level tests again and verify they pass**

Run: `npx vitest run test/feishu-local-approval-entry.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the Feishu `before_tool_call` split**

```bash
git add index.ts test/feishu-local-approval-entry.test.ts
git commit -m "feat: split feishu approval flow from native tool approvals"
```

### Task 5: Delete Dead Mixed Feishu Approval Logic And Verify Local Regressions

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`

- [ ] **Step 1: Remove dead or misleading Feishu-native compatibility code**

Delete these blocks once Task 4 is green:

```ts
function extractApproveCommand(text: string) {
  // remove
}

function appendFeishuNativeApprovalGuidance(text: string): string {
  // remove
}

function buildFeishuNativeToolApprovalReplyPrompt(params: {
  approvalId: string;
  module: string;
  riskLevel: string;
  toolName: string;
  timeoutMs: number;
  confirmationPhrase: string;
}): string {
  // remove
}

async function sendFeishuNativeToolApprovalPrompt(params: {
  ctx: any;
  approvalId: string;
  requesterOuId?: string;
  conversationId?: string;
  accountId?: string;
  threadId?: string | number;
  content: string;
}): Promise<boolean> {
  // remove
}
```

- [ ] **Step 2: Delete the dead `if (false && ...)` branches so Feishu cannot silently drift back into `/approve` messaging**

```ts
// delete both of these dead blocks entirely
if (false && (((effectiveRunApprovalContext.channelProfile ?? resolveChannelProfile(...)) === "feishu"))) {
  await sendFeishuNativeToolApprovalPrompt(...);
}
```

- [ ] **Step 3: Make the user-facing Feishu prompt set canonical and minimal**

```ts
function buildFeishuLocalToolApprovalPrompt(params: {
  approvalToken: string;
  module: string;
  riskLevel: string;
  toolName: string;
  timeoutMs: number;
}): string {
  const timeoutSeconds = Math.max(1, Math.round(params.timeoutMs / 1000));
  return [
    `[Lynx Guardian] 操作需要审批`,
    `工具: ${params.toolName}`,
    `模块: ${params.module}`,
    `风险: ${params.riskLevel}`,
    "",
    `请由 owner 在当前 Feishu 会话回复以下命令之一：`,
    `${LOCAL_TOOL_APPROVAL_COMMAND} ${params.approvalToken} allow-once`,
    `${LOCAL_TOOL_APPROVAL_COMMAND} ${params.approvalToken} deny`,
    "",
    "审批通过后，请原请求人在当前 Feishu 会话重发刚才的请求。",
  ].join("\n");
}
```

- [ ] **Step 4: Run the focused local regression suite**

Run: `npx vitest run test/approval-request-fingerprint.test.ts test/feishu-local-approval-grant-store.test.ts test/feishu-run-continuation-store.test.ts test/lynx-feishu-direct-delivery.test.ts test/local-tool-approval-store.test.ts test/run-approval-context-store.test.ts test/feishu-local-approval-entry.test.ts`

Expected: PASS

- [ ] **Step 5: Run TypeScript verification**

Run: `npx tsc --noEmit`

Expected: exit code `0`

- [ ] **Step 6: Commit the cleanup**

```bash
git add index.ts
git commit -m "refactor: remove dead feishu native approval compatibility"
```

### Task 6: Sync Into Real OpenClaw Runtime And Prove The Feishu Flow

**Files:**
- Runtime verification only

- [ ] **Step 1: Sync the plugin into the real Docker runtime**

Run: `node scripts/verify-dev-sync.mjs`

Expected: sync precheck passes and reports the plugin repo can be staged.

- [ ] **Step 2: Restart and resync the real gateway**

Run: `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`

Expected: gateway restarts successfully and the log summary does not end in `blocked`.

- [ ] **Step 3: Verify gateway health**

Run: `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz`

Expected: HTTP `200` with `{"ok":true,"status":"live"}`

- [ ] **Step 4: Verify the authenticated OpenClaw API path still works**

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
      content = "reply with pong only"
    }
  )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:18789/v1/chat/completions `
  -Headers $headers `
  -Body $body
```

Expected: API replies with `pong`, proving the gateway is healthy before the Feishu live test.

- [ ] **Step 5: Trigger a real Feishu approval-eligible request**

Manual Feishu DM message:

```text
我想看 nginx 配置
```

Expected in Feishu chat:

```text
[Lynx Guardian] 操作需要审批
工具: read
模块: M2:protected_file_access
风险: L3

请由 owner 在当前 Feishu 会话回复以下命令之一：
/lynx-approve <token> allow-once
/lynx-approve <token> deny

审批通过后，请原请求人在当前 Feishu 会话重发刚才的请求。
```

- [ ] **Step 6: Approve from the configured owner `ou_id` and verify the grant reply**

Manual Feishu reply:

```text
/lynx-approve <token> allow-once
```

Expected in Feishu chat:

```text
[Lynx Guardian] 已批准本次操作。请原请求人在当前 Feishu 会话重发刚才的请求。
```

- [ ] **Step 7: Resend the same requester prompt and verify the tool call now passes**

Manual Feishu resend:

```text
我想看 nginx 配置
```

Expected:
- The retried request proceeds without a second approval prompt.
- A same-run same-module same-or-lower-risk follow-up tool call can continue automatically.
- A higher-risk or different-module follow-up triggers a fresh approval prompt instead of borrowing the old one.

- [ ] **Step 8: Inspect logs and artifacts for the real Feishu proof**

Run: `docker compose logs --tail=200 openclaw-gateway`

Expected log markers:
- direct Feishu approval prompt delivery was attempted and succeeded
- owner `ou_id` matched and created a retry grant
- the retried request consumed the retry grant
- no log claims that the blocked original tool call resumed inline

Run: `Get-Content "$env:USERPROFILE\.openclaw\lynx\hook-probe.log" -Tail 200`

Expected hook markers:
- `before_dispatch` or `before_agent_start` consumed `/lynx-approve`
- `before_tool_call` used the Feishu retry grant or continuation window

- [ ] **Step 9: Run one `webchat` smoke test before claiming completion**

Validation rule:
- Use an existing `webchat` approval-eligible prompt and confirm it still opens native approval instead of `/lynx-approve`.
- If a real `webchat` run is unavailable, do not claim full cross-channel completion; report Feishu complete and `webchat` unverified.

- [ ] **Step 10: Commit only after the real runtime proof is captured**

```bash
git add .
git commit -m "feat: ship feishu-only local approval retry flow"
```

## Acceptance Mapping

- Spec items 1-3 and 5 map to Tasks 2-4.
- Spec items 4 and 6-7 map to Task 4.
- Spec item 8 is preserved by the Scope Guard and verified in Task 6.
- Spec item 9 is preserved by Task 4 Step 4 and Task 6 Step 9.

## Placeholder Scan

- No task in this plan relies on `test\plugin.test.ts`.
- No task tells the implementer to "handle edge cases later"; every new state store and hook branch lists concrete files, tests, and commands.
- The only manual steps are the real Feishu and `webchat` runtime proofs, because those cannot be replaced by local unit tests.
