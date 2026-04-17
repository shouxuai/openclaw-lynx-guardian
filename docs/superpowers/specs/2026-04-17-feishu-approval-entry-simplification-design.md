# Feishu-Only Local Approval Retry Design

## Scope

This design applies only to Lynx-managed approval behavior on the `feishu` channel.

It does not change:

- OpenClaw core approval behavior
- `webchat` native approval behavior
- risk recognition, evidence collection, or guard/policy scoring
- `L4` instant deny behavior
- non-tool deny behavior in `before_agent_start` or `before_message_write`

## Goal

Make Feishu approval usable inside Feishu chat without modifying OpenClaw core.

The Feishu path must support this user experience:

1. a Feishu request triggers an approval-eligible tool block
2. Lynx sends a Feishu-visible approval prompt in the same conversation
3. the owner replies with a Feishu command
4. Lynx validates `ou_id`, token, window, and request match
5. Lynx grants a short-lived one-time retry permission
6. the original requester resends the same request
7. Lynx consumes the grant and allows the tool call

This design explicitly does not try to resume the previously blocked tool call inline.

## Problem Statement

The previous Feishu approval attempts mixed multiple incompatible models:

- OpenClaw native `/approve`
- Lynx local `/lynx-approve`
- run-bound pending approval waiting
- attempts to continue the already blocked tool call
- delivery through hook-provided shared sender paths that are not reliable in the Feishu tool-approval path

That produced repeated failures:

- approval prompts were not reliably delivered to Feishu
- the original run stayed blocked or timed out
- approval replies could not reliably continue the blocked tool call
- user-facing instructions became inconsistent

The design must be reduced to one Feishu-only local approval model with one command format and one retry story.

## Key Decision

For Feishu tool approvals, Lynx uses a plugin-local approval flow only.

The approved action is not "continue the blocked run".

The approved action is:

- issue a short-lived one-time grant tied to the original requester, source, and request fingerprint
- require the requester to resend the original request
- consume that grant on the retried request

This removes queue blocking, removes the need to reconnect the blocked tool call, and matches the real constraints of a plugin-only implementation.

## Channel Split

### Webchat

Unchanged.

- keep native OpenClaw approval behavior
- keep existing `/approve <id> allow-once|deny` behavior
- keep existing run-bound continuation semantics

### Feishu

Use Lynx local approval only.

- do not use native OpenClaw `/approve` for Lynx-managed Feishu tool approvals
- do not wait for approval on the blocked run
- do not promise that the blocked tool call will continue automatically
- use only:
  - `/lynx-approve <token> allow-once`
  - `/lynx-approve <token> deny`

### Other channels

Out of scope for this phase.

## Approval Eligibility

Feishu local approval applies only to tool-stage requests that are policy-approved for escalation.

Typical case:

- tool-stage `L2` or `L3`
- action is `block`
- policy marks the event as approval-eligible

Not eligible:

- `L4`
- strong-intent instant deny paths
- non-tool deny paths already rejected earlier in the lifecycle

## Identity Model

Only configured owner `ou_id` values may approve a Feishu local approval.

Rules:

- approval replies must come from Feishu and expose a concrete `ou_id`
- actor `ou_id` must exactly match a configured trusted owner `ou_id`
- requester identity alone never grants approval power
- messages from other users must never consume, reuse, or benefit from another person's approval window

This phase supports owner-only approval. Separate approver allowlists are out of scope.

## Hook Responsibilities

### `message_received` / `before_dispatch`

Feishu approval replies are recognized here before normal conversation handling.

Responsibilities:

- detect `/lynx-approve <token> allow-once|deny`
- extract actor `ou_id`
- resolve the pending approval
- reject unauthorized or malformed approval replies
- persist a retry grant on success
- reply with a short Feishu-visible result message

### `before_agent_start`

Do not start local approval here.

Responsibilities:

- classify source as Feishu early
- record requester provenance
- save approval context seed for later tool-stage use
- keep existing guard behavior for non-tool paths

### `before_tool_call`

This is the only place where Feishu local tool approval is created.

Responsibilities:

1. evaluate the tool risk decision
2. check whether a matching retry grant exists
3. if a grant exists, allow the tool call and consume it
4. if no grant exists, create or reuse a pending approval
5. send the approval prompt to the current Feishu conversation
6. immediately return an approval-pending result

The blocked tool call ends there. It is not resumed later.

## State Model

### Pending Approval

Represents a live approval request waiting for owner action.

Required fields:

- `approvalToken`
- `channelProfile = "feishu"`
- `channelId`
- `accountId`
- `conversationId`
- `requesterOuId`
- `module`
- `toolName`
- `riskLevel`
- `requestFingerprint`
- `approverOuIds`
- `createdAt`
- `expiresAt`
- `status`

### Approval Grant

Represents a one-time retry permission created after successful approval.

Required fields:

- `channelProfile = "feishu"`
- `channelId`
- `accountId`
- `conversationId`
- `requesterOuId`
- `module`
- `maxRiskLevel`
- `requestFingerprint`
- `grantedByOuId`
- `createdAt`
- `expiresAt`
- `remainingUses = 1`

### Run Continuation Window

Represents a short-lived post-grant continuation allowance inside the newly retried run.

Required fields:

- `runId`
- `channelProfile = "feishu"`
- `requesterOuId`
- `module`
- `maxRiskLevel`
- `createdAt`
- `expiresAt`

This exists only after a retry grant is consumed successfully.

## Request Fingerprint

Approval must not be granted only by `ou_id`, `module`, or conversation.

Each approval request and grant must include a deterministic `requestFingerprint`.

Recommended fingerprint inputs:

- `channelProfile`
- `accountId`
- `conversationId`
- `requesterOuId`
- normalized user prompt text
- `toolName`
- protected target summary
- `module`

Required behavior:

- approval success authorizes only the same logical request
- a different prompt or different protected target does not reuse the grant
- retries from another user or another conversation do not match

## Pending Approval Dedup

Repeated Feishu requests should not create endless duplicate approval windows if the same request is already pending.

Recommended dedup key:

- `channelProfile`
- `channelId`
- `accountId`
- `conversationId`
- `requesterOuId`
- `module`
- `requestFingerprint`

If the same request is already pending:

- reuse the existing token
- resend the same approval prompt if needed
- do not create a second competing approval record

If a materially higher risk replaces an existing pending approval:

- replace the lower-risk approval window with the higher-risk one

## Grant Matching Rules

A retry grant matches only when all of the following are true:

- same `channelProfile`
- same `channelId`
- same `accountId`
- same `conversationId`
- same `requesterOuId`
- same `module`
- same `requestFingerprint`
- current risk is the same level or lower than `maxRiskLevel`
- grant is still within TTL
- grant still has remaining uses

If matched:

- consume the grant
- allow the tool call
- create a run continuation window for follow-up tool calls in the same run

## Chain Continuation Rules

The one-time grant does not authorize arbitrary future behavior.

It authorizes only entry into the retried request.

After that request consumes the grant, Lynx may allow follow-up tool calls in the same run only when all of the following are true:

- same run
- same module
- same or lower risk level
- within the continuation TTL

If the run enters:

- a different module
- a higher risk level
- a new protected dimension outside the approved scope

then Lynx must trigger a new approval.

## User Flow

### Initial request

1. requester sends a Feishu message
2. model reaches a tool call
3. `before_tool_call` detects an approval-eligible `L2` or `L3` risk
4. Lynx checks for a matching retry grant
5. if no grant exists, Lynx creates or reuses a pending approval
6. Lynx sends an approval prompt into the same Feishu conversation
7. Lynx immediately blocks the current tool call with an approval-pending result

### Approval reply

1. owner replies in Feishu with `/lynx-approve <token> allow-once` or `deny`
2. Lynx intercepts that message before normal conversation handling
3. Lynx validates actor `ou_id`, token, status, TTL, and source
4. if valid and approved, Lynx creates a retry grant
5. Lynx replies that approval succeeded and the requester should resend the request

### Retry

1. requester resends the same request in the same Feishu conversation
2. `before_tool_call` computes the same request fingerprint
3. Lynx matches and consumes the retry grant
4. the tool call is allowed
5. a run continuation window is created for same-module, same-or-lower-risk follow-up calls

## Feishu Prompt Format

There is exactly one approval command family for this flow:

- `/lynx-approve <token> allow-once`
- `/lynx-approve <token> deny`

Recommended approval prompt:

```text
[Lynx Guardian] 操作需要审批
工具: read
模块: M2:protected_file_access
风险: L3

请由 owner 在当前飞书会话回复以下命令之一：
/lynx-approve <token> allow-once
/lynx-approve <token> deny

审批通过后，请原请求人重发刚才那条请求。
```

Recommended success reply:

```text
[Lynx Guardian] 已批准本次操作。
请原请求人在当前飞书会话重发刚才的请求。
```

Recommended unauthorized reply:

```text
[Lynx Guardian] 当前 ou_id 无审批权限。
```

Recommended invalid token reply:

```text
[Lynx Guardian] 审批 token 无效或已过期。
```

No Feishu-local prompt may advertise `/approve`.

## Time Windows

Recommended defaults:

- pending approval TTL: `5 minutes`
- retry grant TTL: `2 minutes`
- run continuation TTL: `2 minutes` or the natural run lifetime, whichever is shorter

Required behavior:

- expired pending approvals cannot be approved
- expired retry grants cannot be consumed
- expired continuation windows cannot authorize follow-up calls

## Delivery Requirement

Feishu local approval is only valid if the prompt can actually be delivered to Feishu chat.

This design therefore requires a Feishu-specific outbound delivery path owned by Lynx for local approval prompts.

The design must not rely on:

- `webchat` UI visibility
- OpenClaw native approval popup behavior
- blocked-run continuation
- unreliable hook-local sender availability in the Feishu tool-approval path

If prompt delivery fails:

- discard the pending approval
- reject the tool call
- return a clear Feishu-oriented failure result

## Cleanup

The following old or mixed behaviors should be removed rather than preserved:

- any Feishu path that attempts to reconnect or continue the previously blocked tool call
- any Feishu local approval path that waits on the blocked run
- any Feishu prompt that tells the user to use `/approve`
- any compatibility logic that treats `/approve` as a Lynx-local approval command
- any fallback wording that tells Feishu users to switch to webchat for this local approval path
- any stale "continue previous tool call after approval" expectations in comments, prompts, or return messages

This is intentional cleanup, not temporary disablement.

## Non-Goals

This design does not:

- modify OpenClaw core
- modify the Feishu plugin in `D:\all-works\openclaw`
- change guard evidence collection or policy semantics
- change `webchat` approval behavior
- change `L4` instant deny behavior
- implement multi-approver management
- implement group-session isolation beyond request-scoped matching and owner-only approval

## Acceptance Criteria

Minimum proof for implementation:

1. a Feishu DM that hits an approval-eligible tool-stage `L3` block receives a visible Feishu approval prompt
2. that prompt shows only `/lynx-approve <token> allow-once|deny`
3. only owner `ou_id` can approve successfully
4. approval success creates a retry grant, not a blocked-run continuation
5. the original requester can resend the same request and consume the grant
6. the retried run can continue only for same-module, same-or-lower-risk follow-up calls
7. higher-risk or different-module follow-up calls require a new approval
8. `L4` requests still deny immediately
9. `webchat` native approval behavior remains unchanged
