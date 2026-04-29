# Lynx Check Orchestrator Inline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plugin-side hardcoded `/lynx-check` execution with a skill-first orchestrator flow that writes run intent/result state, forces model dispatch through the Lynx orchestrator skill, and falls back to plugin delivery only when the skill send path fails.

**Architecture:** Keep the plugin as trigger/routing/fallback infrastructure, introduce explicit run intent/result stores under `.openclaw/lynx/check-runs`, remove direct `buildManualLynxCheckReport()` use from the main `/lynx-check` path, and upgrade the existing `lynx-guardian-daily-lynx-check` skill into an orchestration entrypoint that dispatches to `SX-security-audit` and `SX-openclaw-discovery`. Preserve recent-active delivery, scheduled cron sync, and output interception.

**Tech Stack:** TypeScript, OpenClaw plugin hooks, skill documentation, Vitest, local OpenClaw runtime

---

### Task 1: Add Explicit Lynx Check Run Stores

**Files:**
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-check-run-store.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\plugin-runtime-helpers.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: Write the failing run-store tests**

```ts
import {
  createLynxCheckRunIntent,
  readLynxCheckRunIntent,
  writeLynxCheckRunResult,
  readLynxCheckRunResult,
} from '../src/runtime/lynx-check-run-store.js';

it('creates a manual lynx-check run intent with current-session routing', () => {
  const intent = createLynxCheckRunIntent({
    source: 'manual',
    trigger: 'lynx_command',
    preferredTargetKind: 'current',
    sessionKey: 'sess-manual',
    routeHint: {
      targetKey: 'webchat:webchat:sender-a',
      sessionKey: 'sess-manual',
      channelId: 'webchat',
      messageProvider: 'webchat',
      senderId: 'sender-a',
      updatedAtMs: 1712800000000,
    },
  });

  expect(intent.requestId).toMatch(/^lynx-check-/);
  expect(readLynxCheckRunIntent(intent.requestId)).toEqual(intent);
});

it('writes a failed result that preserves the report path for plugin fallback', () => {
  const intent = createLynxCheckRunIntent({
    source: 'scheduled',
    trigger: 'scheduled_lynx_check',
    preferredTargetKind: 'recent',
  });

  writeLynxCheckRunResult(intent.requestId, {
    status: 'completed',
    sendAttempted: true,
    sendSucceeded: false,
    transport: 'skill-send-failed',
    reportPath: 'C:/tmp/report.md',
    errorMessage: 'webchat send failed',
  });

  expect(readLynxCheckRunResult(intent.requestId)).toEqual(
    expect.objectContaining({
      requestId: intent.requestId,
      sendSucceeded: false,
      reportPath: 'C:/tmp/report.md',
    }),
  );
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `& 'C:\Users\24716\AppData\Local\npm-cache\_npx\69c381f8ad94b576\node_modules\.bin\vitest.cmd' run --root C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian --dir test --exclude .worktrees/** --pool threads --no-file-parallelism --maxWorkers 1 test/plugin.test.ts -t "run intent"`

Expected: `FAIL` because the run store does not exist yet.

- [ ] **Step 3: Create the run-store file with explicit intent/result contracts**

```ts
// src/runtime/lynx-check-run-store.ts
export interface LynxCheckRunIntent {
  requestId: string;
  source: 'manual' | 'scheduled';
  trigger: 'lynx_command' | 'scheduled_lynx_check';
  preferredTargetKind: 'current' | 'recent';
  sessionKey?: string;
  routeHint?: RecentActiveDeliverySnapshot;
  createdAtMs: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface LynxCheckRunResult {
  requestId: string;
  status: 'not_started' | 'running' | 'completed' | 'failed';
  sendAttempted: boolean;
  sendSucceeded: boolean;
  transport: string;
  reportPath?: string;
  errorMessage?: string;
  completedAtMs: number;
}
```

- [ ] **Step 4: Reuse the runtime-home helper so store paths stay under test HOME**

```ts
function getCheckRunsRoot(): string {
  return join(resolveRuntimeHomeDir(), '.openclaw', 'lynx', 'check-runs');
}
```

- [ ] **Step 5: Re-run the focused run-store tests**

Run: `& 'C:\Users\24716\AppData\Local\npm-cache\_npx\69c381f8ad94b576\node_modules\.bin\vitest.cmd' run --root C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian --dir test --exclude .worktrees/** --pool threads --no-file-parallelism --maxWorkers 1 test/plugin.test.ts -t "run intent"`

Expected: `PASS`

### Task 2: Refactor Plugin `/lynx-check` Triggering to Intent + Prompt Injection

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-delivery-intent-store.ts`

- [ ] **Step 1: Write the failing manual and scheduled orchestration tests**

```ts
it('creates a run intent and blocks manual /lynx-check with orchestrator instructions instead of executing the report inline', async () => {
  setup(mockApi);
  const handler = handlers['message_received'];

  const result = await handler(
    { content: '/lynx-check' },
    {
      sessionKey: 'sess-manual-orchestrator',
      channelId: 'webchat',
      messageProvider: 'webchat',
      senderId: 'sender-manual',
    },
  );

  expect(discovery.discoverOpenClaw).not.toHaveBeenCalled();
  expect(result).toEqual({
    block: true,
    blockReason: expect.stringContaining('lynx-guardian-daily-lynx-check'),
  });
  expect(result.blockReason).toContain('SX-security-audit');
  expect(result.blockReason).toContain('SX-openclaw-discovery');
});

it('injects execution-dispatch instructions for scheduled /lynx-check instead of writing a composite report file', async () => {
  setup(mockApi);
  const beforeAgentStart = handlers['before_agent_start'];

  const result = await beforeAgentStart(
    { prompt: '[2026-04-11 09:00:00] /lynx-check' },
    { sessionKey: 'sess-scheduled-orchestrator', subsystem: 'plugins' },
  );

  expect(result).toEqual(
    expect.objectContaining({
      prependContext: expect.stringContaining('execution-dispatch mode'),
    }),
  );
  expect(result.prependContext).toContain('lynx-guardian-daily-lynx-check');
  expect(existsSync(pendingDiscoveryPath)).toBe(false);
});
```

- [ ] **Step 2: Run the focused plugin tests to verify they fail**

Run: `& 'C:\Users\24716\AppData\Local\npm-cache\_npx\69c381f8ad94b576\node_modules\.bin\vitest.cmd' run --root C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian --dir test --exclude .worktrees/** --pool threads --no-file-parallelism --maxWorkers 1 test/plugin.test.ts -t "orchestrator"`

Expected: `FAIL` because `/lynx-check` still executes inline.

- [ ] **Step 3: Replace manual inline execution in `message_received`**

```ts
if (lynxCheckTrigger.kind === 'lynx_command') {
  const routeHint = rememberRecentActiveDeliveryTarget(ctx) ?? readRecentActiveDeliverySnapshot();
  const runIntent = createLynxCheckRunIntent({
    source: 'manual',
    trigger: 'lynx_command',
    preferredTargetKind: 'current',
    sessionKey: ctx.sessionKey,
    routeHint: routeHint ?? undefined,
  });

  return {
    block: true,
    blockReason: buildLynxCheckExecutionPrompt({
      skillPath: 'skills/lynx-guardian-daily-lynx-check/SKILL.md',
      requestId: runIntent.requestId,
      source: runIntent.source,
      preferredTargetKind: runIntent.preferredTargetKind,
    }),
  };
}
```

- [ ] **Step 4: Replace scheduled report injection in `before_agent_start`**

```ts
if (isManualCompositeLynxCheckRequest(userInput)) {
  const runIntent = createLynxCheckRunIntent({
    source: normalizeString((ctx as any)?.subsystem).toLowerCase() === 'plugins' ? 'scheduled' : 'manual',
    trigger: normalizeString((ctx as any)?.subsystem).toLowerCase() === 'plugins' ? 'scheduled_lynx_check' : 'lynx_command',
    preferredTargetKind: normalizeString((ctx as any)?.subsystem).toLowerCase() === 'plugins' ? 'recent' : 'current',
    sessionKey: ctx.sessionKey,
    routeHint: readRecentActiveDeliverySnapshot() ?? undefined,
  });

  prependContext += buildLynxCheckExecutionPrompt({
    requestId: runIntent.requestId,
    source: runIntent.source,
    preferredTargetKind: runIntent.preferredTargetKind,
    skillPath: 'skills/lynx-guardian-daily-lynx-check/SKILL.md',
  });
}
```

- [ ] **Step 5: Re-run the focused orchestrator tests**

Run: `& 'C:\Users\24716\AppData\Local\npm-cache\_npx\69c381f8ad94b576\node_modules\.bin\vitest.cmd' run --root C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian --dir test --exclude .worktrees/** --pool threads --no-file-parallelism --maxWorkers 1 test/plugin.test.ts -t "orchestrator"`

Expected: `PASS`

### Task 3: Make `agent_end` Read Run Results and Fallback Deliver

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-message-delivery.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: Write the failing fallback tests**

```ts
it('does not fallback-send when the orchestrator skill marked sendSucceeded=true', async () => {
  setup(mockApi);
  const agentEnd = handlers['agent_end'];
  const recentWebchatSendMessage = vi.fn().mockResolvedValue(undefined);

  recentActiveDelivery.rememberRecentActiveDeliveryTarget({
    sessionKey: 'sess-recent',
    channelId: 'webchat',
    messageProvider: 'webchat',
    sendMessage: recentWebchatSendMessage,
  } as any, { path: recentActiveDeliveryPath, now: 1 });

  const intent = createLynxCheckRunIntent({
    source: 'scheduled',
    trigger: 'scheduled_lynx_check',
    preferredTargetKind: 'recent',
    sessionKey: 'sess-scheduled',
  });
  writeFileSync(join(openclawHome, '.openclaw', 'lynx', 'check-runs', `${intent.requestId}.report.md`), '# report', 'utf8');
  writeLynxCheckRunResult(intent.requestId, {
    status: 'completed',
    sendAttempted: true,
    sendSucceeded: true,
    transport: 'skill-shared-sender',
    reportPath: join(openclawHome, '.openclaw', 'lynx', 'check-runs', `${intent.requestId}.report.md`),
  });

  await agentEnd({ messages: [{ role: 'assistant', content: 'done' }] }, { sessionKey: 'sess-scheduled', subsystem: 'plugins' });

  expect(recentWebchatSendMessage).not.toHaveBeenCalled();
});

it('fallback-sends the stored report when the orchestrator skill marked sendSucceeded=false', async () => {
  setup(mockApi);
  const agentEnd = handlers['agent_end'];
  const recentWebchatSendMessage = vi.fn().mockResolvedValue(undefined);
  // same intent setup, but sendSucceeded false
});
```

- [ ] **Step 2: Run the focused fallback tests to verify they fail**

Run: `& 'C:\Users\24716\AppData\Local\npm-cache\_npx\69c381f8ad94b576\node_modules\.bin\vitest.cmd' run --root C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian --dir test --exclude .worktrees/** --pool threads --no-file-parallelism --maxWorkers 1 test/plugin.test.ts -t "fallback-send"`

Expected: `FAIL`

- [ ] **Step 3: Add run-result lookup in `agent_end` before legacy discovery fallback**

```ts
const activeRunIntent = readLatestPendingLynxCheckRunIntent(ctx.sessionKey);
if (activeRunIntent) {
  const runResult = readLynxCheckRunResult(activeRunIntent.requestId);
  if (runResult?.sendSucceeded) {
    return;
  }
  if (runResult?.reportPath && existsSync(runResult.reportPath)) {
    const report = readFileSync(runResult.reportPath, 'utf8');
    await deliverLynxReport({
      log,
      ctx,
      tag: `lynx-check-run-${activeRunIntent.requestId}`,
      attempts: 3,
      routeHint: resolveRouteHintForRun(activeRunIntent),
      routeHintSendMessage: resolveRouteSendMessageForRun(activeRunIntent),
      allowSameSessionFallback: activeRunIntent.preferredTargetKind === 'current',
      message: { role: 'assistant', content: report },
    });
    markLynxCheckRunCompleted(activeRunIntent.requestId);
    return;
  }
}
```

- [ ] **Step 4: Re-run the focused fallback tests**

Run: `& 'C:\Users\24716\AppData\Local\npm-cache\_npx\69c381f8ad94b576\node_modules\.bin\vitest.cmd' run --root C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian --dir test --exclude .worktrees/** --pool threads --no-file-parallelism --maxWorkers 1 test/plugin.test.ts -t "fallback-send"`

Expected: `PASS`

### Task 4: Rewrite the Skill Entry Point as an Orchestrator and Align Capability Docs

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\skills\lynx-guardian-daily-lynx-check\SKILL.md`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\skills\lynx-guardian-lesson\SX-openclaw-discovery\SKILL.md`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\skills\lynx-guardian-lesson\SX-openclaw-discovery\README.md`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\skills\lynx-guardian-lesson\SX-security-audit\SKILL.md`

- [ ] **Step 1: Write a failing documentation regression test**

```ts
it('documents execution-dispatch mode and the result-store contract in the orchestrator skill', () => {
  const raw = readFileSync(
    new URL('../skills/lynx-guardian-daily-lynx-check/SKILL.md', import.meta.url),
    'utf8',
  );

  expect(raw).toContain('Execution Dispatch Mode');
  expect(raw).toContain('requestId');
  expect(raw).toContain('sendSucceeded');
  expect(raw).toContain('SX-security-audit');
  expect(raw).toContain('SX-openclaw-discovery');
});
```

- [ ] **Step 2: Run the focused skill-doc test to verify it fails**

Run: `& 'C:\Users\24716\AppData\Local\npm-cache\_npx\69c381f8ad94b576\node_modules\.bin\vitest.cmd' run --root C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian --dir test --exclude .worktrees/** --pool threads --no-file-parallelism --maxWorkers 1 test/plugin.test.ts -t "documents execution-dispatch mode"`

Expected: `FAIL`

- [ ] **Step 3: Rewrite the orchestrator skill to describe scheduler mode and execution-dispatch mode**

```md
## Execution Dispatch Mode

When the plugin injects a managed `/lynx-check` run:

1. Read the `requestId` intent record under `.openclaw/lynx/check-runs/`.
2. Dispatch the audit portion to `SX-security-audit`.
3. Dispatch the discovery portion to `SX-openclaw-discovery`.
4. Assemble one composite report and write it to `.openclaw/lynx/check-runs/<requestId>.report.md`.
5. Attempt active delivery as a new message.
6. Write `.result.json` with `sendAttempted`, `sendSucceeded`, `transport`, and `errorMessage`.
```

- [ ] **Step 4: Align the discovery and audit capability docs with orchestrator dispatch**

```md
The discovery capability now owns the execution-heavy `references/` and `scripts/` assets.
The orchestrator skill dispatches here for discovery execution instead of duplicating those assets.
```

- [ ] **Step 5: Re-run the focused skill-doc test**

Run: `& 'C:\Users\24716\AppData\Local\npm-cache\_npx\69c381f8ad94b576\node_modules\.bin\vitest.cmd' run --root C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian --dir test --exclude .worktrees/** --pool threads --no-file-parallelism --maxWorkers 1 test/plugin.test.ts -t "documents execution-dispatch mode"`

Expected: `PASS`

### Task 5: Verify with Unit Tests and Real OpenClaw Entry Points

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\hook-capabilities.test.ts`

- [ ] **Step 1: Run the focused unit suite after refactor**

Run: `& 'C:\Users\24716\AppData\Local\npm-cache\_npx\69c381f8ad94b576\node_modules\.bin\vitest.cmd' run --root C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian --dir test --exclude .worktrees/** --pool threads --no-file-parallelism --maxWorkers 1 test/plugin.test.ts test/pending-override-store.test.ts test/safety-guard.test.ts test/scheduled-lynx-check.test.ts test/hook-capabilities.test.ts`

Expected: `PASS`

- [ ] **Step 2: Exercise the local OpenClaw chat completions endpoint**

Run: `Invoke-RestMethod -Method Post -Uri http://127.0.0.1:18789/v1/chat/completions -ContentType 'application/json' -Body '{"model":"default","messages":[{"role":"user","content":"/lynx-check"}]}'`

Expected: response includes the managed `/lynx-check` turn and no direct plugin-side inline report execution.

- [ ] **Step 3: Exercise OpenClaw TUI manually**

Run: `openclaw tui`

Expected: entering `/lynx-check` shows the orchestrated run path, with either skill send success or logged plugin fallback.

- [ ] **Step 4: Commit the orchestrator migration**

```bash
git add index.ts src/runtime/lynx-check-run-store.ts src/runtime/lynx-delivery-intent-store.ts skills/lynx-guardian-daily-lynx-check/SKILL.md skills/lynx-guardian-lesson/SX-openclaw-discovery/SKILL.md skills/lynx-guardian-lesson/SX-openclaw-discovery/README.md skills/lynx-guardian-lesson/SX-security-audit/SKILL.md test/plugin.test.ts test/hook-capabilities.test.ts
git commit -m "feat: route lynx-check through orchestrator skill"
```
