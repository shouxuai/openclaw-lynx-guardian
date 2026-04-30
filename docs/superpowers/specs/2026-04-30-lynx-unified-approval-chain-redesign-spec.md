# Lynx Unified Approval And Chain Redesign Spec

## Scope

This spec covers the Lynx Guardian approval, temporary release, and multi-turn chain redesign discussed on 2026-04-30.

Applies to:

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`
- Lynx plugin runtime hooks under `src/hooks/`
- Lynx approval helpers under `src/approval/`
- Go local-console backend under `backend/`
- Local-console frontend under `frontend/`
- OpenClaw core approval surfaces under `D:\all-works\openclaw` only after the user explicitly expands edit scope

Current scope rule:

- Do not change `问答记录` in the first implementation pass.
- Do not prioritize plugin sync-path changes in this pass. The current runtime can run and be tested.
- Keep `D:\all-works\openclaw` as read-only reference until the user explicitly authorizes OpenClaw core edits.

## Problem Statement

The current product exposes three related but poorly separated concepts:

- `多轮链路`: a diagnostic correlation view.
- `链路授权` / Grant: a short-lived approval effect.
- `审批管理`: approval requests and decisions.

The runtime behavior and the pages do not yet make those concepts understandable or trustworthy:

- `多轮链路` does not show which user prompts or conversations it covers.
- `链路授权` sounds like a durable permission grant, but the intended behavior is only temporary release inside a narrow chain scope.
- `审批管理` and `链路授权` appear overlapping because the UI does not distinguish approval request from approval effect.
- Lynx plugin approval and OpenClaw exec approval can both appear, creating duplicate popups.
- After a system approval UI appears, the assistant can still output `/approve ... allow-once` instructions.
- Go backend chain grants are revoked on lifecycle end, but plugin in-memory grants are not cleared by the same lifecycle.
- Some dangerous operations do not use `exec`, so an exec-only approval strategy misses `read`, `write`, `edit`, `cron`, `gateway`, Feishu, and other tool categories.
- L4 input must not reach the model, but the UI must still preserve the original user input with a clear "not sent to model" explanation.

## Verified Runtime Facts

The 2026-04-30 runtime check found:

- Gateway is healthy at `http://127.0.0.1:18789/healthz`.
- Lynx is loaded in the current OpenClaw image and reports hook capability support.
- The new OpenClaw image loads the bundled plugin from `/app/dist/extensions/openclaw-lynx-guardian`, while the old host-mounted path is blocked as world-writable. This is not the first priority for this plan, but it affects future sync proof.
- `/lynx/chains` returns only chain summary fields such as `chainId`, `recentEvasions`, and grant/approval ids. It does not return covered prompts.
- `/lynx/qa-records/:id` already has user prompt nodes, tool-call nodes, audit nodes, and final-answer nodes.
- `/lynx/grants` and `/lynx/approvals` were empty during the observed approval test even though the QA detail showed `before_tool_call` enforcement as `requireApproval`.
- `src/approval/approval-bridge.ts` keeps `approvalGrantsBySource` in memory and prunes primarily by expiry.
- `backend/internal/chain/service.go` revokes Go grants on lifecycle end through `agent_end`, `session_end`, `subagent_ended`, and `chain_complete`.
- OpenClaw core `PluginHookBeforeToolCallResult` currently supports `params`, `block`, `blockReason`, and `requireApproval`; it does not expose a field for "append this Lynx risk note to the native exec approval card."

## Goals

1. Give users one clear approval experience per risky operation.
2. Keep OpenClaw native exec approval as the actual "execute this command?" authority.
3. Add Lynx risk context to the same system approval surface where possible.
4. Use system plugin/generic approval for risky non-exec tools.
5. Treat L4 as hard deny, not approvable.
6. Make temporary release narrow, explainable, and revoked by lifecycle.
7. Make `多轮链路` show which prompts and operations a chain covers.
8. Rename `链路授权` to a user-understandable "临时放行" concept.
9. Preserve original blocked L4 input in audit/UI while keeping it out of model context.

## Non-Goals

- Do not make `问答记录` a raw audit/governance page.
- Do not delete advanced pages.
- Do not make grant/release durable across independent conversations.
- Do not allow L4 by approval.
- Do not hide original user input from local audit UI.
- Do not rely on free-text confirmation phrases such as `确认放行本次操作`.
- Do not add decorative redesign unrelated to the approval and chain clarity problem.

## Terminology

Use these terms in UI and code comments:

- `审批`: the request and decision event. It answers "can this operation proceed?"
- `临时放行`: the short-lived effect created after an approval. It answers "which same-scope operations can skip repeated approval?"
- `链路`: a diagnostic correlation scope for a user interaction flow. It answers "which prompts, tools, risks, approvals, and releases were related?"
- `硬拒绝`: a non-approvable safety boundary.

Avoid user-facing:

- `Grant`
- `链路授权`
- `交互审计` as a replacement for `问答记录`

## Approval Surface Design

### L4 Hard Deny

L4 requests are never approvable.

Examples:

- Disable or bypass Lynx Guardian.
- Mutate plugin security configuration.
- Stop/restart OpenClaw or Lynx when framed as bypass.
- Read credential stores or core sensitive files.
- Concealed or obfuscated bypass intent.

Behavior:

- Block before model context.
- Store original input in local audit/QA/chain data.
- Store a sanitized refusal context for the model.
- Show UI label: `已拦截，未发送给模型`.
- Do not create approval request.
- Do not create temporary release.

### Exec L2/L3 Risk

Exec remains governed by OpenClaw native exec approval.

Target behavior:

- Lynx classifies the risk in `before_tool_call`.
- Lynx does not return its own `requireApproval` for exec when the OpenClaw native exec approval route is available.
- Lynx returns an approval annotation for the exec approval card.
- OpenClaw exec approval card shows command details plus Lynx risk context.
- After approval, OpenClaw executes the command and Lynx creates a temporary release scoped to that command/risk/resource.

Required OpenClaw core extension:

`before_tool_call` needs a non-blocking approval annotation result, for example:

```ts
type PluginApprovalContext = {
  title?: string;
  description: string;
  severity?: "info" | "warning" | "critical";
  sourcePluginId?: string;
};
```

The native exec approval builder should include this context in `warningText` or an equivalent card field.

If OpenClaw core changes are not yet authorized:

- Lynx can still stop duplicate plugin approval by suppressing plugin-side `requireApproval` for exec where native exec approval is available.
- The exec card will not show Lynx context until the OpenClaw core extension lands.
- This limitation must be reported honestly in verification notes.

### Non-Exec L2/L3 Risk

Risky non-exec tools must not depend on exec approval.

Examples:

- `read` of sensitive paths.
- `write` or `edit` to critical config, hook, skill, or plugin files.
- `cron` creation or mutation.
- `gateway` control operations.
- Feishu document or drive operations that can expose sensitive data.

Behavior:

- L2 can warn or require approval according to policy.
- L3 requires system plugin/generic approval.
- Use one system approval surface, not a separate chat prompt plus a system prompt.
- If no system approval route is available, fail closed for L3 with a clear reason.
- After approval, create a temporary release scoped to the specific tool and target/resource.

## Temporary Release Model

Temporary release replaces the user-facing idea of `链路授权`.

Scope key fields:

- chain id
- session key
- run id when available
- requester identity
- approver identity when available
- tool name
- risk family/module
- maximum approved risk level
- target/resource fingerprint
- source approval id
- creation time
- expiry time

Reuse is allowed only when all are true:

- Same chain/session scope.
- Same requester.
- Same tool.
- Same risk family/module.
- Current risk is same or lower than the approved maximum.
- Target/resource is identical or narrower.
- The temporary release has not expired.
- The chain has not ended.

Reuse is denied and the release is revoked when any are true:

- Risk escalates.
- Module changes.
- Tool changes.
- Target/resource expands.
- Requester changes.
- L4 appears.
- `agent_end`, `session_end`, `subagent_ended`, or `chain_complete` fires.

The plugin runtime and Go control plane must agree on revocation.

## UI Design

### Navigation

- Keep `问答记录` as the primary user-facing entry.
- Keep `多轮链路` under advanced diagnostics.
- Rename `链路授权` to `临时放行`.
- Keep `审批管理` under governance.

### 多轮链路

Purpose:

- Explain what a chain covers.

Required list fields:

- chain id
- latest prompt excerpt
- prompt count
- highest risk
- recent tools
- approval count
- temporary release count
- status

Required detail fields:

- covered user prompts in chronological order
- risk timeline
- tool calls
- approval requests
- temporary releases
- revocation events
- final status

The first useful question the page must answer:

> 这条链路覆盖了哪些输入词/对话？

### 临时放行

Purpose:

- Show active and revoked temporary releases.

Required fields:

- release id
- status
- requester
- approver
- tool
- risk module
- target/resource summary
- source approval
- expiry
- revocation reason

Copy rule:

- Explain that this is a short-lived release inside the current chain, not durable authorization.

### 审批管理

Purpose:

- Show approval requests, decisions, and actors.

Required fields:

- approval id
- request summary
- requester
- approver
- risk
- tool
- status
- requested/resolved time
- linked temporary release when created

Boundary:

- Do not duplicate release scope details in the main table. Put release scope in detail.

## L4 Input Preservation

When L4 blocks before model context:

- Store original user input in the local audit/QA data model.
- Store sanitized model-facing refusal context separately.
- Do not overwrite `userPromptExcerpt` with the Lynx refusal prompt.
- Add explicit metadata:

```json
{
  "modelInputPolicy": "removed",
  "uiInputPolicy": "preserved",
  "blockedBeforeModel": true
}
```

UI display:

- Show original prompt in detail.
- Show label: `已拦截，未发送给模型`.
- Show module and reason.

## Old Confirmation Cleanup

The old free-text confirmation phrase is deprecated and should not be part of the main approval path.

Required cleanup:

- Remove user-facing prompts that tell users to reply `确认放行本次操作`.
- Keep compatibility parser only if existing tests require legacy input.
- Do not show `/approve ... allow-once` after a native approval card has already been shown.
- Only show `/approve` instructions when native/system approval UI is unavailable and manual approval is explicitly the configured fallback.

## Mobile Layout

The advanced pages are currently hidden below a full-height sidebar on mobile.

Required behavior:

- Mobile sidebar must collapse behind a menu button.
- Page content must start in the first viewport.
- Tables can use horizontal scroll, but the page header and primary content must be visible without scrolling past the entire nav.

## Testing Strategy

Use focused tests first:

- Plugin routing tests for exec vs non-exec vs L4.
- Plugin grant lifecycle tests for in-memory grant revocation.
- Backend grant contract tests for lifecycle revocation and scope mismatch.
- Backend chain detail tests that include covered prompts.
- Frontend page tests for `多轮链路` prompt visibility and `临时放行` naming.
- Frontend responsive tests or Playwright screenshot checks for mobile layout.
- Runtime validation through real OpenClaw path after sync.

Do not rely on broad Vitest as the only green gate because this repo has known historical test collection issues.

## Acceptance Criteria

- A risky exec command produces one system approval experience.
- The exec approval surface can show Lynx risk context after the OpenClaw core annotation support lands.
- A risky non-exec tool produces one system plugin/generic approval experience.
- L4 produces no approval prompt and no release.
- After approval, same-scope operations do not trigger dozens of repeated prompts.
- Scope expansion or risk escalation requires re-evaluation.
- Chain lifecycle end clears both Go and plugin-memory releases.
- L4 original input is visible in UI with `未发送给模型` labeling.
- `多轮链路` displays covered user prompts.
- `链路授权` is no longer user-facing; the page reads as `临时放行`.
- Mobile advanced pages show content in the first viewport.

