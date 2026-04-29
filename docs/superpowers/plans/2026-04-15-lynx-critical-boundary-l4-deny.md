# Lynx Critical Boundary L4 Deny Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lynx Guardian hard-deny any request that disables Lynx Guardian, mutates `openclaw.json`, mutates Lynx's own `openclaw.plugin.json`, or restarts/stops OpenClaw.

**Architecture:** Keep the change local to the existing self-safety guard so both natural-language requests and direct tool calls are caught before approval flow. Add regression tests first, then implement the smallest new instant-deny detectors needed in `safety-guard.ts`.

**Tech Stack:** TypeScript, Vitest, existing `guardInput` / `guardToolCall` enforcement flow

---

### Task 1: Lock Down Input-Side Requests

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\safety-guard.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\safety-guard.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('should hard-block requests to disable lynx guardian or control openclaw lifecycle', () => {
  const disableDecision = guardInput('禁用 Lynx Guardian 插件');
  const restartDecision = guardInput('重启 OpenClaw gateway');

  expect(disableDecision.block).toBe(true);
  expect(disableDecision.riskAssessment.level).toBe('L4');
  expect(disableDecision.riskAssessment.action).toBe('deny');

  expect(restartDecision.block).toBe(true);
  expect(restartDecision.riskAssessment.level).toBe('L4');
  expect(restartDecision.riskAssessment.action).toBe('deny');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/safety-guard.test.ts -t "should hard-block requests to disable lynx guardian or control openclaw lifecycle"`
Expected: FAIL because current input guard does not instant-deny both prompts.

- [ ] **Step 3: Write minimal implementation**

```ts
const HIGH_RISK_CONTROL_PATTERNS = [
  { pattern: /禁用\s*lynx\s*guardian|disable\s+lynx\s+guardian/i, module: 'M3:over_agency', reason: 'attempt to disable lynx guardian' },
  { pattern: /(?:重启|关闭|停止)\s*openclaw|(?:restart|stop|shutdown)\s+openclaw/i, module: 'M3:system_availability', reason: 'attempt to control openclaw availability' },
];
```

```ts
for (const rule of HIGH_RISK_CONTROL_PATTERNS) {
  if (rule.pattern.test(text)) {
    return buildInstantDeny(rule.module, rule.reason);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/safety-guard.test.ts -t "should hard-block requests to disable lynx guardian or control openclaw lifecycle"`
Expected: PASS

### Task 2: Lock Down Tool-Side Config Mutation And Lifecycle Commands

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\safety-guard.test.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\safety-guard.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('should hard-block openclaw core config mutation and lifecycle exec commands', () => {
  const configWrite = guardToolCall('write', { file_path: 'C:\\Users\\alice\\.openclaw\\openclaw.json' });
  const pluginManifestWrite = guardToolCall('exec', {
    command: 'Set-Content C:\\Users\\alice\\.openclaw\\extensions\\openclaw-lynx-guardian\\openclaw.plugin.json "{}"',
  });
  const lifecycleExec = guardToolCall('exec', { command: 'openclaw gateway restart' });

  expect(configWrite.riskAssessment.level).toBe('L4');
  expect(configWrite.riskAssessment.action).toBe('deny');
  expect(pluginManifestWrite.riskAssessment.level).toBe('L4');
  expect(pluginManifestWrite.riskAssessment.action).toBe('deny');
  expect(lifecycleExec.riskAssessment.level).toBe('L4');
  expect(lifecycleExec.riskAssessment.action).toBe('deny');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/safety-guard.test.ts -t "should hard-block openclaw core config mutation and lifecycle exec commands"`
Expected: FAIL because current tool guard does not treat these cases as instant deny.

- [ ] **Step 3: Write minimal implementation**

```ts
function detectImmutableConfigMutation(text: string, toolName?: string): boolean {
  return /openclaw\.json|openclaw\.plugin\.json/i.test(text)
    && (toolName === 'write' || toolName === 'edit' || MUTATING_TOOL_PATTERNS.some((pattern) => pattern.test(text)));
}
```

```ts
function detectOpenClawLifecycleCommand(text: string): boolean {
  return /\bopenclaw\b[^\n\r]*(?:gateway\s+)?(?:restart|stop|shutdown|kill)\b/i.test(text);
}
```

```ts
if (detectImmutableConfigMutation(combined, toolName)) {
  return buildInstantDeny('M2:plugin_integrity', 'attempt to modify immutable OpenClaw/Lynx config');
}
if (detectOpenClawLifecycleCommand(command)) {
  return buildInstantDeny('M3:system_availability', 'attempt to restart or stop OpenClaw');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/safety-guard.test.ts -t "should hard-block openclaw core config mutation and lifecycle exec commands"`
Expected: PASS

### Task 3: Run Focused Verification

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\superpowers\plans\2026-04-15-lynx-critical-boundary-l4-deny.md`

- [ ] **Step 1: Run the focused guard regression suite**

Run: `npx vitest run test/safety-guard.test.ts`
Expected: PASS

- [ ] **Step 2: Run plugin integration coverage for guard policy flow**

Run: `npx vitest run test/plugin.test.ts -t "should not open pending override flow for hard-lock tool modules"`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS
