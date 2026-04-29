# One-Time Override Flow Snapshot

Date: 2026-04-01
Branch: `codex/risk-policy-one-time-override`
Worktree: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\.worktrees\codex-risk-policy-one-time-override`

## Goal

Make a one-time override cover both:

- local `selfSafetyGuard` decisions
- backend API risk decisions

Constraints:

- only for the current specific operation
- allow override for `L2`, `L3`, and configured `L4`
- score `10` always hard reject
- total-gate by level, fine-grained exceptions by module
- confirmation phrase is `确认放行本次操作`

## What Was Already Done

### Config/schema

- Added `selfSafetyGuard.policy` typing in `src/types.ts`
- Added policy schema in `openclaw.plugin.json`
- Added schema coverage in `test/plugin.test.ts`

### Policy engine

- Added `src/guard/risk-policy.ts`
- Added `resolveRiskPolicy()` returning:
  - `finalAction`
  - `override.allowed`
  - `override.confirmationPhrase`
  - `override.reason`

### Pending override store

- Added `src/runtime/pending-override-store.ts`
- Store is session-scoped and one-shot
- Tracks fingerprint, TTL, action type, replay payload, score, level, modules

### Runtime integration already wired before this snapshot

- `message_received`
  - receives confirmation phrase
  - consumes pending override
  - stores a one-time approved fingerprint
  - local input guard path already supports override prompt
- `before_agent_start`
  - local guard path already supports override prompt
  - backend `checkContent` block path was partially wired for the same flow

## Backend Reality Check

Compared with backend source in:

- `D:\all-sunday\openclaw-lynx\lynx\app\routers\records.py`
- `D:\all-sunday\openclaw-lynx\lynx\app\schemas.py`
- `D:\all-sunday\openclaw-lynx\lynx\app\external_apis.py`

Findings:

- `/api/v1/content_check`
  - frontend thinks risk can be `0-3`
  - backend currently returns `0` or `1`
  - unsafe content is flattened to `1`
- `/api/v1/tool_check`
  - frontend thinks risk can be `0-3`
  - backend currently returns `0` or `3`
  - unsafe tool call is flattened to `3`
- backend has no native one-time override token
  - override must be enforced completely in plugin runtime
- this means the most important remaining integration point is `before_tool_call`

## Remaining Work At Snapshot Time

1. Finish `before_tool_call`
   - fingerprint the tool operation
   - let one approved fingerprint bypass both local guard and backend API result in the same retry
   - keep Skill Guard unchanged
2. Add focused tests
   - local tool guard one-time override
   - backend tool API one-time override
3. Run focused Vitest verification

## Design Choice For Shared Coverage

Use one fingerprint per operation attempt:

- input: session + action type + text
- agent start: session + action type + prompt
- tool call: session + action type + `toolName + params`

Flow:

1. block occurs from local guard or backend API
2. save pending override for that exact fingerprint
3. user replies `确认放行本次操作`
4. plugin stores a one-time approved fingerprint
5. next identical operation consumes that approval once
6. the consumed approval bypasses both local and backend checks for that same attempt

## Notes

- Some Chinese strings look garbled in PowerShell output because of encoding display, not necessarily file corruption.
- Prefer Unicode escapes when touching confirmation strings to avoid future display issues.
