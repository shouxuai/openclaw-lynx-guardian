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

The 2026-05-01 latest-code and browser check found:

- `npx tsc --noEmit --pretty false`, frontend `npx tsc --noEmit --pretty false`, focused approval tests, focused Go grant/chain tests, and focused frontend page tests passed before this spec update.
- `http://127.0.0.1:4173/webview/chains` and `/webview/grants` rendered without page errors or console errors.
- Mobile layout is still functionally wrong: at `390x844`, the sidebar consumes about `950px` height, the topbar starts around `y=950`, and the page content starts around `y=998`, so the actual page content is outside the first viewport.
- Advanced-page metric cards remain too large for this diagnostic role: desktop cards are about `274x136`, and mobile cards are about `358x136`.
- `GET http://127.0.0.1:4173/lynx/chains` returns chain summaries without covered prompts, so `多轮链路` still cannot answer which inputs/conversations it covers.
- `GET http://127.0.0.1:4173/lynx/grants` can be empty while `GET http://127.0.0.1:4173/lynx/approvals` returns approval records. This confirms that `临时放行` must be explained as an approval effect after approval, not as the approval queue itself.
- The latest local OpenClaw repo at `D:\all-works\openclaw` still has no `approvalContext` field in `PluginHookBeforeToolCallResult`.
- Current Lynx plugin code still has risky tool paths that return plugin-side `requireApproval`; no `resolveToolApprovalSurface` split is present yet.

## Goals

1. Make the advanced pages understandable before deep mechanism work: users must see what a chain covers and what a temporary release means.
2. Make `多轮链路` show which prompts, conversations, risks, tools, and approvals a chain covers.
3. Rename `链路授权` to the user-understandable `临时放行` concept and explain that it is an approval effect, not an approval queue.
4. Fix mobile/card layout so the two pages are usable in the browser before runtime behavior is claimed.
5. Give users one clear approval experience per risky operation.
6. Keep OpenClaw native exec approval as the actual "execute this command?" authority.
7. Add Lynx risk context to the same system approval surface where possible.
8. Use system plugin/generic approval for risky non-exec tools.
9. Treat L4 as hard deny, not approvable.
10. Make temporary release narrow, explainable, and revoked by lifecycle.
11. Preserve original blocked L4 input in audit/UI while keeping it out of model context.

## Implementation Priority

Use this order unless a later code check proves a dependency has changed:

### Phase A: Page And Data Comprehension

- Do not touch `问答记录`.
- Make `多轮链路` answer the first user question: "这条链路覆盖了哪些输入词/对话？"
- Add covered-prompt data to the chain API instead of making the frontend infer it from unrelated pages.
- Rename `链路授权` to `临时放行` and make the empty state explain that no release exists until an approval creates one.
- Fix mobile layout and shrink advanced-page metric cards.

### Phase B: Temporary Release Scope And Lifecycle

- Scope plugin memory grants by session, run/chain, requester, tool, risk module, and target fingerprint.
- Revoke plugin memory grants on `agent_end`, `session_end`, `subagent_ended`, and `chain_complete`, matching the Go-side lifecycle contract.

### Phase C: Approval Popup De-Dup And Routing

- Split exec from non-exec approval routing in Lynx.
- For exec, suppress duplicate Lynx plugin approval where native OpenClaw exec approval is available.
- For non-exec L3, keep one system/plugin approval route or fail closed when no route exists.
- Remove user-facing old free-text confirmation prompts and avoid `/approve ... allow-once` output after a system approval UI has already appeared.

### Phase D: OpenClaw Core Approval Context

- This remains gated by explicit user approval because it edits `D:\all-works\openclaw`.
- Until OpenClaw core exposes and renders `approvalContext`, plugin-only work can reduce duplicate popups but cannot honestly show Lynx risk text inside the native exec approval card.

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
- run id
- requester identity
- approver identity when available
- tool name
- risk family/module
- maximum approved risk level
- target/resource fingerprint
- source approval id
- creation time
- expiry time

Plugin in-memory grants must not stay at only `source + module + risk`. The minimum matching key for the current plugin runtime is:

- `sessionKey`
- `runId` when available
- `chainId` when available
- `requesterOuId` or equivalent requester identity
- `toolName`
- `module`
- `maxRiskLevel`
- `targetFingerprint` or another deterministic resource fingerprint
- `sourceApprovalId`

Reuse is allowed only when all are true:

- Same chain/session scope.
- Same run scope when both sides have a run id.
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

If the current system has no actual release rows yet, the `临时放行` page must show an empty state that says no temporary release has been created after approval yet. It must not imply that the user can grant permissions directly from this page.

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

- Show active and revoked temporary releases created after an approval decision.
- Explain what approval effects are still active, what expired, and why something was revoked.
- Make clear that this page is not where the user approves requests.

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
- Empty state copy must say that no approval has created a temporary release yet.
- Link or cross-reference `审批管理` only as the place to inspect approval requests and decisions.

Suggested empty state copy:

```text
暂无临时放行
审批通过后，如果某个操作只在当前链路、当前工具和相同资源范围内短期放行，会出现在这里。审批请求和处理记录请到审批管理查看。
```

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
- `审批管理` answers "which request was approved or rejected?"
- `临时放行` answers "what exact follow-up operations are temporarily allowed because of that approval?"

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
- At `390x844`, content must begin above `y=160`; it must not be pushed below a `950px` sidebar.
- Advanced-page metric cards should be compact diagnostic summaries, not hero cards. Target card height is `<= 96px` on desktop and `<= 110px` on mobile unless an existing design token forces a slightly larger value.

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
- `临时放行` empty state distinguishes release effects from approval requests.
- Mobile advanced pages show content in the first viewport, with content starting above `y=160` at `390x844`.
- Advanced-page metric cards are compact: target height `<= 96px` on desktop and `<= 110px` on mobile.
