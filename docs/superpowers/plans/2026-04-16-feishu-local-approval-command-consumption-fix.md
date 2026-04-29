# Feishu Local Approval Command Consumption Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Feishu-delivered local Lynx approval replies reliably consume `/lynx-approve <token> allow-once|deny` and resume the blocked tool call instead of falling through into normal chat turns.

**Architecture:** Keep OpenClaw native `/approve` behavior unchanged and fix only the plugin-local approval path. Harden the Lynx command parser against real Feishu-wrapped message text, then add an awaited `before_agent_start` fallback so approval commands are consumed before model execution even if `message_received` misses them.

**Tech Stack:** TypeScript, Vitest, OpenClaw plugin hooks, Feishu channel runtime

---

### Task 1: Reproduce The Real Feishu `/lynx-approve` Miss

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('should consume a Feishu-wrapped /lynx-approve reply in message_received and resume the blocked tool call', async () => {
  // Register a local Feishu approval, then send a real Feishu-style wrapped
  // content string where the command appears after metadata lines.
  // Expect the pending tool call promise to resolve instead of timing out.
});

it('should consume /lynx-approve in before_agent_start so the command never falls through to model chat', async () => {
  // Seed a local Feishu approval, invoke before_agent_start with a wrapped
  // prompt containing /lynx-approve 000001 allow-once, and assert the hook
  // resolves the approval and blocks normal agent execution.
});
```

- [ ] **Step 2: Run only the new approval regression slice and verify it fails**

Run: `npx vitest run test/plugin.test.ts -t "lynx-approve"`

Expected: At least one new test fails because the wrapped Feishu approval text is not consumed and the pending tool call times out or falls through.

- [ ] **Step 3: Commit the failing test state if you are working in isolated task commits**

```bash
git add test/plugin.test.ts
git commit -m "test: reproduce feishu local approval command miss"
```

### Task 2: Fix Plugin-Local Approval Command Consumption

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`

- [ ] **Step 1: Implement robust `/lynx-approve` extraction**

```ts
function parseLocalToolApprovalReply(text: string): {
  token?: string;
  resolution: Extract<ToolApprovalResolution, "allow-once" | "deny">;
} | null {
  for (const variant of buildPromptIntentVariants(text)) {
    const match = variant.match(/(?:^|\s)\/lynx-approve(?:\s+([a-z0-9]+))?\s+(allow-once|deny)(?=$|\s)/i);
    if (match) {
      return {
        token: match[1]?.toLowerCase(),
        resolution: match[2].toLowerCase() as Extract<ToolApprovalResolution, "allow-once" | "deny">,
      };
    }
  }
  return null;
}
```

- [ ] **Step 2: Add an awaited `before_agent_start` fallback that consumes local approval commands before model execution**

```ts
const localApprovalReply = parseLocalToolApprovalReply(promptText);
if (localApprovalReply) {
  const outcome = await tryResolveLocalToolApprovalFromHook({
    event,
    ctx,
    localApprovalReply,
    localApprovalApproverOuIds,
  });
  if (outcome.handled) {
    return {
      block: true,
      blockReason: outcome.blockReason,
    } as any;
  }
}
```

- [ ] **Step 3: Reuse one shared resolver for `message_received` and `before_agent_start`**

```ts
async function tryResolveLocalToolApprovalFromHook(params: {
  event: any;
  ctx: any;
  localApprovalReply: {
    token?: string;
    resolution: Extract<ToolApprovalResolution, "allow-once" | "deny">;
  };
  localApprovalApproverOuIds: string[];
}): Promise<{ handled: boolean; blockReason?: string }> {
  // Look up the local approval by token or session, enforce ou_id ownership,
  // resolve allow/deny, send hook feedback, and report whether normal flow
  // should stop here.
}
```

- [ ] **Step 4: Run the focused approval regression slice and verify it passes**

Run: `npx vitest run test/plugin.test.ts -t "lynx-approve"`

Expected: PASS for the wrapped-message regression tests and the existing Feishu local approval tests.

- [ ] **Step 5: Run TypeScript verification**

Run: `npx tsc --noEmit`

Expected: exit code 0

- [ ] **Step 6: Commit the plugin fix**

```bash
git add index.ts test/plugin.test.ts
git commit -m "fix: consume feishu local approval replies before chat fallback"
```

### Task 3: Sync And Verify In Real OpenClaw Runtime

**Files:**
- Runtime verification only

- [ ] **Step 1: Sync the plugin into the real Docker runtime**

Run: `node scripts/verify-dev-sync.mjs`

Expected: sync precheck passes

- [ ] **Step 2: Restart and resync the real gateway**

Run: `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`

Expected: gateway restart succeeds and logs show Lynx plugin loaded

- [ ] **Step 3: Verify gateway health**

Run: `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:18789/healthz`

Expected: HTTP 200 with `{"ok":true,"status":"live"}`

- [ ] **Step 4: Trigger a real Feishu approval repro and inspect logs**

Run: `docker compose logs --tail=200 openclaw-gateway`

Expected: logs show the Feishu `/lynx-approve ...` reply being consumed by Lynx instead of falling through into a new normal run.

- [ ] **Step 5: Confirm the blocked tool call resumes after approval**

Run: `Get-Content $env:USERPROFILE\.openclaw\lynx\hook-probe.log -Tail 120`

Expected: the approval prompt is delivered, the approval reply is accepted, and the original tool call does not end with `Approval timed out`.
