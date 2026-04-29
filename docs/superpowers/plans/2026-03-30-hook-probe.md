# Hook Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add several useful lifecycle hooks with minimal changes to existing code and a visible `message_sending` marker that proves real OpenClaw hook execution.

**Architecture:** Introduce a dedicated runtime helper module for new hook behaviors and keep `index.ts` changes limited to imports plus event registration. Validate the feature through focused plugin tests before implementation changes are considered complete.

**Tech Stack:** TypeScript, Vitest, NodeNext ESM, Node fs/path APIs

---

### Task 1: Add failing tests for new hook coverage

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] Add a test that expects `session_start`, `session_end`, `after_tool_call`, and `message_sending` to be registered
- [ ] Add a test that expects `message_sending` to prepend `【HOOK:message_sending 已生效】`
- [ ] Add a test that expects a lifecycle probe file entry to be written for one of the new hooks
- [ ] Run the focused plugin tests and confirm they fail for the expected missing-hook behavior

### Task 2: Implement the hook helper module

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\hook-probe.ts`

- [ ] Add a constant for the visible outbound marker
- [ ] Add a helper that decorates outgoing `message_sending` content without duplicating the marker
- [ ] Add a helper that appends probe log lines to a stable file under `~/.openclaw/lynx/`
- [ ] Add a helper that formats best-effort probe lines for generic lifecycle events

### Task 3: Wire the new hooks with minimal edits

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`

- [ ] Import the new hook helper functions
- [ ] Register `message_sending` and return the decorated content
- [ ] Register `session_start`, `session_end`, and `after_tool_call` with best-effort probe logging
- [ ] Keep existing hook behavior unchanged

### Task 4: Verify the implementation

**Files:**
- Test: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] Run `npx vitest run test/plugin.test.ts --testNamePattern "attach all event handlers|message_sending|probe"`
- [ ] Run `node scripts/build.js`
- [ ] Confirm the visible marker text and probe file path are stable and intentional
