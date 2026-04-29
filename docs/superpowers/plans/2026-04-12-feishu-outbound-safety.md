# Feishu Outbound Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scheduled `/lynx-check` Feishu delivery safe by rewriting table-heavy and oversized outbound reports at the final `message_sending` hook.

**Architecture:** Keep report generation unchanged and add a final Feishu-safe shaping pass at outbound delivery. Extend the existing Feishu formatter in `src/runtime/lynx-message-delivery.ts`, then invoke it from `index.ts` inside `message_sending` so the hook is the last delivery guard and formatter.

**Tech Stack:** TypeScript, OpenClaw plugin hooks, Vitest

---

### Task 1: Add failing hook tests for Feishu outbound shaping

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: Write the failing test for table flattening at `message_sending`**

```ts
it("rewrites Feishu audit tables at message_sending", async () => {
  setup(mockApi);
  const handler = handlers["message_sending"];

  const result = await handler(
    {
      to: "user:ou_feishu",
      content: [
        "# 🛡️ OpenClaw 全方位安全审计报告",
        "总体评级：中高危",
        "",
        "## 一、执行摘要",
        "| 检查项 | 状态 |",
        "| --- | --- |",
        "| 网关暴露 | 未发现 |",
        "",
        "## 八、优先级整改建议",
        "1. 立即整改",
      ].join("\\n"),
    },
    {
      channelId: "feishu",
      accountId: "default",
    },
  );

  expect(result).toEqual({
    content: expect.any(String),
  });
  expect(result?.content).toContain("【飞书速览】总体评级：中高危");
  expect(result?.content).not.toContain("| 检查项 | 状态 |");
  expect(result?.content).toContain("检查项：网关暴露");
});
```

- [ ] **Step 2: Write the failing test for oversized outbound Feishu reports**

```ts
it("shortens oversized Feishu audit content at message_sending", async () => {
  setup(mockApi);
  const handler = handlers["message_sending"];
  const oversizedBody = new Array(120).fill("- 证据明细：abcdefghijklmnopqrstuvwxyz0123456789").join("\\n");

  const result = await handler(
    {
      to: "user:ou_feishu",
      content: [
        "# 🛡️ OpenClaw 全方位安全审计报告",
        "总体评级：中高危",
        "",
        "## 一、执行摘要",
        oversizedBody,
        "",
        "## 八、优先级整改建议",
        "1. 立即整改",
      ].join("\\n"),
    },
    {
      channelId: "feishu",
      accountId: "default",
    },
  );

  expect(result).toEqual({
    content: expect.any(String),
  });
  expect((result?.content as string).length).toBeLessThan(5000);
  expect(result?.content).toContain("总体评级：中高危");
  expect(result?.content).toContain("## 八、优先级整改建议");
  expect(result?.content).toContain("飞书安全缩略");
});
```

- [ ] **Step 3: Run the focused test file and confirm it fails for the new cases**

Run: `npx vitest run --exclude ".worktrees/**" test/plugin.test.ts -t "message_sending|Feishu"`
Expected: FAIL because `message_sending` currently does not rewrite outbound Feishu content.

### Task 2: Implement Feishu-safe outbound shaping

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-message-delivery.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`

- [ ] **Step 1: Extend the existing Feishu formatter with overflow reduction**

```ts
const FEISHU_AUDIT_MAX_CHARS = 4200;

function shortenFeishuAuditForSafety(text: string): string {
  if (text.length <= FEISHU_AUDIT_MAX_CHARS) {
    return text;
  }

  const remediationMatch = text.match(/##\s+八、优先级整改建议[\s\S]*$/m);
  const remediationSection = remediationMatch?.[0]?.trim() ?? "## 八、优先级整改建议\n1. 立即复核本次审计发现";
  const head = text.slice(0, FEISHU_AUDIT_MAX_CHARS / 2).trimEnd();

  return [
    head,
    "",
    "> 飞书安全缩略：正文过长，已保留首屏摘要与整改建议，避免消息卡片超限。",
    "",
    remediationSection,
  ].join("\n");
}
```

- [ ] **Step 2: Call the formatter from `message_sending` and return rewritten content**

```ts
api.on("message_sending", async (event, ctx) => {
  appendLifecycleProbe("message_sending", event, ctx);

  const providerCandidates = [
    normalizeString(ctx?.messageProvider),
    normalizeString(ctx?.channelId),
    normalizeString(ctx?.source),
  ].map((value) => value.toLowerCase());
  const isFeishu = providerCandidates.some((value) => value.includes("feishu"));

  if (isFeishu && typeof event.content === "string") {
    const shapedContent = shapeTextForProvider(event.content, "feishu");
    if (shapedContent !== event.content) {
      event.content = shapedContent;
      return { content: shapedContent };
    }
  }

  if (selfSafetyGuardConfig.outputGuard === false) return;
  const { guardContext } = buildManagedGuardContext(event, ctx);
  const decision = guardOutput(event.content, ctx.sessionKey, guardContext);
  if (decision.block) {
    return { cancel: true };
  }
});
```

- [ ] **Step 3: Run the focused tests and confirm they pass**

Run: `npx vitest run --exclude ".worktrees/**" test/plugin.test.ts -t "message_sending|Feishu"`
Expected: PASS

### Task 3: Verify the regression surface

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts` (no further edits expected if previous tasks pass)

- [ ] **Step 1: Run the broader plugin regression selection**

Run: `npx vitest run --exclude ".worktrees/**" test/plugin.test.ts test/scheduled-lynx-check.test.ts`
Expected: PASS

- [ ] **Step 2: Run type-check validation**

Run: `npx tsc --noEmit`
Expected: PASS
