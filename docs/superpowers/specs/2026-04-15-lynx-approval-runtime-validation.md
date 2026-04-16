# Lynx Approval Runtime Validation Addendum

Date: 2026-04-15
Status: validated against current local source, tests, and previously observed runtime behavior

## Scope

This addendum records runtime facts discovered after the native-approval migration work had already been specified in the main design doc and plan.

It exists because the current OpenClaw approval story now has a meaningful split between:

- what the current source tree supports
- what the checked-in `dist/` bundles still appear to support

## Confirmed Working

- Lynx tool blocks now enter OpenClaw native plugin approval flow through `requireApproval`.
- Real gateway logs show `plugin.approval.waitDecision`, which confirms the tool call is suspended in native approval rather than being converted into a Lynx free-text retry prompt.
- Plugin-side same-run approval reuse is implemented for:
  - same `runId`
  - same requester identity
  - same module
  - same or lower risk
- Focused local tests pass for requester provenance, run binding, approval grants, config normalization, native tool approval, and non-tool direct rejection.
- A previous real API E2E run in this workstream already proved that `plugin.approval.resolve` can resume the original blocked request without asking the user to resend the prompt.

## Newly Confirmed Source And Runtime Split

- Current OpenClaw source now contains plugin-aware chat `/approve` routing in `src/auto-reply/reply/commands-approve.ts`.
- Focused source-level tests now pass for plugin approval command routing.
- The checked-in OpenClaw `dist/` bundles still contain older exec-only `/approve` behavior.
- Therefore, current behavior depends on which artifact the running gateway actually uses:
  - rebuilt source/runtime: chat `/approve` can resolve plugin approvals
  - stale bundled `dist` runtime: chat `/approve` still behaves as exec-only

## Evidence

- Source inspection in `D:\all-works\openclaw\src\auto-reply\reply\commands-approve.ts` now shows:
  - direct `plugin.approval.resolve` routing for `plugin:` IDs
  - plugin fallback for legacy unprefixed approval IDs
- Focused native tests passed:
  - `npx vitest run src/auto-reply/reply/commands.test.ts -t "plugin approval|approve"`
- Fresh gateway logs after prior sync still showed `plugin.approval.waitDecision` for Lynx-triggered risky tool calls.
- `D:\all-works\openclaw\dist\pi-embedded-*.js` still contains exec-only `handleApproveCommand` logic, which matches the earlier runtime symptom.

## Design Consequence

- The Lynx plugin must not claim a single approval story without distinguishing source state from shipped runtime state.
- For channels with Control UI or native approval buttons, native plugin approval remains the preferred path.
- For chat-only channels, the right conclusion is now:
  - OpenClaw core source already has the right `/approve` direction
  - but deployment must rebuild and ship that source, otherwise the old exec-only behavior persists
- Feishu convenience still needs a second layer beyond text `/approve`:
  - owner/approver-aware channel-native entry such as a card button
  - or a clearly surfaced exact `/approve <id> allow-once|allow-always|deny` fallback when cards are unavailable

## Recommendation

- Keep the plugin migration centered on native plugin approval plus run-bound grants.
- Treat OpenClaw core deployment parity as a blocking prerequisite for claiming plugin `/approve` support on Feishu/chat surfaces.
- Add a channel-specific approval entry spec for Feishu rather than reintroducing Lynx-local free-text retry UX.
- Do not reintroduce free-text approval phrases like `agree` or `agree-then-retry` just to hide the platform gap.
