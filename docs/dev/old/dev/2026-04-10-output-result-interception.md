# Output Result Interception Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intercept unsafe tool results and final assistant output before persistence or delivery, with explicit proof that the new OpenClaw hooks are both supported and actually firing.

**Architecture:** Add a synchronous result-guard layer in front of transcript persistence, wire it into `tool_result_persist` and `before_message_write`, and keep `message_sending` as the final outbound kill switch. Align lifecycle types to the official `openclaw/plugin-sdk` contract, raise the tested peer dependency floor, and add probes plus regression tests so hook effectiveness is observable.

**Tech Stack:** TypeScript, OpenClaw plugin hooks, Vitest

---

### Task 1: Align Hook Contracts and Runtime Capability Checks

**Files:**
- Create: `src/runtime/hook-capabilities.ts`
- Modify: `index.ts`
- Modify: `package.json`
- Modify: `openclaw.plugin.json`
- Test: `test/plugin.test.ts`

- [ ] **Step 1: Write the failing registration and version-floor tests**

```ts
it("registers tool_result_persist, before_message_write, and message_sending hooks", () => {
  setup(mockApi);
  expect(mockApi.on).toHaveBeenCalledWith("tool_result_persist", expect.any(Function));
  expect(mockApi.on).toHaveBeenCalledWith("before_message_write", expect.any(Function));
  expect(mockApi.on).toHaveBeenCalledWith("message_sending", expect.any(Function));
});

it("logs a warning when the tested OpenClaw floor is not met", async () => {
  vi.doMock("../src/runtime/hook-capabilities.js", () => ({
    getHookCapabilityReport: vi.fn(() => ({
      runtimeVersion: "2026.2.12",
      testedMinimumVersion: "2026.2.26",
      supported: false,
    })),
  }));

  setup(mockApi);
  expect(mockApi.logger.warn).toHaveBeenCalledWith(
    expect.stringContaining("2026.2.26"),
  );
});
```

- [ ] **Step 2: Run the focused plugin test to verify it fails**

Run: `npx vitest run test/plugin.test.ts -t "registers tool_result_persist, before_message_write, and message_sending hooks"`

Expected: `FAIL` because `tool_result_persist` and `message_sending` are not both registered yet.

- [ ] **Step 3: Add runtime capability helpers**

```ts
// src/runtime/hook-capabilities.ts
export const TESTED_MIN_OPENCLAW_VERSION = "2026.2.26";

function parseVersion(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  const left = parseVersion(version);
  const right = parseVersion(minimum);
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

export function getHookCapabilityReport(runtimeVersion: string | undefined) {
  const version = runtimeVersion?.trim() || "0.0.0";
  return {
    runtimeVersion: version,
    testedMinimumVersion: TESTED_MIN_OPENCLAW_VERSION,
    supported: isVersionAtLeast(version, TESTED_MIN_OPENCLAW_VERSION),
  };
}
```

- [ ] **Step 4: Switch `index.ts` to the official plugin SDK type and log the capability report**

```ts
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { getHookCapabilityReport } from "./src/runtime/hook-capabilities.js";

const runtimeVersion = process.env.OPENCLAW_VERSION ?? process.env.npm_package_dependencies_openclaw;
const hookCapability = getHookCapabilityReport(runtimeVersion);

log.info(
  `[lynx-guardian] Hook capability report: runtime=${hookCapability.runtimeVersion}, tested-min=${hookCapability.testedMinimumVersion}, supported=${hookCapability.supported}`,
);
if (!hookCapability.supported) {
  log.warn(
    `[lynx-guardian] Output interception requires openclaw >= ${hookCapability.testedMinimumVersion}; some hooks may not fire on this runtime.`,
  );
}
```

- [ ] **Step 5: Raise the declared OpenClaw support floor and document the new config flags**

```json
// package.json
{
  "peerDependencies": {
    "openclaw": ">=2026.2.26"
  }
}
```

```json
// openclaw.plugin.json
{
  "properties": {
    "selfSafetyGuard": {
      "properties": {
        "resultGuard": {
          "type": "boolean",
          "default": true,
          "description": "Enable synchronous interception of unsafe tool results before transcript persistence"
        },
        "outputEnforcementMode": {
          "type": "string",
          "enum": ["warn", "redact", "block"],
          "default": "block",
          "description": "Default enforcement mode for persisted assistant output and outbound delivery"
        }
      }
    }
  }
}
```

- [ ] **Step 6: Re-run the focused plugin tests**

Run: `npx vitest run test/plugin.test.ts -t "registers tool_result_persist, before_message_write, and message_sending hooks"`

Expected: `PASS`

- [ ] **Step 7: Commit the hook contract and capability changes**

```bash
git add package.json openclaw.plugin.json index.ts src/runtime/hook-capabilities.ts test/plugin.test.ts
git commit -m "feat: align hook contracts for output interception"
```

### Task 2: Add a Synchronous Result Guard for Persisted Tool Results and Assistant Messages

**Files:**
- Create: `src/guard/result-guard.ts`
- Modify: `src/guard/safety-guard.ts`
- Modify: `src/runtime/plugin-runtime-helpers.ts`
- Test: `test/safety-guard.test.ts`

- [ ] **Step 1: Write the failing unit tests for result-oriented interception**

```ts
import { guardAssistantPersistence, guardToolResultPersistence } from "../src/guard/result-guard.js";

it("rewrites persisted /etc/passwd tool results", () => {
  const decision = guardToolResultPersistence("read", {
    role: "tool",
    content: "/etc/passwd\nroot:x:0:0:root:/root:/bin/bash",
  });
  expect(decision.block).toBe(true);
  expect(String(decision.message?.content)).toContain("tool result replaced by security guard");
});

it("rewrites assistant messages that still contain leaked protected content", () => {
  const decision = guardAssistantPersistence({
    role: "assistant",
    content: "TOOLS.md content follows: internal tool boundaries",
  });
  expect(decision.block).toBe(true);
  expect(String(decision.message?.content)).toContain("assistant output replaced by security guard");
});
```

- [ ] **Step 2: Run the safety-guard tests to verify they fail**

Run: `npx vitest run test/safety-guard.test.ts -t "rewrites persisted /etc/passwd tool results"`

Expected: `FAIL` because `result-guard.ts` does not exist yet.

- [ ] **Step 3: Create the synchronous result guard**

```ts
// src/guard/result-guard.ts
import { guardOutput } from "./safety-guard.js";
import { createReplacementMessage, extractMessageText } from "../runtime/plugin-runtime-helpers.js";

const PROTECTED_RESULT_PATTERNS = [
  /(^|\n)root:[^:\n]*:\d+:\d+:/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\baws_access_key_id\b/i,
  /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/,
  /\bSOUL\.md\b|\bTOOLS\.md\b|\bSHIELD\.md\b/i,
];

function isProtectedResult(text: string): boolean {
  return PROTECTED_RESULT_PATTERNS.some((pattern) => pattern.test(text));
}

export function guardToolResultPersistence(toolName: string, message: any) {
  const text = extractMessageText(message);
  if (!text) return { block: false, message };
  if (!isProtectedResult(text) && !guardOutput(text).block) {
    return { block: false, message };
  }
  return {
    block: true,
    message: createReplacementMessage(
      message,
      `[Lynx Guardian] tool result replaced by security guard: ${toolName} returned protected content`,
    ),
  };
}

export function guardAssistantPersistence(message: any) {
  const text = extractMessageText(message);
  if (!text) return { block: false, message };
  const outputDecision = guardOutput(text);
  if (!outputDecision.block) {
    return { block: false, message };
  }
  return {
    block: true,
    message: createReplacementMessage(
      message,
      "[Lynx Guardian] assistant output replaced by security guard: protected result leakage detected",
    ),
  };
}
```

- [ ] **Step 4: Add message text extraction and replacement helpers**

```ts
// src/runtime/plugin-runtime-helpers.ts
export function extractMessageText(message: any): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block: any) => block && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("\n");
}

export function createReplacementMessage(message: any, replacement: string): any {
  if (!message) return message;
  if (typeof message.content === "string") {
    return { ...message, content: replacement };
  }
  if (Array.isArray(message.content)) {
    return {
      ...message,
      content: [{ type: "text", text: replacement }],
    };
  }
  return { ...message, content: replacement };
}
```

- [ ] **Step 5: Re-export or reuse existing `guardOutput()` scoring helpers without making the new guard asynchronous**

```ts
// src/guard/safety-guard.ts
export function detectProtectedOutputLeak(output: string): boolean {
  const leak = detectSystemPromptLeak(output);
  const secrets = detectSecretsInOutput(output);
  return leak.isLeak || secrets.length > 0;
}
```

- [ ] **Step 6: Re-run the result-guard unit tests**

Run: `npx vitest run test/safety-guard.test.ts -t "rewrites persisted /etc/passwd tool results"`

Expected: `PASS`

- [ ] **Step 7: Commit the synchronous result guard**

```bash
git add src/guard/result-guard.ts src/guard/safety-guard.ts src/runtime/plugin-runtime-helpers.ts test/safety-guard.test.ts
git commit -m "feat: add synchronous result interception guard"
```

### Task 3: Wire `tool_result_persist`, `before_message_write`, and `message_sending`

**Files:**
- Modify: `index.ts`
- Modify: `src/runtime/message-decoration.ts`
- Test: `test/plugin.test.ts`

- [ ] **Step 1: Write the failing lifecycle tests**

```ts
it("rewrites unsafe tool results during tool_result_persist", async () => {
  setup(mockApi);
  const handler = handlers["tool_result_persist"];
  const result = handler(
    {
      toolName: "read",
      toolCallId: "call-1",
      message: { role: "tool", content: "/etc/passwd\nroot:x:0:0:root:/root:/bin/bash" },
      isSynthetic: false,
    },
    { sessionKey: "sess-tool-result" },
  );

  expect(result).toEqual({
    message: expect.objectContaining({
      content: expect.stringContaining("tool result replaced by security guard"),
    }),
  });
});

it("cancels outbound delivery when protected output reaches message_sending", async () => {
  setup(mockApi);
  const handler = handlers["message_sending"];
  const result = await handler(
    { to: "webchat", content: "TOOLS.md content follows: internal tool boundaries" },
    { sessionKey: "sess-send", channelId: "webchat" },
  );

  expect(result).toEqual({ cancel: true });
});
```

- [ ] **Step 2: Run the focused plugin tests to verify they fail**

Run: `npx vitest run test/plugin.test.ts -t "rewrites unsafe tool results during tool_result_persist"`

Expected: `FAIL`

- [ ] **Step 3: Register the new hooks in `index.ts`**

```ts
import {
  guardAssistantPersistence,
  guardToolResultPersistence,
} from "./src/guard/result-guard.js";

api.on("tool_result_persist", (event, ctx) => {
  appendLifecycleProbe("tool_result_persist", event, ctx);
  if (selfSafetyGuardConfig.resultGuard === false) return;
  const decision = guardToolResultPersistence(event.toolName, event.message);
  if (!decision.block) return;
  return { message: decision.message };
});

api.on("before_message_write", (event, ctx) => {
  appendLifecycleProbe("before_message_write", event, ctx);
  const persistedDecision = guardAssistantPersistence(event.message);
  if (persistedDecision.block) {
    return { message: persistedDecision.message };
  }
  return { message: decorateAssistantMessage(event.message) };
});

api.on("message_sending", async (event, ctx) => {
  appendLifecycleProbe("message_sending", event, ctx);
  const outboundDecision = guardOutput(event.content, ctx.sessionKey);
  if (outboundDecision.block) {
    return { cancel: true };
  }
  return;
});
```

- [ ] **Step 4: Keep discovery decoration compatible with the new persistence guard**

```ts
// src/runtime/message-decoration.ts
export function decorateAssistantMessage(message: any): any {
  if (!message || message.role !== "assistant") {
    return message;
  }
  return message;
}
```

- [ ] **Step 5: Re-run the lifecycle tests**

Run: `npx vitest run test/plugin.test.ts -t "rewrites unsafe tool results during tool_result_persist"`

Expected: `PASS`

- [ ] **Step 6: Commit the lifecycle wiring**

```bash
git add index.ts src/runtime/message-decoration.ts test/plugin.test.ts
git commit -m "feat: wire output interception lifecycle hooks"
```

### Task 4: Move Remote Audit Calls Off the Synchronous Enforcement Path

**Files:**
- Modify: `index.ts`
- Modify: `src/api.ts`
- Test: `test/plugin.test.ts`

- [ ] **Step 1: Write the failing regression test that proves persistence does not depend on an async API**

```ts
it("still rewrites protected output when audit APIs fail", async () => {
  vi.mocked(api.pushRecord).mockRejectedValueOnce(new Error("network down"));
  setup(mockApi);
  const handler = handlers["tool_result_persist"];

  const result = handler(
    {
      toolName: "read",
      toolCallId: "call-2",
      message: { role: "tool", content: "-----BEGIN OPENSSH PRIVATE KEY-----" },
      isSynthetic: false,
    },
    { sessionKey: "sess-audit-fail" },
  );

  expect(result).toEqual({
    message: expect.objectContaining({
      content: expect.stringContaining("tool result replaced by security guard"),
    }),
  });
});
```

- [ ] **Step 2: Run the focused regression test to verify it fails or exposes the wrong dependency**

Run: `npx vitest run test/plugin.test.ts -t "still rewrites protected output when audit APIs fail"`

Expected: `FAIL` or `WARN` because current interception still mixes mutation and async side effects.

- [ ] **Step 3: Refactor `index.ts` so audit calls happen after the synchronous mutation result is decided**

```ts
function scheduleAuditRecord(content: string, riskLevel: number): void {
  void pushRecord(userId, content, riskLevel).catch((err: any) => {
    log.error(`[lynx-guardian] Deferred audit record failed: ${err.message}`);
  });
}

api.on("tool_result_persist", (event, ctx) => {
  const decision = guardToolResultPersistence(event.toolName, event.message);
  if (!decision.block) return;
  scheduleAuditRecord(`[SSG:result] ${event.toolName}`, 2);
  return { message: decision.message };
});
```

- [ ] **Step 4: Make the remote API timeout explicit for audit-side usage only**

```ts
// src/api.ts
const API_TIMEOUT_MS = 10000;
export { API_TIMEOUT_MS };
```

- [ ] **Step 5: Re-run the audit-decoupling regression test**

Run: `npx vitest run test/plugin.test.ts -t "still rewrites protected output when audit APIs fail"`

Expected: `PASS`

- [ ] **Step 6: Commit the audit-path refactor**

```bash
git add index.ts src/api.ts test/plugin.test.ts
git commit -m "refactor: keep output interception synchronous"
```

### Task 5: Add End-to-End Regression Coverage for the Critical Payloads

**Files:**
- Modify: `test/plugin.test.ts`
- Modify: `test/safety-guard.test.ts`

- [ ] **Step 1: Add the end-to-end regression matrix**

```ts
it.each([
  ["/etc/passwd\nroot:x:0:0:root:/root:/bin/bash", "tool result replaced by security guard"],
  ["AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP", "tool result replaced by security guard"],
  ["-----BEGIN OPENSSH PRIVATE KEY-----", "tool result replaced by security guard"],
])("rewrites protected persisted tool output: %s", (payload, expected) => {
  setup(mockApi);
  const handler = handlers["tool_result_persist"];
  const result = handler(
    {
      toolName: "read",
      toolCallId: "call-matrix",
      message: { role: "tool", content: payload },
      isSynthetic: false,
    },
    { sessionKey: "sess-matrix" },
  );
  expect(String(result?.message?.content)).toContain(expected);
});

it("leaves safe file output unchanged", () => {
  const decision = guardToolResultPersistence("read", {
    role: "tool",
    content: "README.md\nProject usage instructions",
  });
  expect(decision.block).toBe(false);
});
```

- [ ] **Step 2: Run the targeted regression suite**

Run: `npx vitest run test/plugin.test.ts test/safety-guard.test.ts`

Expected: `PASS`

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`

Expected: `PASS`

- [ ] **Step 4: Commit the regression coverage**

```bash
git add test/plugin.test.ts test/safety-guard.test.ts
git commit -m "test: cover result-oriented output interception"
```

### Task 6: Update README Guidance and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `README_en.md`
- Test: `test/plugin.test.ts`

- [ ] **Step 1: Document the new interception model and version floor**

```md
## Output Result Interception

Lynx Guardian now enforces output safety in three layers:

- `tool_result_persist`: intercepts unsafe tool results before session persistence
- `before_message_write`: intercepts unsafe assistant messages before session persistence
- `message_sending`: cancels high-risk outbound delivery

This feature requires `openclaw >= 2026.2.26`.
```

- [ ] **Step 2: Verify the probe-backed hook paths still pass after documentation updates**

Run: `npx vitest run test/plugin.test.ts -t "rewrites unsafe tool results during tool_result_persist"`

Expected: `PASS`

- [ ] **Step 3: Commit the documentation updates**

```bash
git add README.md README_en.md
git commit -m "docs: describe output result interception"
```
