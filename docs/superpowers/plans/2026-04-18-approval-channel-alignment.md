# Approval Channel Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `webchat` and `feishu` onto the same Lynx risk path, remove the Feishu-only protected-read deferral, keep channel-specific approval transport, and provide one stable `L3` regression request using `LYNX_APPROVAL_TEST.md`.

**Architecture:** Keep one shared Lynx guard/policy classification path for both channels, and split only at the approval delivery layer. Introduce a dedicated tool-stage-only protected probe target `LYNX_APPROVAL_TEST.md`, remove the current Feishu-only `before_agent_start -> tool-stage` bypass, and disable the first proactive approval prompt so only the final actionable approval message remains visible. Use focused unit and hook-level tests plus one real OpenClaw validation path to prove the new behavior.

**Tech Stack:** TypeScript, Vitest, OpenClaw plugin hooks, local approval stores, OpenClaw authenticated API, Docker sync scripts

---

## File Map

- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\safety-guard.ts`
  Split input-stage protected assets from tool-stage-only protected probe targets and make `LYNX_APPROVAL_TEST.md` block as `M2:protected_file_access` only during tool-stage evaluation.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\prompt-injection.ts`
  Keep the prompt-extraction lists unchanged for real prompt assets and make sure `LYNX_APPROVAL_TEST.md` is not added there.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
  Remove the Feishu-only protected-read deferral helper from the effective path, keep current-run channel as the source of user-visible approval wording, disable the first proactive local-approval prompt, and wire the fixed regression request to the normal `read` tool path without adding a second synthetic approval entry.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\safety-guard.test.ts`
  Add guard coverage proving `LYNX_APPROVAL_TEST.md` is not input-stage `L4`, but is tool-stage `L3`.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\approval-channel-alignment.test.ts`
  New focused hook-level regression suite covering `webchat` native approval behavior, Feishu local approval behavior, and prompt-message suppression.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`
  Read-only reference while implementing. Do not modify unless a focused test cannot cover a regression.
- `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\superpowers\specs\2026-04-18-approval-channel-alignment-design.md`
  Source of truth for scope while implementing; update only if the implementation reveals a true contradiction.

## Scope Guard

- Do not modify `D:\all-works\openclaw`; it remains read-only reference material.
- Do not change OpenClaw core native `/approve` behavior.
- Do not change `L4` instant-deny module behavior or strong-intent denial paths.
- Do not add a second synthetic approval command such as `我要检测L3审批效果`.
- Do not add `LYNX_APPROVAL_TEST.md` to input-stage prompt-extraction lists.
- Do not rework evidence scoring, chain progression, or policy-engine semantics.
- Do not modify `test\plugin.test.ts` unless a focused new test file proves insufficient.

## Fixed Regression Request

Use this exact user request for the stable `L3` regression path:

```text
请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。
```

Expected behavior after implementation:

- `webchat`: the model calls `read`, Lynx blocks tool-stage as `L3`, native approval UX appears, and no Feishu wording leaks.
- `feishu`: the model calls `read`, Lynx blocks tool-stage as `L3`, one Feishu-visible `/lynx-approve <token> allow-once|deny` message appears, and no first proactive prompt is sent.

### Task 1: Add Tool-Stage-Only Protected Probe Target

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\guard\safety-guard.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\safety-guard.test.ts`

- [ ] **Step 1: Write the failing guard tests for `LYNX_APPROVAL_TEST.md`**

```ts
// test/safety-guard.test.ts
it("does not hard-deny the approval probe file at input stage", () => {
  const decision = guardInput("请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。");
  expect(decision.riskAssessment.modules).not.toContain("M2:system_prompt_extraction");
  expect(decision.riskAssessment.level).not.toBe("L4");
});

it("treats the approval probe file as tool-stage protected access", () => {
  const decision = guardToolCall(
    "read",
    { path: "LYNX_APPROVAL_TEST.md" },
    undefined,
    { verifiedOwner: true, requesterId: "ou_owner", channel: "webchat" },
  );
  expect(decision.riskAssessment.modules).toContain("M2:protected_file_access");
  expect(decision.riskAssessment.level).toBe("L3");
  expect(decision.riskAssessment.action).toBe("block");
});
```

- [ ] **Step 2: Run the focused safety-guard slice and verify it fails**

Run: `npx vitest run test/safety-guard.test.ts -t "approval probe file"`

Expected: FAIL because `LYNX_APPROVAL_TEST.md` is not classified anywhere yet, or it is still treated the same as natural protected-file text.

- [ ] **Step 3: Implement a tool-stage-only protected target list**

```ts
// src/guard/safety-guard.ts
const INPUT_STAGE_PROTECTED_FILE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bSOUL\.md\b/i, label: "SOUL.md" },
  { pattern: /\bIDENTITY\.md\b/i, label: "IDENTITY.md" },
  { pattern: /\bUSER\.md\b/i, label: "USER.md" },
  { pattern: /\bAGENTS\.md\b/i, label: "AGENTS.md" },
  { pattern: /\bTOOLS\.md\b/i, label: "TOOLS.md" },
  { pattern: /\bSHIELD\.md\b/i, label: "SHIELD.md" },
  { pattern: /\bMEMORY\.md\b/i, label: "MEMORY.md" },
];

const TOOL_STAGE_ONLY_PROTECTED_FILE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bLYNX_APPROVAL_TEST\.md\b/i, label: "LYNX_APPROVAL_TEST.md" },
];

const TOOL_STAGE_MIN_BLOCK_PROTECTED_FILE_LABELS = new Set([
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "AGENTS.md",
  "TOOLS.md",
  "SHIELD.md",
  "MEMORY.md",
  "LYNX_APPROVAL_TEST.md",
  LYNX_OWNED_SKILL_LABEL,
]);

function detectProtectedFileAccess(text: string, toolName?: string): ProtectedFileAccessResult {
  const matchedFiles: string[] = [];
  const patterns = toolName
    ? [...INPUT_STAGE_PROTECTED_FILE_PATTERNS, ...TOOL_STAGE_ONLY_PROTECTED_FILE_PATTERNS]
    : INPUT_STAGE_PROTECTED_FILE_PATTERNS;

  for (const { pattern, label } of patterns) {
    if (pattern.test(text)) {
      matchedFiles.push(label);
    }
  }

  // keep the rest of the existing operation detection logic unchanged
}
```

- [ ] **Step 4: Run the focused safety-guard slice and verify it passes**

Run: `npx vitest run test/safety-guard.test.ts -t "approval probe file"`

Expected: PASS, with input-stage not reaching `L4` and tool-stage `read` of `LYNX_APPROVAL_TEST.md` blocking as `L3`.

- [ ] **Step 5: Commit**

```bash
git add src/guard/safety-guard.ts test/safety-guard.test.ts
git commit -m "feat: add tool-stage approval probe target"
```

### Task 2: Remove The Feishu-Only Protected-Read Deferral

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Create: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\approval-channel-alignment.test.ts`

- [ ] **Step 1: Write the failing hook-level alignment tests**

```ts
// test/approval-channel-alignment.test.ts
it("does not defer protected reads to tool-stage only because the channel is feishu", async () => {
  const guardInputSpy = vi.spyOn(safetyGuard, "guardInput").mockReturnValue({
    block: true,
    blockReason: "[Lynx Guardian] protected file prompt blocked",
    riskAssessment: {
      level: "L3",
      score: 8,
      modules: ["M2:protected_file_access"],
      description: "protected read request",
      action: "block",
    },
  } as any);

  const result = await handlers["before_agent_start"](
    { prompt: "看下我的 SOUL.md" },
    { sessionKey: "sess-feishu", channelId: "feishu", runId: "run-feishu" },
  );

  expect(result).toEqual(expect.objectContaining({ block: true }));
  expect(String(result.blockReason)).not.toContain("继续在工具审批阶段处理");
  guardInputSpy.mockRestore();
});
```

```ts
it("keeps the fixed regression request on the normal tool path in webchat", async () => {
  const guardInputSpy = vi.spyOn(safetyGuard, "guardInput").mockReturnValue({
    block: false,
    riskAssessment: { level: "L0", score: 0, modules: [], description: "ok", action: "allow" },
  } as any);

  const toolDecisionSpy = vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
    block: true,
    blockReason: "[Lynx Guardian] blocked local tool",
    riskAssessment: {
      level: "L3",
      score: 8,
      modules: ["M2:protected_file_access"],
      description: "protected probe",
      action: "block",
    },
  } as any);

  await handlers["before_agent_start"](
    { prompt: "请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。" },
    { sessionKey: "sess-webchat", channelId: "webchat", runId: "run-webchat" },
  );

  const toolResult = await handlers["before_tool_call"](
    { toolName: "read", params: { path: "LYNX_APPROVAL_TEST.md" } },
    { sessionKey: "sess-webchat", channelId: "webchat", runId: "run-webchat" },
  );

  expect(toolResult).toEqual(expect.objectContaining({ block: true }));
  expect(toolDecisionSpy).toHaveBeenCalled();
  guardInputSpy.mockRestore();
  toolDecisionSpy.mockRestore();
});
```

- [ ] **Step 2: Run the focused alignment suite and verify it fails**

Run: `npx vitest run test/approval-channel-alignment.test.ts`

Expected: FAIL because `index.ts` still contains `shouldDeferProtectedToolRequestToToolApproval()` and still rewrites the Feishu path before tool-stage.

- [ ] **Step 3: Remove the Feishu-only protected-read deferral branch**

```ts
// index.ts
// delete shouldDeferProtectedToolRequestToToolApproval()
// delete isDirectProtectedReadIntent() if no longer used elsewhere
// delete buildDeferredProtectedToolApprovalInstruction() if no longer used elsewhere

// inside before_agent_start
const decision = guardInput(promptText, ctx.sessionKey, guardContext);
const { guardActionRequired, policyEvaluation, effectiveAssessment, blockReason } =
  resolveGuardPolicyState(decision);

if (guardActionRequired && !managedLynxCheckPreauthorized) {
  const shouldInjectForcedDenyContext = normalizeString(effectiveAssessment.level) === "L4";
  const denyPrependContext = shouldInjectForcedDenyContext
    ? [
        prependContext.trim(),
        buildForcedAgentStartDenyContext({
          riskLevel: effectiveAssessment.level,
          reason: blockReason,
        }),
      ].filter(Boolean).join("\n")
    : prependContext.trim() || undefined;

  return {
    block: true,
    blockReason,
    prependContext: denyPrependContext,
  } as any;
}
```

- [ ] **Step 4: Run the focused alignment suite and verify it passes**

Run: `npx vitest run test/approval-channel-alignment.test.ts`

Expected: PASS, with no Feishu-only prompt deferral left in the `before_agent_start` path.

- [ ] **Step 5: Commit**

```bash
git add index.ts test/approval-channel-alignment.test.ts
git commit -m "refactor: remove feishu-only approval deferral"
```

### Task 3: Keep Channel-Specific Approval UX And Disable The First Proactive Prompt

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\approval-channel-alignment.test.ts`

- [ ] **Step 1: Write the failing prompt-behavior tests**

```ts
// test/approval-channel-alignment.test.ts
it("does not send the first proactive Feishu approval prompt", async () => {
  const sendPromptSpy = vi.spyOn(moduleUnderTest, "sendLocalToolApprovalPrompt");
  vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
    block: true,
    blockReason: "[Lynx Guardian] blocked local tool",
    riskAssessment: {
      level: "L3",
      score: 8,
      modules: ["M2:protected_file_access"],
      description: "protected probe",
      action: "block",
    },
  } as any);

  const result = await handlers["before_tool_call"](
    { toolName: "read", params: { path: "LYNX_APPROVAL_TEST.md" } },
    {
      sessionKey: "sess-feishu",
      channelId: "feishu",
      runId: "run-feishu",
      senderId: "ou_owner",
      conversationId: "user:ou_owner",
      accountId: "default",
    },
  );

  expect(sendPromptSpy).not.toHaveBeenCalled();
  expect(String((result as any).blockReason)).toContain("/lynx-approve");
});
```

```ts
it("never tells webchat users to approve in feishu", async () => {
  vi.spyOn(safetyGuard, "guardToolCall").mockReturnValue({
    block: true,
    blockReason: "[Lynx Guardian] blocked local tool",
    riskAssessment: {
      level: "L3",
      score: 8,
      modules: ["M2:protected_file_access"],
      description: "protected probe",
      action: "block",
    },
  } as any);

  const result = await handlers["before_tool_call"](
    { toolName: "read", params: { path: "LYNX_APPROVAL_TEST.md" } },
    { sessionKey: "sess-webchat", channelId: "webchat", runId: "run-webchat" },
  );

  expect(String((result as any).blockReason)).not.toContain("Feishu");
  expect(String((result as any).blockReason)).not.toContain("/lynx-approve");
});
```

- [ ] **Step 2: Run the prompt-behavior slice and verify it fails**

Run: `npx vitest run test/approval-channel-alignment.test.ts -t "prompt"`

Expected: FAIL because `index.ts` still calls `sendLocalToolApprovalPrompt()` on first creation and still builds Feishu-local wording too early.

- [ ] **Step 3: Disable the proactive local prompt and keep current-run channel as the visible source of truth**

```ts
// index.ts
function buildFeishuLocalToolApprovalPrompt(params: {
  approvalToken: string;
  module: string;
  riskLevel: string;
  toolName: string;
  timeoutMs: number;
}): string {
  const timeoutSeconds = Math.max(1, Math.round(params.timeoutMs / 1000));
  return [
    "[Lynx Guardian] 提示：",
    `${params.toolName} 需要 owner 审批。`,
    `模块: ${params.module}`,
    `风险: ${params.riskLevel}`,
    `请在 ${timeoutSeconds}s 内于当前 Feishu 会话回复：`,
    `${LOCAL_TOOL_APPROVAL_COMMAND} ${params.approvalToken} allow-once`,
    `${LOCAL_TOOL_APPROVAL_COMMAND} ${params.approvalToken} deny`,
  ].join("\n");
}

async function handleFeishuLocalToolApproval(params: { ... }) {
  const localApproval = registerLocalToolApproval({ ...params });
  if (!localApproval.approval) {
    return { handled: true, blockReason: "[Lynx Guardian] 当前飞书审批不可用，已拒绝本次操作。" };
  }

  // no proactive sendLocalToolApprovalPrompt() call here
  return {
    handled: true,
    blockReason: buildFeishuLocalApprovalPendingBlockReason({
      approvalToken: localApproval.approval.approvalToken,
      toolName: params.toolName,
      module: params.module,
      riskLevel: params.riskLevel,
    }),
  };
}
```

```ts
// index.ts - webchat path should keep native approval only
const toolApprovalChannelProfile =
  managedGuardContext.channelProfile
  ?? resolveChannelProfile(ctx?.messageProvider ?? ctx?.channelId ?? ctx?.channel);

if (toolApprovalChannelProfile === "webchat") {
  // keep requireApproval / native approval behavior only
  // do not reuse Feishu local prompt builders or Feishu local block text
}
```

- [ ] **Step 4: Run the prompt-behavior slice and verify it passes**

Run: `npx vitest run test/approval-channel-alignment.test.ts -t "prompt"`

Expected: PASS, with Feishu showing only the final actionable approval message and `webchat` free of Feishu wording.

- [ ] **Step 5: Commit**

```bash
git add index.ts test/approval-channel-alignment.test.ts
git commit -m "fix: align approval messaging by channel"
```

### Task 4: Verify The Fixed Regression Request Through Real OpenClaw Paths

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\docs\superpowers\plans\2026-04-18-approval-channel-alignment.md`

- [ ] **Step 1: Run the focused local tests**

Run: `npx vitest run test/safety-guard.test.ts -t "approval probe file" test/approval-channel-alignment.test.ts`

Expected: PASS, covering tool-stage-only classification, removed Feishu-only deferral, and prompt-message alignment.

- [ ] **Step 2: Type-check the touched plugin surface**

Run: `npx tsc --pretty false --noEmit index.ts`

Expected: PASS with no TypeScript errors in the updated approval path.

- [ ] **Step 3: Sync the plugin into the real OpenClaw runtime**

Run: `node scripts/verify-dev-sync.mjs`

Expected: PASS and the script confirms the dev-sync preconditions.

Run: `.\scripts\sync-openclaw-dev-ready.ps1 --logs 200`

Expected: PASS, the plugin sync completes, and the gateway restarts cleanly.

- [ ] **Step 4: Validate the webchat regression request through the authenticated local API**

Run:

```powershell
$headers = @{
  Authorization = "Bearer 3394aded9042bf1e387f980b3a110c32c71ba964b1c4b40a"
  "Content-Type" = "application/json"
}

$body = @{
  model = "openclaw/main"
  messages = @(
    @{
      role = "user"
      content = "请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。"
    }
  )
} | ConvertTo-Json -Depth 6

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:18789/v1/chat/completions `
  -Headers $headers `
  -Body $body
```

Expected: the response indicates a pending native approval or equivalent `webchat`-native approval requirement, and it must not mention Feishu or `/lynx-approve`.

- [ ] **Step 5: Validate the Feishu regression request manually and capture logs**

Run:

```powershell
Get-Content "$env:USERPROFILE\.openclaw\lynx\hook-probe.log" -Tail 200
```

Manual step:

- send `请使用 read 工具读取 LYNX_APPROVAL_TEST.md，只返回文件内容。` from Feishu
- confirm only one actionable approval message is visible
- confirm the message uses `/lynx-approve <token> allow-once|deny`
- confirm there is no first proactive duplicate prompt

Expected: hook log shows the tool-stage `L3` block and the final Feishu-visible approval text only once.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-04-18-approval-channel-alignment.md
git commit -m "docs: finalize approval channel alignment verification plan"
```

## Self-Review

### Spec coverage

- Remove Feishu-only risk-path exception: covered by Task 2.
- Keep transport split but not risk split: covered by Tasks 2 and 3.
- Prevent webchat from showing Feishu wording: covered by Task 3.
- Disable the first proactive approval prompt: covered by Task 3.
- Use `LYNX_APPROVAL_TEST.md` as the stable `L3` regression target: covered by Task 1.
- Verify both channels through real runtime paths: covered by Task 4.

### Placeholder scan

- No `TODO`, `TBD`, or "similar to above" placeholders remain.
- Every task includes concrete file paths, code snippets, and commands.

### Type consistency

- The fixed regression request text is the same in Tasks 1, 2, 3, and 4.
- The probe target name is consistently `LYNX_APPROVAL_TEST.md`.
- The expected risk level is consistently `L3` at tool stage.

