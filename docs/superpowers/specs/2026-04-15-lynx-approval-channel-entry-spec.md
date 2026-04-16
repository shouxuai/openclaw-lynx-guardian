# Lynx Approval Channel Entry Spec

Date: 2026-04-15
Status: source-validated, partially runtime-validated

## Executive Summary

- OpenClaw source already has plugin-aware chat `/approve` routing.
- The checked-in OpenClaw `dist/` bundles are still stale and remain exec-only for `/approve`.
- Feishu can already provide the two primitives we need for a safe approval UX:
  - stable requester identity via `open_id` / `ou_...`
  - card callbacks bound to operator `open_id`, `chat_id`, and expiry window
- Feishu does **not** yet have a direct native plugin-approval card wired to `plugin.approval.resolve`.
- Current "owner-only" approval can be done with Feishu `open_id`, but there is no built-in "machine owner" abstraction today. The practical current owner model is "configured approver open_id list", starting with a single owner.

## What Was Validated

### OpenClaw source

- `D:\all-works\openclaw\src\auto-reply\reply\commands-approve.ts`
  - `/approve plugin:<id> allow-once` routes to `plugin.approval.resolve`
  - legacy unprefixed IDs can fall back from exec to plugin resolution
- `D:\all-works\openclaw\src\gateway\server-methods\plugin-approval.ts`
  - plugin approvals have first-class request / wait / resolve handlers
  - unique short ID prefixes are supported
- `D:\all-works\openclaw\ui\src\ui\app-gateway.ts`
  - Control UI queue consumes both `plugin.approval.requested` and `plugin.approval.resolved`

### Feishu source

- `D:\all-works\openclaw\extensions\feishu\src\bot.ts`
  - inbound Feishu messages expose sender `open_id` and keep it in message context
- `D:\all-works\openclaw\extensions\feishu\src\bot-content.ts`
  - default group session scope is still group-level unless explicitly changed
- `D:\all-works\openclaw\extensions\feishu\src\approval-auth.ts`
  - approval auth normalizes approvers from Feishu `open_id` values starting with `ou_`
- `D:\all-works\openclaw\extensions\feishu\src\card-interaction.ts`
  - card callbacks reject wrong user, wrong conversation, and expired actions
- `D:\all-works\openclaw\extensions\feishu\src\card-action.ts`
  - Feishu card actions can dispatch a synthetic command back into the normal Feishu message handler
- `D:\all-works\openclaw\extensions\feishu\src\monitor.account.ts`
  - webhook mode already handles `card.action.trigger`

### Native tests run this turn

- Passed:
  - `npx vitest run src/auto-reply/reply/commands.test.ts -t "plugin approval|approve"`
  - `npx vitest run extensions/feishu/src/approval-auth.test.ts`
  - `npx vitest run extensions/feishu/src/bot.card-action.test.ts`
- Not used as final evidence:
  - `npx vitest run extensions/feishu/src/monitor.card-action.lifecycle.test.ts`
  - this timed out in the current local environment, so conclusions do not depend on it

## Current Capability Matrix

| Channel / entry | Exec approval | Plugin approval | Current usable status | Identity boundary | Notes |
| --- | --- | --- | --- | --- | --- |
| Control UI / WebChat native approval queue | Yes | Yes | Yes in source model; preferred when UI is reachable | Gateway operator session, not Feishu `open_id` | UI already consumes plugin approval events into the approval queue |
| Chat `/approve` on current OpenClaw **source** | Yes | Yes | Yes after rebuild / deploy | Channel auth adapter + sender identity | Source now routes plugin approvals correctly |
| Chat `/approve` on current checked-in **dist** bundle | Yes | No | Still effectively exec-only | Depends on current runtime artifact | This is the main source/runtime mismatch causing confusion |
| Feishu plain-text `/approve` | Yes | Conditionally yes | Usable only after the core `/approve` fix is actually deployed | Feishu sender `open_id` | Needs exact hint text; free-text `agree` should not be advertised |
| Feishu card button dispatching synthetic text command | Yes | Indirect only | Infra exists, but depends on text `/approve` working in runtime | `open_id` + `chat_id` + expiry | Safe against hijack, but still not a direct plugin resolve |
| Feishu direct card -> `plugin.approval.resolve` | N/A | Target state | Not implemented yet | `open_id` + `chat_id` + expiry + approver list | Best medium-term Feishu UX |
| Operator HTTP / API client | Yes | Yes | Technically usable now | `operator.approvals` scope | Good for ops and tests, not good end-user UX |

## Feishu-Specific Findings

### 1. Feishu can distinguish the requester

- Incoming Feishu events already carry `sender.sender_id.open_id`.
- For your use case, this is the right identity key for "owner-only" approval.
- In group chats, OpenClaw still defaults to a group-level session, so multiple users can speak in one session; this does **not** remove the need for run-bound approval ownership.

### 2. Feishu can prevent approval hijacking

- Structured card callbacks already embed:
  - expected operator `open_id`
  - expected `chat_id`
  - expiry timestamp
- The decoder rejects:
  - wrong user
  - wrong conversation
  - stale card
- This is exactly the primitive needed so "someone else in the group cannot steal this approval."

### 3. Feishu already has a usable approval transport building block

- A card click can already dispatch a synthetic command back through the normal Feishu message pipeline.
- That means Feishu can support:
  - `/approve <id> allow-once`
  - or a future direct plugin resolve callback
- So the missing part is not channel capability; it is the missing approval-product wiring.

### 4. Current Feishu approval auth has an important fail-open sharp edge

- `feishuApprovalAuth` only keeps approver IDs that normalize to `ou_...`.
- If the approver config is empty after normalization, the generic auth helper authorizes everyone.
- Consequence:
  - if `channels.feishu.allowFrom` is empty, approval is effectively unrestricted
  - if it contains `user_id`-style values instead of `ou_...`, approval is also effectively unrestricted
- Therefore the current owner-only rollout must require:
  - explicit Feishu approver config in `open_id` / `ou_...` format
  - or a code change to fail closed when approval entry is enabled but no valid approver IDs resolve

### 5. Feishu chat owner metadata exists, but is not the same as approval owner

- `extensions/feishu/src/chat.ts` can read Feishu `owner_id` from the chat API.
- This is chat ownership metadata, not a current OpenClaw approval-owner abstraction.
- There is no existing core mechanism that says "the machine owner is this Feishu `open_id`."

## Recommended Medium-Term Design

### Option A: Finish the core-native path first

- Ship the existing source-level `/approve` plugin routing into the real runtime build.
- Standardize every non-UI channel on the exact same command:
  - `/approve <id> allow-once|allow-always|deny`
- In Lynx / channel notifications, only surface commands that the current runtime actually supports.

Pros:

- Lowest conceptual cost
- Uses OpenClaw-native approval semantics
- Works across many text channels, not just Feishu

Cons:

- Still not great UX on Feishu if the user cannot easily access Control UI
- Still requires typing approval commands manually

### Option B: Add a Feishu-native approval card that resolves plugin approvals directly

- When `plugin.approval.requested` is forwarded to Feishu, render a card with:
  - approval summary
  - exact risk/module
  - allow-once / deny buttons
  - hidden context: approval ID, owner `open_id`, chat ID, expiry, run/session metadata
- On callback, call `plugin.approval.resolve` directly instead of dispatching a synthetic text `/approve`.

Pros:

- Best Feishu UX
- Strongest anti-hijack properties
- No dependency on users reaching WebChat

Cons:

- More implementation than Option A
- Needs a clean plugin-approval forwarder / renderer path in OpenClaw core or Feishu extension

### Recommendation

- Recommended order:
  1. fix deployment parity so source `/approve` behavior is actually live
  2. enforce owner-only Feishu approvers with `ou_...` IDs and fail-closed validation
  3. add direct Feishu plugin-approval cards as the convenience layer

This keeps OpenClaw default behavior intact while giving Feishu a truly usable path afterward.

## Owner-Only Policy For Phase 1

- Approval grant should be tied to:
  - `runId`
  - requester `open_id`
  - approval window TTL
  - same module
  - same or lower risk only
- Feishu approver identity should be matched only on normalized `open_id` / `ou_...`
- Other group members may keep sending messages, but they must not:
  - consume this approval
  - inherit this grant
  - press a valid card button unless they are the intended approver

## Required Follow-Ups

- OpenClaw core / deployment:
  - rebuild and ship the plugin-aware `/approve` source
  - make runtime hints truthful per channel
- Feishu channel:
  - add direct plugin-approval card render / resolve
  - fail closed when approval approver config resolves to zero valid `ou_...` IDs
- Lynx Guardian:
  - keep approvals bound to run/requester/module/risk window
  - keep non-tool high-risk requests on direct reject
  - do not weaken current evidence collection or recognition logic
