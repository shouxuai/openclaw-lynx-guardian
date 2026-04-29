# Feishu Local Approval Prompt Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Feishu risky-tool approvals show a copyable `/lynx-approve <token> ...` prompt in the same chat and resume the blocked tool call after approval.

**Architecture:** Keep Lynx local approval as the Feishu-first path, but add a gateway `send` delivery fallback when hook contexts do not expose `sendMessage` or shared sender primitives. Reuse the existing gateway caller loader already used for WebChat injection so the fix stays plugin-local.

**Tech Stack:** TypeScript, Vitest, OpenClaw plugin runtime helpers, gateway CLI bridge

---

### Task 1: Lock the missing Feishu transport with tests

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts`

- [ ] **Step 1: Keep the new failing Feishu gateway-send approval test**

```ts
it('should deliver the Feishu /lynx-approve prompt through gateway send when hook contexts have no sendMessage transport', async () => {
  // blocked Feishu tool call with no sendMessage/resolveMessageTarget/sharedMessageSender
  // expects gateway "send" to deliver the prompt
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
npx vitest run test/plugin.test.ts -t "should deliver the Feishu /lynx-approve prompt through gateway send when hook contexts have no sendMessage transport"
```

Expected: FAIL because the tool call settles into native approval fallback before any gateway `send` prompt is issued.

### Task 2: Add a plugin-local gateway send helper

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-webchat-delivery.ts`

- [ ] **Step 1: Add a generic outbound text sender beside the existing WebChat injection helper**

```ts
export async function sendLynxChannelMessageViaGateway(options: {
  channel?: string;
  to?: string;
  accountId?: string;
  sessionKey?: string;
  threadId?: string | number;
  message: Message;
  timeoutMs?: number;
  idempotencyKey?: string;
}): Promise<void> {
  // extract text and call gateway "send"
}
```

- [ ] **Step 2: Keep the existing WebChat helper unchanged except for sharing the caller loader/text extraction helpers**

```ts
export async function injectLynxWebchatReportViaGateway(...) {
  // still calls "chat.inject"
}
```

### Task 3: Use gateway send as the Feishu/local approval fallback

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\src\runtime\lynx-message-delivery.ts`
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\index.ts`

- [ ] **Step 1: Add a non-WebChat gateway-send branch in delivery**

```ts
if (hasConcreteDeliveryTarget(candidate) && provider !== "webchat" && channel !== "webchat") {
  await sendLynxChannelMessageViaGateway({
    channel: candidate.channelId ?? candidate.messageProvider,
    to: candidate.to ?? candidate.bindingId,
    accountId: candidate.accountId,
    sessionKey: candidate.sessionKey,
    threadId: candidate.threadId,
    message: shapedMessage,
    idempotencyKey: `${options.tag}:${attempt}:${candidate.targetKey}`,
  });
}
```

- [ ] **Step 2: Pass through `routeHintSendMessage` in `sendAssistantMessageWithRetry`**

```ts
lastSendResult = await deliverLynxReport({
  ...,
  routeHintSendMessage: options.routeHintSendMessage,
});
```

- [ ] **Step 3: Add Feishu-specific logging in the local approval prompt path**

```ts
log.info(`[lynx-guardian] Local tool approval prompt gateway fallback available=${...}`);
```

### Task 4: Verify green locally

**Files:**
- Modify: `C:\Users\24716\.openclaw\extensions\openclaw-lynx-guardian\test\plugin.test.ts` if expectations need small adjustment only

- [ ] **Step 1: Re-run the focused Feishu approval test**

Run:

```powershell
npx vitest run test/plugin.test.ts -t "should deliver the Feishu /lynx-approve prompt through gateway send when hook contexts have no sendMessage transport"
```

Expected: PASS, with the blocked tool call still waiting until `/lynx-approve <token> allow-once` is received.

- [ ] **Step 2: Run the nearby approval regression slice**

Run:

```powershell
npx vitest run test/plugin.test.ts -t "Feishu"
```

Expected: existing Feishu local approval, shared delivery, owner `ou_id` validation, and native fallback tests remain green.

### Task 5: Real runtime validation

**Files:**
- No code changes expected

- [ ] **Step 1: Sync the plugin into the real OpenClaw runtime**

Run:

```powershell
node scripts/verify-dev-sync.mjs
.\scripts\sync-openclaw-dev-ready.ps1 --logs 200
```

- [ ] **Step 2: Validate through a real OpenClaw path**

Run one of:

```powershell
docker exec openclaw-openclaw-gateway-1 sh -lc "openclaw agent --agent main --message 'read USER.md' --json --timeout 90 2>&1"
```

or an authenticated POST to:

```text
http://127.0.0.1:18789/v1/chat/completions
```

Expected runtime proof:

- Feishu-triggered risky read sends a visible `/lynx-approve <token> ...` prompt in Feishu chat
- authorized `ou_id` approval resumes the blocked tool call
- WebChat native approval remains unchanged
