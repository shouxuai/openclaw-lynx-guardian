# Guard Policy Redesign Module 01 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Note:** The user asked not to modify `docs/superpowers/plans/**`, so I’m saving this plan in `notes/…` while still keeping the required structure.

**Goal:** Limit audit entry detection to exact `/check` and `/lynx-check` messages so the managed flow stays intact, the native passthrough remains untouched, and natural-language capture no longer triggers discovery.

**Architecture:** Keep `src/discovery/lynx-check-trigger.ts` as a small deterministic classifier that only returns `none`, `native_passthrough`, or `lynx_command`. Let `index.ts` rely on those results: exact `/check` bypasses the plugin, `/lynx-check` claims the managed workflow, and every other text proceeds through the normal pipeline without discovery side effects.

**Tech Stack:** TypeScript, Vitest (node 20+, ES module environment).

---

### Task 1: Trigger classifier regression

**Files:**
- Create: `test/lynx-check-trigger.test.ts`
- Modify: `src/discovery/lynx-check-trigger.ts`
- Test: `test/lynx-check-trigger.test.ts`

- [ ] **Step 1: Write a failing test suite that asserts the new exact-command behavior**

```ts
import { classifyLynxCheckTrigger } from "../src/discovery/lynx-check-trigger.js";

describe("classifyLynxCheckTrigger", () => {
  it("identifies /check as native_passthrough", () => {
    expect(classifyLynxCheckTrigger("/check")).toEqual({
      kind: "native_passthrough",
      normalizedText: "/check",
    });
  });
  it("identifies /lynx-check as a lynx_command", () => {
    expect(classifyLynxCheckTrigger("/lynx-check")).toEqual({
      kind: "lynx_command",
      normalizedText: "/lynx-check",
    });
  });
  it("leaves natural-language requests untouched", () => {
    expect(classifyLynxCheckTrigger("please check lynx gateway ip")).toEqual({
      kind: "none",
      normalizedText: "please check lynx gateway ip",
    });
  });
  it("ignores other exploratory phrases", () => {
    expect(classifyLynxCheckTrigger("help me inspect openclaw service")).toEqual({
      kind: "none",
      normalizedText: "help me inspect openclaw service",
    });
  });
});
```

- [ ] **Step 2: Run the trigger test suite and watch it fail because keyword_request still exists**

```bash
npx vitest run test/lynx-check-trigger.test.ts
```
_Expected: Fails because `classifyLynxCheckTrigger` currently returns `keyword_request` for natural-language phrases instead of `none` and still captures more than the exact commands._

- [ ] **Step 3: Implement the minimal classifier change that satisfies the new tests**

```ts
export type LynxCheckTriggerKind = "none" | "native_passthrough" | "lynx_command";

export function classifyLynxCheckTrigger(text: string): LynxCheckTrigger {
  const rawNormalizedText = normalizeRawInput(text);
  if (!rawNormalizedText) {
    return { kind: "none", normalizedText: rawNormalizedText };
  }

  const normalizedText = normalizeInput(text);
  if (NATIVE_PASSTHROUGH.has(normalizedText)) {
    return { kind: "native_passthrough", normalizedText };
  }
  if (LYNX_COMMANDS.has(normalizedText)) {
    return { kind: "lynx_command", normalizedText };
  }
  return { kind: "none", normalizedText: rawNormalizedText };
}
```
_Keep `normalizeInput`/colon stripping for Feishu prefixes but drop all keyword_matching helpers so only the exact commands count._

- [ ] **Step 4: Run the trigger tests again and ensure they pass**

```bash
npx vitest run test/lynx-check-trigger.test.ts
```

- [ ] **Step 5: Stage the classifier files for the eventual module commit**

```bash
git add src/discovery/lynx-check-trigger.ts test/lynx-check-trigger.test.ts
```

### Task 2: Remove natural-language capture from message_received

**Files:**
- Modify: `test/plugin.test.ts`
- Modify: `index.ts`
- Test: `test/plugin.test.ts`

- [ ] **Step 1: Rewrite the integration assertions so only `/check` and `/lynx-check` are claimed**

```ts
it("should not trigger discovery for natural-language prompts anymore", async () => {
  setup(mockApi);
  const handler = handlers["message_received"];
  const sendMessage = vi.fn().mockResolvedValue(undefined);

  const result = await handler(
    { content: "please check lynx gateway ip" },
    { sessionKey: "sess-natural-request", sendMessage },
  );

  expect(result).toBeUndefined();
  expect(discovery.discoverOpenClaw).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
});
```
_Keep the existing `/check` bypass test and `/lynx-check` managed claim test but remove the keyword-focused expectations (no discovery send side effects)._

- [ ] **Step 2: Run the focused plugin tests to confirm the rewrite fails**

```bash
npx vitest run test/plugin.test.ts -t "should not trigger discovery for natural-language prompts anymore"
```
_Expected: Fails because the old `keyword_request` branch still invokes `runDiscoveryAndNotify`._

- [ ] **Step 3: Update `index.ts` so the message handler only reacts to the three forced trigger kinds**

```ts
if (lynxCheckTrigger.kind === "native_passthrough") {
  log.info(`Native check command passthrough: ${text}`);
  return;
}

if (lynxCheckTrigger.kind === "lynx_command") {
  log.info(`Managed /lynx-check command received: ${text}`);
  return;
}

// No keyword_request branch anymore; all other text flows through the normal pipeline
```
_Remove the `discovery.discoverOpenClaw`/`runDiscoveryAndNotify` block entirely so natural-language phrases keep flowing to the guard pipeline, but continue to log only when `/lynx-check` or `/check` appear._

- [ ] **Step 4: Rerun the plugin test suite to confirm everything is green**

```bash
npx vitest run test/plugin.test.ts -t "should not trigger discovery for natural-language prompts anymore"
```

- [ ] **Step 5: Stage the remaining files and capture the ready-to-commit state**

```bash
git add index.ts test/plugin.test.ts
```

