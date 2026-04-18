# Approval Channel Alignment And Stable L3 Reproduction Design

## Scope

This design applies only to the Lynx Guardian plugin in:

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`

It does not modify:

- OpenClaw core behavior in `D:\all-works\openclaw`
- native OpenClaw approval object schema
- evidence collection architecture
- attack graph / taint architecture
- existing `L4` instant deny semantics

This design covers:

- approval behavior alignment between `webchat` and `feishu`
- user-facing approval messaging
- removal of the current Feishu-only risk-path exception
- a deterministic way to reproduce `L3` approval in both channels for testing

## Goal

Make approval behavior predictable and channel-correct without splitting the protection model by channel.

The target outcome is:

1. `webchat` and `feishu` use the same Lynx risk classification rules
2. channel differences exist only at the approval transport and UI layer
3. `webchat` never tells the user to go approve in Feishu
4. `webchat` uses native OpenClaw approval UX whenever the request reaches native tool approval
5. `feishu` keeps a single chat-visible actionable approval message for Lynx-managed approvals
6. `L3` approval can be reproduced reliably in both channels with a fixed regression request that targets a dedicated approval probe file, without reading real sensitive files

## Non-Goals

This phase does not:

- change OpenClaw core approval routing
- rewrite the Lynx guard / policy architecture
- change `L4` strong-intent deny behavior
- make non-tool deny paths approval-eligible
- add a synthetic "fake approval request" shortcut that bypasses the normal guard and approval stack
- change native OpenClaw `/approve` behavior for non-Lynx-managed approvals

## Problem Statement

The current runtime behavior mixes two different kinds of divergence:

### 1. Risk divergence

Today `feishu` has a plugin-side special case for protected direct-read requests:

- a trusted Feishu requester can be deferred from `before_agent_start` to tool-stage approval
- the same logical request in `webchat` is blocked earlier by normal guard behavior

That means the same user intent can receive different risk-path outcomes depending on channel.

### 2. Messaging divergence

Approval transport context and recovered Feishu context can leak into user-visible messaging:

- `webchat` requests may still mention Feishu approval instructions
- `webchat` can lose its clean native approval experience
- users see duplicated or conflicting approval instructions

### 3. Test instability

Current natural-language protected-read prompts are not a stable `L3` test surface:

- some prompts fall into `M2:system_prompt_extraction` and become `L4`
- some prompts depend on model behavior to decide whether a tool call happens
- some prompts are tied to real protected files such as `SOUL.md` and `USER.md`

This makes approval-path testing noisy and hard to compare across channels.

## Key Decisions

## Decision 1: Remove the Feishu-only risk-path exception

The current Feishu-only protected-read deferral path will be removed.

After this change:

- `webchat` and `feishu` use the same guard and policy decision path
- channel no longer changes whether a request is classified as `deny`, `block`, `confirm`, or `allow`
- channel affects only how an approval-eligible block is surfaced to the user

This means Lynx no longer treats trusted Feishu protected-file reads as a special risk category.

## Decision 2: Keep transport split, not risk split

Approval transport remains channel-specific.

### `webchat`

Use native OpenClaw approval UX.

Expected behavior:

- native popup / native approval request
- native `/approve <id> ...` if the user is using chat command flow
- no Lynx-specific Feishu wording

### `feishu`

Use Lynx local chat approval for Lynx-managed approvals.

Expected behavior:

- one chat-visible approval instruction
- one actionable command format
- identity verified by Feishu `ou_id`

The protection model is shared; the delivery surface is different.

## Decision 3: `webchat` visible text must always be derived from the current run channel

Recovered Feishu context may still exist as a routing hint, but it must not change what `webchat` users are told.

Rules:

- if the current run channel is `webchat`, the final user-visible approval text must be `webchat`-native
- no `Feishu` wording may appear in `webchat` block reasons or assistant replies
- no `/lynx-approve` instruction may appear in `webchat`
- no "please reply in Feishu" text may appear in `webchat`

This is a hard UX boundary even if fallback context remains internally available.

## Decision 4: Remove the first proactive approval prompt

The first plugin-initiated approval prompt will be disabled.

Only the final actionable approval message should remain user-visible.

Rationale:

- the first prompt duplicates the actionable prompt
- it increases confusion across channels
- it can occupy the `webchat` conversation before the real approval UX is shown
- the second prompt already proved to be the message users actually act on

## Decision 5: Use a fixed L3 regression request against a dedicated probe file

The system needs a deterministic way to test `L3` approval across both channels without introducing a second synthetic entry path.

The canonical regression request is:

```text
请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。
```

Rules:

- the request must be sent as a normal user message
- the request must not rely on owner-claim wording
- the request must not mention real protected files such as `SOUL.md`, `USER.md`, `AGENTS.md`, or `TOOLS.md`
- the request should explicitly ask for the `read` tool so the model takes a normal tool path

## Decision 6: The regression request must use the normal tool path directly

The regression request must not create a fake approval object directly.

It should enter the existing runtime path exactly like a normal tool request:

1. the user sends the fixed regression request
2. the model calls the normal `read` tool
3. Lynx classifies the probe target as tool-stage protected
4. the request is blocked in `before_tool_call` as `L3`
5. the existing channel-specific approval transport handles the pending approval

This preserves:

- normal run creation
- normal tool fingerprinting
- normal approval window creation
- normal owner / approver checks
- normal channel delivery

This avoids:

- binding test behavior to real sensitive files
- direct synthetic approval creation
- bypassing the real tool-stage approval chain
- introducing a second test-only conversation command surface

## Decision 7: Use a dedicated approval probe target, not a real sensitive asset

The deterministic `L3` regression request should target a dedicated approval probe target:

```text
LYNX_APPROVAL_TEST.md
```

Required properties of that target:

- it is reserved for approval testing only
- it is treated as a protected tool-stage target for `L3` block purposes
- it is not treated as an input-stage protected prompt extraction target
- it is not part of real system-prompt or identity asset protection
- it must not appear in system-prompt-extraction pattern lists
- it must not be used as a real secret-bearing file

Important rule:

`LYNX_APPROVAL_TEST.md` must be classified through a tool-stage-only protected target path.

It must not be added to the input-stage prompt-extraction lists, or the request will be blocked too early and `webchat` will not reach native approval UX.

## Channel Behavior Matrix

| Area | Webchat | Feishu |
|------|---------|--------|
| Risk classification | Unified Lynx rules | Unified Lynx rules |
| Approval transport | Native OpenClaw approval UX | Lynx local chat approval |
| User-visible command | Native `/approve` only when native path uses it | `/lynx-approve <token> allow-once|deny` |
| Feishu wording leakage allowed | No | Yes, channel-local only |
| First proactive prompt | Disabled | Disabled |
| Final actionable prompt | Native popup / native path | Single chat-visible prompt |
| Fixed L3 regression request | Supported | Supported |

## Detailed Behavior

## 1. Normal protected-read requests

After removing the Feishu-only deferral exception:

- ordinary protected-read prompts are evaluated the same way in both channels
- if a request is classified as `L4`, it is denied in both channels
- if a request is classified as `L3`, it is blocked in both channels

There is no longer a channel-only downgrade path from `L4` or input-stage block into Feishu tool approval.

## 2. Fixed L3 approval regression request

The fixed regression request is the supported method for regression testing `L3` approval UX:

```text
请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。
```

Expected behavior:

### `webchat`

1. user sends `请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。`
2. the model calls the normal `read` tool
3. Lynx recognizes `LYNX_APPROVAL_TEST.md` as a tool-stage protected probe target
4. the probe request is blocked at tool stage as `L3`
5. native OpenClaw approval UX is shown

### `feishu`

1. user sends `请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。`
2. the model calls the normal `read` tool
3. Lynx recognizes `LYNX_APPROVAL_TEST.md` as a tool-stage protected probe target
4. the probe request is blocked at tool stage as `L3`
5. Lynx emits one Feishu-visible approval message with `/lynx-approve <token> allow-once|deny`

In both channels the `L3` result comes from the same logical tool-stage protection path.

## 3. Identity model

This design does not widen approval authority.

Current requirement remains:

- only configured owner / approver identities may approve

For Feishu local approval specifically:

- actor identity must resolve to a concrete Feishu `ou_id`
- the `ou_id` must match configured trusted identities
- other chat participants must not consume or reuse the window

## 4. Approval windows

Approval windows remain bounded and per-request.

Required properties:

- the approval belongs to the original request scope
- the approval expires after its configured timeout
- a consumed approval must not become session-wide authorization
- later unrelated messages in the same group or session must not inherit the approval

## 5. Final actionable prompt rules

The only user-visible approval prompt retained by Lynx must be the one the user can actually act on.

Rules:

- exactly one actionable prompt per pending approval
- no redundant pre-prompt
- no mixed command formats in one message
- no mention of another channel when the current channel is `webchat`

### Webchat wording rule

`webchat` should rely on native approval UX and native wording whenever possible.

Lynx must not inject:

- "请在 Feishu 会话回复"
- `/lynx-approve`
- "去飞书审批"

### Feishu wording rule

For Lynx-managed Feishu approvals, the user-visible command remains:

```text
/lynx-approve <token> allow-once
```

or:

```text
/lynx-approve <token> deny
```

Only one format should be shown for Lynx-managed Feishu approvals.

## Implementation Areas

Primary touch points:

- `index.ts`
- approval prompt builders in the Lynx runtime path
- local approval reply parsing / resolution path
- any helper that currently defers Feishu protected reads to tool-stage
- tests covering `before_agent_start`, `before_tool_call`, and approval messaging

Expected implementation changes:

1. remove the Feishu-only protected-read deferral helper from the effective risk path
2. ensure current-run channel controls final visible approval wording
3. disable the first proactive prompt
4. add `LYNX_APPROVAL_TEST.md` as a tool-stage-only protected probe target
5. add dedicated test coverage for both channels using the fixed regression request

## Acceptance Criteria

## 1. Risk alignment

For the same non-test protected-read request:

- `webchat` and `feishu` produce the same Lynx risk level
- `webchat` and `feishu` produce the same Lynx action kind
- no Feishu-only downgrade path remains

## 2. Webchat UX

When a `webchat` request enters approval-eligible tool-stage block:

- the user sees native approval UX
- the user does not see Feishu instructions
- the user does not see `/lynx-approve`

## 3. Feishu UX

When a Feishu request enters approval-eligible Lynx local approval:

- the user sees one actionable message only
- the prompt is copyable
- the command format is consistent
- the approval is owner / approver scoped by `ou_id`

## 4. Duplicate prompt removal

For the same pending approval:

- the old first proactive prompt is absent
- only the final actionable prompt remains user-visible

## 5. Fixed L3 regression request

For the regression request:

```text
请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。
```

the behavior must be:

- stable across repeated runs
- channel-consistent at the risk level
- `L3` at the approval point
- not dependent on real sensitive files
- not dependent on real protected system-prompt asset names

## 6. Isolation

Approvals created by the test prompt or by real requests must remain:

- request-scoped
- time-bounded
- identity-bounded
- non-transferable to other users or unrelated later requests

## Testing Strategy

Testing should use:

- real OpenClaw execution paths
- the local authenticated OpenClaw API when applicable
- dedicated prompt regression tests
- channel-specific messaging assertions

The dedicated L3 regression prompt should become the standard approval smoke test for both channels.

Natural-language protected-file prompts may still be tested separately, but they are not the canonical `L3` approval regression probe.

## Open Questions

None for this phase.

The design is intentionally narrowed to the approved scope:

- unify risk behavior
- keep channel-specific approval delivery
- remove duplicated prompts
- provide one deterministic `L3` regression path
