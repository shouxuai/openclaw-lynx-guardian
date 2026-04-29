# Plugin Approval Compatibility Design

## Scope

This design applies only to the Lynx Guardian plugin in:

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian`

It does not modify:

- OpenClaw core code in `D:\all-works\openclaw`
- Lynx risk recognition, evidence collection, or guard/policy semantics
- `L4` instant deny behavior
- non-tool deny behavior in `before_agent_start` or `before_message_write`
- existing Feishu `ou_id` authorization rules

This design covers:

- when Lynx should trust OpenClaw native plugin approval
- how Lynx should degrade on older OpenClaw versions
- what happens when no Feishu approval channel is available
- how to isolate almost all compatibility logic into a removable runtime adapter

## Goal

Keep the code changes small while making approval behavior predictable across old and new OpenClaw versions.

The target outcome is:

1. OpenClaw `2026.3.28` and newer keep using native plugin approval on `webchat`
2. Feishu keeps using the existing Lynx local chat approval path with `ou_id` checks
3. runtimes before `2026.3.28` or unknown runtimes do not pretend native plugin approval exists
4. legacy fallback reuses the existing Lynx Feishu manual approval flow instead of inventing a new approval model
5. when no safe approval route exists, Lynx fails closed with a clear message instead of hanging or silently dropping the approval
6. the compatibility decision is concentrated in one new file so it can be removed later with minimal churn

## Non-Goals

This phase does not:

- redesign the current Lynx local Feishu approval command format
- convert Feishu to OpenClaw-native plugin approval
- add a new approval UI
- add a new approver-list model
- change the meaning of approval grants, grant windows, or request fingerprints
- modify OpenClaw's `/approve` core behavior

## Background: OpenClaw Approval Timeline

The relevant OpenClaw milestones are:

### 1. Native plugin approval first shipped in a formal release

OpenClaw `2026.3.28` introduced async `requireApproval` for `before_tool_call` hooks.

Evidence:

- `CHANGELOG.md` documents:
  - `Plugins/hooks: add async requireApproval to before_tool_call hooks ... /approve command now handles both exec and plugin approvals with automatic fallback. (#55339)`
- `docs/plugins/building-plugins.md` documents:
  - `before_tool_call: { requireApproval: true } pauses agent execution and prompts the user for approval ...`

This is the first formal release boundary for plugin approval support.

### 2. Chat `/approve` fallback for plugin approvals was refined later

`2026.3.31-beta.1` added a plugin approval short-id / fallback improvement:

- `Plugin approvals: accept unique short approval-id prefixes on plugin.approval.resolve, matching exec approvals and restoring /approve fallback flows on chat approval surfaces.`

This is useful history, but it is a beta milestone, not the first formal release boundary.

### 3. Native approval runtime wiring stabilized later

`2026.4.7` centralized native approval lifecycle assembly:

- `Approvals/runtime: move native approval lifecycle assembly into shared core bootstrap/runtime seams driven by channel capabilities and runtime contexts, and remove the legacy bundled approval fallback wiring.`

This is useful history about later stabilization, but it is no longer the Lynx compatibility boundary for this phase.

## Key Design Decision

Lynx should distinguish between two different version meanings:

- the version where plugin approval first formally exists, and which Lynx uses as the compatibility boundary in this phase
- later approval-runtime refinements that explain history but do not create extra Lynx routing tiers here

### Compatibility boundary

- `2026.3.28`

### Later historical refinements

- `2026.3.31-beta.1`
- `2026.4.7`

Rationale:

- `2026.3.28` is the correct answer to "when did OpenClaw formally introduce this"
- for this compatibility pass, once the runtime reaches `2026.3.28`, Lynx should continue on the newer-version path instead of keeping a second tighter trust boundary
- `2026.3.31-beta.1` and `2026.4.7` remain useful historical milestones, but they are not separate behavior gates in this design

This keeps the history accurate while avoiding an unnecessarily tight version split inside Lynx.

## Compatibility Strategy

## Decision 1: Keep the existing channel split

Lynx should keep the current channel intent split:

- `webchat` prefers native plugin approval when the runtime is capable enough
- `feishu` keeps the existing Lynx local manual approval path
- other channels stay out of scope for this compatibility pass

This is the smallest-change approach because the current Lynx implementation is already structured around that split.

## Decision 2: Add one explicit approval compatibility adapter

Add one new runtime helper file, for example:

- `src/runtime/plugin-approval-compat.ts`

That file owns:

- OpenClaw version threshold constants
- runtime version evaluation
- a single strategy decision for the current request

Example output shape:

```ts
type PluginApprovalCompatMode =
  | "native-webchat"
  | "feishu-local"
  | "deny-no-route";
```

The adapter should answer:

- should this request use native plugin approval
- should this request use Feishu local approval
- should this request fail closed because no safe approval route exists

No guard logic moves into this file. It is transport-only.

## Decision 3: Reuse the existing Feishu local approval implementation

Do not redesign the existing Feishu local approval machinery in this phase.

Reuse the current Lynx pieces:

- local approval token storage
- Feishu `ou_id` actor validation
- request fingerprint checks
- grant-window behavior
- pending approval dedup
- manual `/lynx-approve <token> allow-once|deny` resolution

This avoids spreading compatibility work across multiple files.

## Decision 4: Pre-`2026.3.28` runtimes must be handled conservatively

If the runtime is below the plugin-approval introduction boundary, Lynx must not emit `requireApproval` for `webchat` and then hope the UI can handle it by default.

Instead it must degrade deliberately:

- if a Feishu manual approval route is available, use that route
- if no Feishu manual approval route is available, deny with a clear explanation

This prevents:

- approval popups that never render
- blocked runs waiting on an approval surface the user cannot see
- fake "approval pending" states that can never resolve

This rule applies to:

- runtimes below `2026.3.28`, where plugin approval does not exist yet
- unknown runtimes

## Decision 5: If no Feishu integration exists, legacy fallback is a safe deny

If the deployment has no usable Feishu approval channel, then the conservative pre-`2026.3.28` fallback has nowhere safe to go.

Required behavior:

- do not queue a pending manual approval that nobody can answer
- do not wait for a timeout if no route can ever deliver the prompt
- do not suggest a non-existent approval surface
- return a direct deny reason that explains:
  - the current runtime is below `2026.3.28` or could not be classified safely
  - no Feishu manual approval route is configured or available
  - therefore this operation cannot be approved on this deployment

This preserves safety and avoids misleading UX.

## Compatibility Matrix

| Runtime state | Channel | Feishu route available | Lynx behavior |
|---|---|---:|---|
| `>= 2026.3.28` | `webchat` | irrelevant | use native plugin approval |
| `>= 2026.3.28` | `feishu` | yes | use existing Lynx Feishu local approval |
| `>= 2026.3.28` | `feishu` | no | deny with clear Feishu-route-unavailable reason |
| `< 2026.3.28` | any protected request needing approval | yes | use existing Lynx Feishu local approval |
| `< 2026.3.28` | any protected request needing approval | no | deny with clear legacy-runtime-no-route reason |
| runtime unknown | any protected request needing approval | yes | treat conservatively and use existing Lynx Feishu local approval |
| runtime unknown | any protected request needing approval | no | treat conservatively and deny |

Notes:

- the formal introduction version is also the operational compatibility boundary: `2026.3.28`
- `2026.3.31-beta.1` and `2026.4.7` remain historical refinement milestones only
- this design intentionally treats unknown as legacy for safety

## User-Visible Behavior

## 1. `2026.3.28+` runtime on webchat

Expected behavior:

- Lynx returns native `requireApproval`
- OpenClaw handles popup, `/approve`, and native lifecycle
- Lynx does not inject Feishu manual instructions into the webchat-native path

## 2. Feishu request on any runtime

Expected behavior:

- Lynx uses the existing Feishu local approval flow
- approval reply still requires trusted Feishu `ou_id`
- the existing local approval command remains the operator action surface

This keeps identity enforcement strong and minimizes code churn.

## 3. Pre-`2026.3.28` runtime with Feishu available

Expected behavior:

- Lynx does not trust native plugin approval on that runtime
- Lynx reuses the existing Feishu local approval route
- if the original request came from a non-Feishu surface, the approval still resolves through the configured Feishu fallback route

This is the compatibility bridge for:

- true legacy deployments below `2026.3.28`
- unknown deployments

## 4. Pre-`2026.3.28` runtime without Feishu

Expected behavior:

- Lynx denies immediately
- Lynx explains that the runtime is too old for native plugin approval, or could not be classified safely, and no Feishu fallback route exists
- Lynx does not enter a wait state

## 5. `2026.3.28+` runtime without Feishu

Expected behavior:

- `webchat` still works through native plugin approval
- only routes that explicitly depend on Feishu local approval are unavailable
- Lynx does not require Feishu for the normal newer-runtime webchat approval path

## Required Failure Messages

The exact text can be refined during implementation, but the meaning must be stable.

### Old runtime plus no Feishu route

Required meaning:

- native plugin approval is unavailable on this deployment because the runtime is below `2026.3.28` or could not be classified safely
- Feishu manual approval is also unavailable
- this operation cannot be approved here
- suggested operator action is to upgrade OpenClaw or configure Feishu approval

### Feishu local route expected but not configured

Required meaning:

- this request requires Feishu local approval
- no Feishu owner/approver route is currently available
- the operation is denied

## Minimal File Change Plan

Target file additions:

- `src/runtime/plugin-approval-compat.ts`

Target file edits:

- `index.ts`
- optionally `src/runtime/hook-capabilities.ts` if version helpers are reused there instead of duplicated

No other file changes are required for the first implementation pass.

## Intended Code Movement

## New file

`src/runtime/plugin-approval-compat.ts` should contain:

- `PLUGIN_APPROVAL_INTRO_VERSION = "2026.3.28"`
- a helper that reads the current runtime version using existing capability helpers
- a strategy resolver that returns one of:
  - native webchat
  - Feishu local
  - deny

## Small `index.ts` integration points

The current concentrated touchpoints are already suitable for a minimal patch:

- current channel transport defaulting near `resolveChannelApprovalTransport(...)`
- approval transport assembly in `prepareToolApprovalHandlers(...)`
- native `requireApproval` emission where Lynx currently builds `buildToolApprovalRequest(...)`

The change should be:

- replace direct channel-only branching with a call into the new compatibility adapter
- leave the rest of the approval logic as intact as possible

## Out of Scope Refactors

Do not, in this phase:

- generalize local approval beyond Feishu
- merge all approval models into one new abstraction layer
- rewrite approval prompt builders
- refactor risk-stage ownership or policy evaluation

Those are valid later cleanups, but they are not compatible with the "smallest code and file change" goal.

## Security Properties

This design preserves the current important security properties:

- Feishu approval authority still depends on trusted `ou_id`
- other group participants still cannot consume another user's approval
- request fingerprints and approval windows remain request-scoped
- unknown or older runtimes fail closed instead of assuming native approval works
- Lynx risk recognition and evidence collection remain unchanged

## Why This Is The Right Temporary Architecture

This design is intentionally transitional.

It is not the final long-term approval architecture.

It is the best near-term fit because it:

- answers the historical version question accurately
- minimizes the number of touched files
- isolates version-specific compatibility in one removable file
- reuses the existing Feishu manual approval machinery
- avoids changing core OpenClaw behavior
- gives old deployments a safe path instead of a broken path

Later, once old-version compatibility is no longer needed, Lynx can remove the compatibility adapter and collapse back to the simpler native-first behavior.
