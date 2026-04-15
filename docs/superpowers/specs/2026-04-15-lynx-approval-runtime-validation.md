# Lynx Approval Runtime Validation Addendum

Date: 2026-04-15
Status: validated against current local OpenClaw runtime

## Scope

This addendum records runtime facts discovered after the native-approval migration work had already been specified in the main design doc and plan.

It exists because the current OpenClaw runtime behavior around plugin approvals and chat `/approve` does not fully match the simplifying assumption of "native approval implies chat fallback approval."

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

## Newly Confirmed Runtime Gap

- Current OpenClaw chat `/approve` handling is still wired to `exec.approval.resolve`.
- Current OpenClaw chat `/approve` is not automatically routed to `plugin.approval.resolve`.
- Therefore, plugin-native approvals and exec approvals are still different runtime control-plane paths on the current build.

## Evidence

- Source inspection in the current OpenClaw runtime shows the `/approve` command handler calling `exec.approval.resolve`.
- Fresh gateway logs after sync still show `plugin.approval.waitDecision` for Lynx-triggered risky tool calls.
- Fresh runtime attempts confirmed that plugin approval suspension is alive, but chat-side `/approve` did not provide a reliable plugin-approval resolution path on the current build.

## Design Consequence

- The Lynx plugin must not claim that "native plugin approval already supports chat `/approve` fallback" unless OpenClaw core adds that routing.
- For channels with Control UI or native approval buttons, native plugin approval remains the preferred path.
- For Feishu or chat-only channels, one of these must be chosen explicitly:
  - OpenClaw core enhancement so chat `/approve` can resolve plugin approvals
  - a Lynx-local fallback approval transport that is intentionally separate from native `/approve`

## Recommendation

- Keep the plugin migration centered on native plugin approval plus run-bound grants.
- Treat chat `/approve` compatibility for plugin approvals as cross-repo follow-up work.
- Do not reintroduce free-text "同意后重试" just to hide the platform gap.
