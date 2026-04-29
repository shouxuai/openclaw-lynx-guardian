# Lynx Approval Channel Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenClaw native plugin approvals practically usable from Feishu and other chat-only surfaces by shipping plugin-aware `/approve`, enforcing owner-only Feishu approval auth, and adding Feishu approval cards that resolve the original blocked tool call.

**Architecture:** Keep Lynx on native plugin approvals and run-bound reuse. In OpenClaw core, add a build-time parity check so the generated `dist/pi-embedded-*.js` bundle always matches `src/auto-reply/reply/commands-approve.ts` for plugin approval routing. In Feishu, introduce a dedicated `approvalApprovers` config using `ou_...` IDs, fail closed when that config is absent or invalid, and render native approval cards whose callbacks call `plugin.approval.resolve` directly without changing OpenClaw's default group-session model.

**Tech Stack:** TypeScript, OpenClaw gateway, Feishu extension, Vitest, pnpm, Docker Compose, Feishu card callbacks

---

## File Map

- `D:\all-works\openclaw\scripts\check-built-approve-routing.mjs`
  New build-parity guard that fails when generated `dist/pi-embedded-*.js` does not contain plugin-aware `/approve` routing.
- `D:\all-works\openclaw\package.json`
  Add a reusable `check:build:approve-routing` script so CI and local verification can catch stale bundles.
- `D:\all-works\openclaw\extensions\feishu\src\config-schema.ts`
  Add the dedicated `approvalApprovers` config surface and validate that misconfigured non-`ou_...` IDs do not silently degrade into open approval.
- `D:\all-works\openclaw\extensions\feishu\src\approval-config.ts`
  New helper module that resolves inherited Feishu approval approvers and native approval delivery defaults without reusing `allowFrom`.
- `D:\all-works\openclaw\extensions\feishu\src\approval-auth.ts`
  Replace the current fail-open adapter usage with fail-closed auth semantics for Feishu approval actions.
- `D:\all-works\openclaw\extensions\feishu\src\approval-native.ts`
  New Feishu native approval adapter that resolves origin and approver-DM targets from Feishu chat context and approver `open_id` values.
- `D:\all-works\openclaw\extensions\feishu\src\plugin-approval-card.ts`
  New renderer for pending/resolved plugin approval cards and notice payloads.
- `D:\all-works\openclaw\extensions\feishu\src\approval-gateway.ts`
  New thin gateway client wrapper for direct `plugin.approval.resolve` and `exec.approval.resolve` calls from Feishu callbacks.
- `D:\all-works\openclaw\extensions\feishu\src\card-action.ts`
  Extend structured card handling so approval buttons resolve native approvals directly instead of dispatching synthetic text.
- `D:\all-works\openclaw\extensions\feishu\src\outbound.ts`
  Add `sendPayload` support so approval payloads can be sent as Feishu interactive cards rather than downgraded plain text.
- `D:\all-works\openclaw\extensions\feishu\src\channel.ts`
  Wire `approvals.delivery`, `approvals.native`, and `approvals.render.plugin` into the Feishu channel plugin.
- `D:\all-works\openclaw\extensions\feishu\src\approval-auth.test.ts`
  Expand auth coverage for owner-only auth, absent config, and invalid `approvalApprovers`.
- `D:\all-works\openclaw\extensions\feishu\src\config-schema.test.ts`
  Add schema regression coverage for invalid non-`ou_...` approver configuration.
- `D:\all-works\openclaw\extensions\feishu\src\approval-native.test.ts`
  New coverage for origin-target resolution, approver-DM targets, and delivery capabilities.
- `D:\all-works\openclaw\extensions\feishu\src\bot.card-action.test.ts`
  Verify that Feishu card buttons call direct approval resolution and cannot be hijacked by the wrong operator.
- `D:\all-works\openclaw\extensions\feishu\src\channel.test.ts`
  Verify the Feishu plugin exposes the new approval adapters and payload renderer.
- `D:\all-works\openclaw\src\infra\plugin-approval-forwarder.test.ts`
  Keep cross-channel plugin approval forwarding green after the Feishu renderer is added.

## Scope Guard

- This plan does not change Lynx Guardian detection, evidence collection, or tool-risk scoring.
- This plan does not change OpenClaw's default Feishu group session scope.
- This plan does not reintroduce local free-text approval phrases such as "agree" or "agree then retry".
- This plan only supports explicit Feishu owner/approver `ou_...` IDs for now; broader approver lists can build on the same config surface later.

### Task 1: Gate Build And Runtime Parity For Chat `/approve`

**Files:**
- Create: `D:\all-works\openclaw\scripts\check-built-approve-routing.mjs`
- Modify: `D:\all-works\openclaw\package.json`

- [ ] **Step 1: Write the failing build-parity check script**

```js
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distDir = path.join(repoRoot, "dist");
const entry = fs
  .readdirSync(distDir)
  .find((name) => /^pi-embedded-.*\.js$/.test(name));

if (!entry) {
  throw new Error("Missing dist/pi-embedded-*.js bundle");
}

const bundlePath = path.join(distDir, entry);
const text = fs.readFileSync(bundlePath, "utf8");
const handlerStart = text.indexOf("handleApproveCommand");
if (handlerStart === -1) {
  throw new Error(`Missing handleApproveCommand in ${entry}`);
}
const handlerSlice = text.slice(handlerStart, handlerStart + 12000);
const requiredTokens = [
  "plugin.approval.resolve",
  "exec.approval.resolve",
  "allow-once",
];
const missing = requiredTokens.filter((token) => !handlerSlice.includes(token));

if (missing.length > 0) {
  console.error(`approve routing build parity failed for ${entry}`);
  console.error(`missing tokens: ${missing.join(", ")}`);
  process.exit(1);
}

console.log(`approve routing build parity OK: ${entry}`);
```

- [ ] **Step 2: Run the new parity check and confirm it fails on the current stale bundle**

Run: `node scripts/check-built-approve-routing.mjs`
Expected: FAIL because the current checked-in `dist/pi-embedded-*.js` bundle still behaves as exec-only for `/approve`.

- [ ] **Step 3: Add a reusable package script for the parity check**

```json
{
  "scripts": {
    "check:build:approve-routing": "node scripts/check-built-approve-routing.mjs"
  }
}
```

- [ ] **Step 4: Rebuild the OpenClaw bundle that Docker and packaged runtime actually use**

Run: `pnpm build:docker`
Expected: PASS and regenerate `dist/pi-embedded-*.js` so it includes the source-level `plugin.approval.resolve` routing already present in `src/auto-reply/reply/commands-approve.ts`.

- [ ] **Step 5: Re-run the parity check and focused command-routing regression**

Run: `pnpm check:build:approve-routing`
Expected: PASS

Run: `npx vitest run src/auto-reply/reply/commands.test.ts -t "plugin approval|approve"`
Expected: PASS

- [ ] **Step 6: Commit the build-parity guard before touching Feishu**

```bash
git add scripts/check-built-approve-routing.mjs package.json dist/
git commit -m "chore: guard built approve routing parity"
```

### Task 2: Separate Feishu Approval Approvers From `allowFrom` And Fail Closed

**Files:**
- Create: `D:\all-works\openclaw\extensions\feishu\src\approval-config.ts`
- Modify: `D:\all-works\openclaw\extensions\feishu\src\config-schema.ts`
- Modify: `D:\all-works\openclaw\extensions\feishu\src\approval-auth.ts`
- Modify: `D:\all-works\openclaw\extensions\feishu\src\approval-auth.test.ts`
- Modify: `D:\all-works\openclaw\extensions\feishu\src\config-schema.test.ts`

- [ ] **Step 1: Write the failing Feishu config/auth regressions**

```ts
import { describe, expect, it } from "vitest";
import { FeishuConfigSchema } from "./config-schema.js";
import { feishuApprovalAuth } from "./approval-auth.js";

describe("Feishu approval auth", () => {
  it("disables approval actions when approvalApprovers is absent", () => {
    expect(
      feishuApprovalAuth.getActionAvailabilityState({
        cfg: { channels: { feishu: { enabled: true } } },
        action: "approve",
      }),
    ).toEqual({ kind: "disabled" });
  });

  it("authorizes only matching ou_ approvers", () => {
    const cfg = {
      channels: {
        feishu: {
          enabled: true,
          approvalApprovers: ["ou_owner"],
        },
      },
    };

    expect(
      feishuApprovalAuth.authorizeActorAction({
        cfg,
        senderId: "ou_owner",
        action: "approve",
        approvalKind: "plugin",
      }),
    ).toEqual({ authorized: true });

    expect(
      feishuApprovalAuth.authorizeActorAction({
        cfg,
        senderId: "ou_other",
        action: "approve",
        approvalKind: "plugin",
      }),
    ).toMatchObject({ authorized: false });
  });

  it("rejects invalid non-ou approvalApprovers at config parse time", () => {
    expect(() =>
      FeishuConfigSchema.parse({
        enabled: true,
        approvalApprovers: ["u_legacy_user_id"],
      }),
    ).toThrow(/approvalApprovers/i);
  });
});
```

- [ ] **Step 2: Run the focused Feishu tests and confirm they fail**

Run: `npx vitest run extensions/feishu/src/approval-auth.test.ts extensions/feishu/src/config-schema.test.ts`
Expected: FAIL because the current implementation still derives approval authority from the generic adapter and does not validate `approvalApprovers`.

- [ ] **Step 3: Implement dedicated approval approver resolution and fail-closed auth**

```ts
// approval-config.ts
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { resolveFeishuAccount } from "./accounts.js";
import { normalizeFeishuTarget } from "./targets.js";

export function normalizeFeishuApproverId(value: string | number): string | undefined {
  const normalized = normalizeFeishuTarget(String(value));
  const trimmed = normalized?.trim().toLowerCase();
  return trimmed?.startsWith("ou_") ? trimmed : undefined;
}

export function getFeishuApprovalApprovers(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): string[] {
  const account = resolveFeishuAccount({ cfg: params.cfg, accountId: params.accountId }).config;
  const raw = account.approvalApprovers ?? [];
  return raw
    .map((entry) => normalizeFeishuApproverId(entry))
    .filter((entry): entry is string => Boolean(entry));
}
```

```ts
// approval-auth.ts
import { getFeishuApprovalApprovers, normalizeFeishuApproverId } from "./approval-config.js";

export function isFeishuApprovalAuthorizedSender(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  senderId?: string | null;
}) {
  const approvers = getFeishuApprovalApprovers({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const normalizedSenderId = params.senderId
    ? normalizeFeishuApproverId(params.senderId)
    : undefined;
  return Boolean(normalizedSenderId && approvers.includes(normalizedSenderId));
}

export const feishuApprovalAuth = {
  authorizeActorAction({ cfg, accountId, senderId, approvalKind }) {
    const approvers = getFeishuApprovalApprovers({ cfg, accountId });
    if (approvers.length === 0) {
      return {
        authorized: false,
        reason:
          "❌ Feishu approvals are disabled until channels.feishu.approvalApprovers is configured with ou_... IDs.",
      } as const;
    }

    const normalizedSenderId = senderId ? normalizeFeishuApproverId(senderId) : undefined;
    if (normalizedSenderId && approvers.includes(normalizedSenderId)) {
      return { authorized: true } as const;
    }

    return {
      authorized: false,
      reason: `❌ You are not authorized to approve ${approvalKind} requests on Feishu.`,
    } as const;
  },
  getActionAvailabilityState({ cfg, accountId }) {
    return getFeishuApprovalApprovers({ cfg, accountId }).length > 0
      ? ({ kind: "enabled" } as const)
      : ({ kind: "disabled" } as const);
  },
};
```

```ts
// config-schema.ts
const ApprovalApproversSchema = z.array(z.union([z.string(), z.number()])).optional();

const FeishuSharedConfigShape = {
  approvalApprovers: ApprovalApproversSchema,
  // existing shared fields...
};
```

- [ ] **Step 4: Add schema-level validation for malformed approver IDs**

```ts
const normalizedApprovalApprovers = (value.approvalApprovers ?? [])
  .map((entry) => normalizeFeishuApproverId(entry))
  .filter(Boolean);

if ((value.approvalApprovers?.length ?? 0) > 0 && normalizedApprovalApprovers.length === 0) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["approvalApprovers"],
    message: "channels.feishu.approvalApprovers must contain one or more ou_... Feishu open_id values",
  });
}
```

- [ ] **Step 5: Re-run the focused Feishu config/auth tests**

Run: `npx vitest run extensions/feishu/src/approval-auth.test.ts extensions/feishu/src/config-schema.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the fail-closed Feishu auth layer**

```bash
git add extensions/feishu/src/approval-config.ts extensions/feishu/src/config-schema.ts extensions/feishu/src/approval-auth.ts extensions/feishu/src/approval-auth.test.ts extensions/feishu/src/config-schema.test.ts
git commit -m "feat: harden feishu approval auth"
```

### Task 3: Add Feishu Native Approval Delivery And Direct Plugin Approval Cards

**Files:**
- Create: `D:\all-works\openclaw\extensions\feishu\src\approval-native.ts`
- Create: `D:\all-works\openclaw\extensions\feishu\src\approval-gateway.ts`
- Create: `D:\all-works\openclaw\extensions\feishu\src\plugin-approval-card.ts`
- Create: `D:\all-works\openclaw\extensions\feishu\src\approval-native.test.ts`
- Modify: `D:\all-works\openclaw\extensions\feishu\src\card-action.ts`
- Modify: `D:\all-works\openclaw\extensions\feishu\src\outbound.ts`
- Modify: `D:\all-works\openclaw\extensions\feishu\src\channel.ts`
- Modify: `D:\all-works\openclaw\extensions\feishu\src\bot.card-action.test.ts`
- Modify: `D:\all-works\openclaw\extensions\feishu\src\channel.test.ts`
- Modify: `D:\all-works\openclaw\src\infra\plugin-approval-forwarder.test.ts`

- [ ] **Step 1: Write the failing native-delivery and direct-resolve regressions**

```ts
import { describe, expect, it, vi } from "vitest";
import { feishuNativeApprovalAdapter } from "./approval-native.js";
import { handleFeishuCardAction } from "./card-action.js";
import { createFeishuCardInteractionEnvelope } from "./card-interaction.js";

describe("Feishu native approval adapter", () => {
  it("routes approver delivery to configured owner open_id values", async () => {
    const cfg = {
      channels: {
        feishu: {
          approvalApprovers: ["ou_owner"],
        },
      },
    };

    const targets = await feishuNativeApprovalAdapter.native?.resolveApproverDmTargets?.({
      cfg,
      approvalKind: "plugin",
      request: {
        id: "plugin:req-1",
        request: {
          pluginId: "lynx-guardian",
          title: "Sensitive tool call",
          description: "Needs owner approval",
          severity: "warning",
          toolName: "exec",
          sessionKey: "feishu:group:oc_group_1",
          turnSourceChannel: "feishu",
          turnSourceTo: "chat:oc_group_1",
        },
        createdAtMs: 1000,
        expiresAtMs: 6000,
      },
    });

    expect(targets).toEqual([{ to: "user:ou_owner" }]);
  });
});

describe("Feishu approval cards", () => {
  it("routes structured plugin approval actions through plugin.approval.resolve", async () => {
    const gatewayRequests = vi.fn();
    mockCreateOperatorApprovalsGatewayClient.mockResolvedValue(createGatewayClientStub(gatewayRequests));

    await handleFeishuCardAction({
      cfg: { channels: { feishu: { approvalApprovers: ["ou_owner"] } } },
      accountId: "default",
      event: makeCardActionEvent({
        operatorOpenId: "ou_owner",
        chatId: "oc_group_1",
        value: createFeishuCardInteractionEnvelope({
          k: "button",
          a: "feishu.plugin_approval.resolve",
          m: {
            approvalId: "plugin:req-1",
            approvalKind: "plugin",
            decision: "allow-once",
          },
          c: { u: "ou_owner", h: "oc_group_1", e: Date.now() + 60_000, t: "group" },
        }),
      }),
    });

    expect(gatewayRequests).toHaveBeenCalledWith("plugin.approval.resolve", {
      id: "plugin:req-1",
      decision: "allow-once",
    });
  });
});
```

- [ ] **Step 2: Run the focused Feishu approval-delivery tests and confirm they fail**

Run: `npx vitest run extensions/feishu/src/approval-native.test.ts extensions/feishu/src/bot.card-action.test.ts extensions/feishu/src/channel.test.ts src/infra/plugin-approval-forwarder.test.ts`
Expected: FAIL because Feishu does not yet expose a native approval adapter, direct approval resolver, or plugin approval card renderer.

- [ ] **Step 3: Implement Feishu native approval target resolution and gateway approval calls**

```ts
// approval-native.ts
import {
  createApproverRestrictedNativeApprovalAdapter,
  resolveApprovalRequestOriginTarget,
} from "openclaw/plugin-sdk/approval-runtime";
import type { ExecApprovalRequest, PluginApprovalRequest } from "openclaw/plugin-sdk/infra-runtime";
import { listFeishuAccountIds } from "./accounts.js";
import { getFeishuApprovalApprovers, normalizeFeishuApproverId } from "./approval-config.js";
import { isFeishuApprovalAuthorizedSender } from "./approval-auth.js";
import { formatFeishuTarget, normalizeFeishuTarget } from "./targets.js";

type ApprovalRequest = ExecApprovalRequest | PluginApprovalRequest;

function resolveTurnSourceFeishuOriginTarget(request: ApprovalRequest) {
  const channel = request.request.turnSourceChannel?.trim().toLowerCase() || "";
  const turnSourceTo = normalizeFeishuTarget(request.request.turnSourceTo?.trim() || "");
  if (channel !== "feishu" || !turnSourceTo) {
    return null;
  }
  return { to: formatFeishuTarget(turnSourceTo) };
}

export const feishuNativeApprovalAdapter = createApproverRestrictedNativeApprovalAdapter({
  channel: "feishu",
  channelLabel: "Feishu",
  listAccountIds: listFeishuAccountIds,
  hasApprovers: ({ cfg, accountId }) => getFeishuApprovalApprovers({ cfg, accountId }).length > 0,
  isExecAuthorizedSender: ({ cfg, accountId, senderId }) =>
    isFeishuApprovalAuthorizedSender({ cfg, accountId, senderId }),
  isPluginAuthorizedSender: ({ cfg, accountId, senderId }) =>
    isFeishuApprovalAuthorizedSender({ cfg, accountId, senderId }),
  isNativeDeliveryEnabled: ({ cfg, accountId }) =>
    getFeishuApprovalApprovers({ cfg, accountId }).length > 0,
  resolveNativeDeliveryMode: () => "both",
  requireMatchingTurnSourceChannel: true,
  resolveOriginTarget: ({ cfg, accountId, request }) =>
    resolveApprovalRequestOriginTarget({
      cfg,
      accountId,
      request,
      channel: "feishu",
      resolveTurnSourceTarget: resolveTurnSourceFeishuOriginTarget,
      resolveSessionTarget: (sessionTarget) => ({
        to: formatFeishuTarget(normalizeFeishuTarget(sessionTarget.to) ?? sessionTarget.to),
      }),
      targetsMatch: (a, b) => a.to === b.to,
    }),
  resolveApproverDmTargets: ({ cfg, accountId }) =>
    getFeishuApprovalApprovers({ cfg, accountId }).map((approver) => ({
      to: `user:${normalizeFeishuApproverId(approver) ?? approver}`,
    })),
});
```

```ts
// approval-gateway.ts
import { createOperatorApprovalsGatewayClient } from "openclaw/plugin-sdk/gateway-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ExecApprovalReplyDecision } from "openclaw/plugin-sdk/infra-runtime";

export async function resolveFeishuApproval(params: {
  cfg: OpenClawConfig;
  approvalId: string;
  decision: ExecApprovalReplyDecision;
  senderId?: string | null;
}) {
  let readySettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (err: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const markReady = () => {
    if (!readySettled) {
      readySettled = true;
      resolveReady();
    }
  };
  const failReady = (err: unknown) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(err);
    }
  };

  const client = await createOperatorApprovalsGatewayClient({
    config: params.cfg,
    clientDisplayName: `Feishu approval (${params.senderId?.trim() || "unknown"})`,
    onHelloOk: () => {
      markReady();
    },
    onConnectError: (err) => {
      failReady(err);
    },
    onClose: (code, reason) => {
      failReady(new Error(`gateway closed (${code}): ${reason}`));
    },
  });

  try {
    client.start();
    await ready;
    await client.request(
      params.approvalId.startsWith("plugin:") ? "plugin.approval.resolve" : "exec.approval.resolve",
      { id: params.approvalId, decision: params.decision },
    );
  } finally {
    await client.stopAndWait().catch(() => client.stop());
  }
}
```

- [ ] **Step 4: Render Feishu-native plugin approval cards and resolve them directly**

```ts
// plugin-approval-card.ts
import { buildPluginApprovalPendingReplyPayload, buildPluginApprovalResolvedReplyPayload } from "openclaw/plugin-sdk/approval-runtime";
import { createFeishuCardInteractionEnvelope } from "./card-interaction.js";
import { buildFeishuCardButton, buildFeishuCardInteractionContext } from "./card-ux-shared.js";

export const FEISHU_PLUGIN_APPROVAL_RESOLVE_ACTION = "feishu.plugin_approval.resolve";

function buildPluginApprovalCard(params: {
  approvalId: string;
  approvalKind: "plugin";
  operatorOpenId: string;
  chatId?: string;
  expiresAt: number;
  decisionLabels?: { allowOnce?: string; deny?: string };
}) {
  const context = buildFeishuCardInteractionContext({
    operatorOpenId: params.operatorOpenId,
    chatId: params.chatId,
    expiresAt: params.expiresAt,
    chatType: params.chatId ? "group" : "p2p",
  });

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    body: {
      elements: [
        {
          tag: "action",
          actions: [
            buildFeishuCardButton({
              label: params.decisionLabels?.allowOnce ?? "Allow Once",
              type: "primary",
              value: createFeishuCardInteractionEnvelope({
                k: "button",
                a: FEISHU_PLUGIN_APPROVAL_RESOLVE_ACTION,
                m: { approvalId: params.approvalId, approvalKind: "plugin", decision: "allow-once" },
                c: context,
              }),
            }),
            buildFeishuCardButton({
              label: params.decisionLabels?.deny ?? "Deny",
              type: "danger",
              value: createFeishuCardInteractionEnvelope({
                k: "button",
                a: FEISHU_PLUGIN_APPROVAL_RESOLVE_ACTION,
                m: { approvalId: params.approvalId, approvalKind: "plugin", decision: "deny" },
                c: context,
              }),
            }),
          ],
        },
      ],
    },
  };
}

export function buildFeishuPluginApprovalPendingPayload({ request, target, nowMs }) {
  const approverTarget = String(target.to).startsWith("user:ou_");
  const card = approverTarget
    ? buildPluginApprovalCard({
        approvalId: request.id,
        approvalKind: "plugin",
        operatorOpenId: target.to.replace(/^user:/i, ""),
        expiresAt: request.expiresAtMs,
      })
    : null;

  return buildPluginApprovalPendingReplyPayload({
    request,
    nowMs,
    text: approverTarget ? undefined : "Owner approval requested. Only configured Feishu approvers can approve this action.",
    channelData: {
      feishu: {
        approvalCard: card,
        approvalKind: "plugin",
        state: "pending",
      },
    },
  });
}

export function buildFeishuPluginApprovalResolvedPayload({ resolved }) {
  return buildPluginApprovalResolvedReplyPayload({
    resolved,
    channelData: {
      feishu: {
        approvalKind: "plugin",
        state: "resolved",
      },
    },
  });
}
```

```ts
// card-action.ts
if (decoded.kind === "structured" && envelope.a === FEISHU_PLUGIN_APPROVAL_RESOLVE_ACTION) {
  const approvalId = typeof envelope.m?.approvalId === "string" ? envelope.m.approvalId.trim() : "";
  const decision = typeof envelope.m?.decision === "string" ? envelope.m.decision.trim() : "";
  if (!approvalId || !decision) {
    await sendInvalidInteractionNotice({ cfg, event, reason: "malformed", accountId });
    return;
  }
  await resolveFeishuApproval({
    cfg,
    approvalId,
    decision: decision as "allow-once" | "deny" | "allow-always",
    senderId: event.operator.open_id,
  });
  await sendMessageFeishu({
    cfg,
    to: resolveCallbackTarget(event),
    text: `Approval submitted for ${approvalId}.`,
    accountId,
  });
  return;
}
```

- [ ] **Step 5: Teach Feishu outbound and channel wiring to deliver approval payloads as cards**

```ts
// outbound.ts
function readFeishuApprovalCard(payload: { channelData?: unknown }): Record<string, unknown> | null {
  const channelData = payload.channelData;
  if (!channelData || typeof channelData !== "object" || Array.isArray(channelData)) {
    return null;
  }
  const feishu = (channelData as { feishu?: { approvalCard?: Record<string, unknown> | null } }).feishu;
  return feishu?.approvalCard ?? null;
}

export const feishuOutbound: ChannelOutboundAdapter = {
  // existing fields...
  sendPayload: async (ctx) => {
    const approvalCard = readFeishuApprovalCard(ctx.payload);
    if (approvalCard) {
      return await sendStructuredCardFeishu({
        cfg: ctx.cfg,
        to: ctx.to,
        card: approvalCard,
        accountId: ctx.accountId ?? undefined,
        replyToMessageId: resolveReplyToMessageId({
          replyToId: ctx.replyToId,
          threadId: ctx.threadId,
        }),
      });
    }
    return await sendOutboundText({
      cfg: ctx.cfg,
      to: ctx.to,
      text: ctx.payload.text ?? "",
      accountId: ctx.accountId ?? undefined,
      replyToMessageId: resolveReplyToMessageId({
        replyToId: ctx.replyToId,
        threadId: ctx.threadId,
      }),
    });
  },
};
```

```ts
// channel.ts
import { feishuNativeApprovalAdapter } from "./approval-native.js";
import {
  buildFeishuPluginApprovalPendingPayload,
  buildFeishuPluginApprovalResolvedPayload,
} from "./plugin-approval-card.js";

// inside createChatChannelPlugin(...)
approvals: {
  delivery: feishuNativeApprovalAdapter.delivery,
  native: feishuNativeApprovalAdapter.native,
  render: {
    plugin: {
      buildPendingPayload: ({ request, target, nowMs }) =>
        buildFeishuPluginApprovalPendingPayload({ request, target, nowMs }),
      buildResolvedPayload: ({ resolved, target }) =>
        buildFeishuPluginApprovalResolvedPayload({ resolved, target }),
    },
  },
},
```

- [ ] **Step 6: Re-run the focused Feishu approval-delivery regressions**

Run: `npx vitest run extensions/feishu/src/approval-native.test.ts extensions/feishu/src/bot.card-action.test.ts extensions/feishu/src/channel.test.ts src/infra/plugin-approval-forwarder.test.ts`
Expected: PASS

- [ ] **Step 7: Commit the Feishu native approval entry path**

```bash
git add extensions/feishu/src/approval-native.ts extensions/feishu/src/approval-gateway.ts extensions/feishu/src/plugin-approval-card.ts extensions/feishu/src/card-action.ts extensions/feishu/src/outbound.ts extensions/feishu/src/channel.ts extensions/feishu/src/approval-native.test.ts extensions/feishu/src/bot.card-action.test.ts extensions/feishu/src/channel.test.ts src/infra/plugin-approval-forwarder.test.ts
git commit -m "feat: add feishu plugin approval cards"
```

### Task 4: Verify Runtime Behavior In Docker, API, And Feishu, Then Refresh The Specs

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\superpowers\specs\2026-04-15-lynx-approval-runtime-validation.md`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\superpowers\specs\2026-04-15-lynx-approval-channel-entry-spec.md`

- [ ] **Step 1: Run the complete focused regression set from the OpenClaw repo**

Run: `npx vitest run src/auto-reply/reply/commands.test.ts extensions/feishu/src/approval-auth.test.ts extensions/feishu/src/config-schema.test.ts extensions/feishu/src/approval-native.test.ts extensions/feishu/src/bot.card-action.test.ts extensions/feishu/src/channel.test.ts src/infra/plugin-approval-forwarder.test.ts`
Expected: PASS

- [ ] **Step 2: Rebuild the Docker-targeted runtime and rerun the bundle parity check**

Run: `pnpm build:docker`
Expected: PASS

Run: `pnpm check:build:approve-routing`
Expected: PASS

- [ ] **Step 3: Start the real gateway container and inspect live logs**

Run: `docker compose up -d --build openclaw-gateway`
Workdir: `D:\all-works\openclaw`
Expected: gateway container is recreated with the rebuilt `dist` bundle and updated Feishu extension code.

Run: `docker compose logs --tail=200 openclaw-gateway`
Workdir: `D:\all-works\openclaw`
Expected: no startup errors from Feishu config parsing, no approval-forwarding exceptions, and no bundle mismatch warnings from the new parity check workflow.

- [ ] **Step 4: Trigger a risky run through the local API and verify the approval wait state**

Run:

```powershell
Invoke-RestMethod http://127.0.0.1:18789/v1/chat/completions `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"model":"main","messages":[{"role":"user","content":"Please run sudo -n true and tell me the result."}]}'
```

Expected:
- Lynx produces a native plugin approval wait instead of a local "agree then retry" prompt.
- Gateway logs contain `plugin.approval.waitDecision`.
- If the chat surface can render `/approve`, `/approve <id> allow-once` resolves the blocked tool call without resending the original prompt.

- [ ] **Step 5: Verify the Feishu group and owner-only approval flow end-to-end**

Manual check from a real Feishu group:

```text
Please run sudo -n true and tell me the result.
```

Expected:
- The original requester sees either a read-only notice or non-actionable prompt in the origin chat.
- The configured owner/approver `ou_...` user receives an actionable approval card.
- A non-owner clicking the card gets a wrong-user rejection and cannot consume the approval.
- Clicking `Allow Once` resolves the approval and resumes the original blocked tool call in the existing run.
- A text fallback of `/approve plugin:<id> allow-once` also works after the rebuilt bundle is deployed.

- [ ] **Step 6: Update the two Lynx specs so the matrix and runtime notes match reality**

```md
- Mark "Feishu direct card -> plugin.approval.resolve" as implemented after the Docker and Feishu checks pass.
- Mark chat `/approve` for plugin approvals as runtime-validated only after the rebuilt `dist` bundle is confirmed in the live gateway.
- Record that Feishu approval authority now uses `approvalApprovers`, not `allowFrom`, and fails closed when misconfigured.
```

- [ ] **Step 7: Commit the verification notes and spec status updates**

```bash
git -C C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian add docs/superpowers/specs/2026-04-15-lynx-approval-runtime-validation.md docs/superpowers/specs/2026-04-15-lynx-approval-channel-entry-spec.md
git -C C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian commit -m "docs: finalize approval channel entry validation"
```

## Self-Review Checklist

- Spec coverage:
  - runtime `/approve` source-vs-dist parity: Task 1
  - dedicated Feishu owner/approver config and fail-closed auth: Task 2
  - Feishu-native plugin approval cards with direct `plugin.approval.resolve`: Task 3
  - Docker, API, Feishu, and spec-matrix validation: Task 4
- Placeholder scan:
  - no `TODO`, `TBD`, or "implement later" placeholders remain
  - every task names concrete files, commands, and expected outcomes
- Type consistency:
  - Feishu approval auth always keys off normalized `ou_...` IDs
  - plugin approvals resolve through `plugin.approval.resolve`
  - chat `/approve` runtime verification always depends on rebuilt `dist`

## Execution Notes

- Implement this plan in `D:\all-works\openclaw`, not in the Lynx plugin repo, except for the final spec refresh in `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\superpowers\specs`.
- Do not touch unrelated dirty files in `D:\all-works\openclaw`, especially `AGENTS.md` and `docker-compose.yml`.
- Keep the current Lynx plugin behavior intact: risky non-tool prompts still reject directly, and run-bound approval reuse still lives in Lynx.
