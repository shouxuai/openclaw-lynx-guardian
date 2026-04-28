import type {
  AgentStartEvent,
  BeforeDispatchEvent,
  BeforeMessageWriteEvent,
  BeforeToolCallResult,
  EventContext,
  LlmOutputEvent,
  MessageReceivedEvent,
  MessageSendingEvent,
  ToolCallEvent,
  ToolResultPersistEvent,
} from "../types.js";
import type { DecisionBroker } from "./decision-broker.js";
import type { DecisionContext } from "./decision-context.js";
import { nowDecisionContext } from "./decision-context.js";

export function handleMessageReceivedDecision(
  broker: DecisionBroker,
  event: MessageReceivedEvent,
  ctx: EventContext,
): void {
  broker.prefetchInputDecision(inputContext("message_received", extractContent(event.content), ctx));
}

export async function handleBeforeDispatchDecision(
  broker: DecisionBroker,
  event: BeforeDispatchEvent,
  ctx: EventContext,
  timeoutMs = 800,
): Promise<void | { handled: boolean; text?: string; block?: boolean; blockReason?: string }> {
  const decision = await broker.waitInputDecision(inputContext("before_dispatch", event.content, ctx), timeoutMs);
  if (decision.block) {
    return { handled: true, block: true, blockReason: decision.userMessage ?? "Blocked by Lynx Guardian decision control plane." };
  }
  return undefined;
}

export async function handleBeforeAgentStartDecision(
  broker: DecisionBroker,
  event: AgentStartEvent,
  ctx: EventContext,
  timeoutMs = 800,
): Promise<void | { block: boolean; blockReason?: string; prependContext?: string }> {
  const decision = await broker.waitInputDecision(inputContext("before_agent_start", extractAgentPrompt(event), ctx), timeoutMs);
  if (decision.block) {
    return { block: true, blockReason: decision.userMessage ?? "Blocked by Lynx Guardian decision control plane." };
  }
  if (decision.promptContext) {
    return { block: false, prependContext: decision.promptContext };
  }
  return undefined;
}

export function handleBeforePromptBuildDecision(
  broker: DecisionBroker,
  context: DecisionContext,
): void | { prependContext?: string } {
  const decision = broker.getCachedDecision(broker.cacheKey({ ...context, stage: "prompt_context" }));
  return decision?.promptContext ? { prependContext: decision.promptContext } : undefined;
}

export async function handleBeforeToolCallDecision(
  broker: DecisionBroker,
  event: ToolCallEvent,
  ctx: EventContext,
  timeoutMs = 1500,
): Promise<void | BeforeToolCallResult> {
  const decision = await broker.waitToolDecision(nowDecisionContext({
    stage: "tool_call",
    hook: "before_tool_call",
    sessionKey: ctx.sessionKey,
    content: JSON.stringify(event.params ?? {}),
    toolName: event.toolName,
    toolArgs: event.params,
    targetUri: JSON.stringify(event.params ?? {}),
  }), timeoutMs);
  if (decision.block) {
    return { block: true, blockReason: decision.userMessage ?? "Blocked by Lynx Guardian decision control plane." };
  }
  if (decision.requiresApproval || decision.action === "require_approval") {
    return {
      requireApproval: {
        title: decision.approvalRequest?.title ?? "Lynx Guardian approval required",
        description: decision.approvalRequest?.summary ?? decision.userMessage ?? "This tool call requires approval.",
        severity: decision.audit.eventSeverity === "critical" || decision.riskLevel === "L4" ? "critical" : "warning",
        timeoutBehavior: "deny",
      },
    };
  }
  return undefined;
}

export function handleAfterToolCallDecision(): void {}

export function handleToolResultPersistDecision(
  _broker: DecisionBroker,
  _event: ToolResultPersistEvent,
  _ctx: EventContext,
): void {
  return undefined;
}

export function handleBeforeMessageWriteDecision(
  _broker: DecisionBroker,
  _event: BeforeMessageWriteEvent,
  _ctx: EventContext,
): void {
  return undefined;
}

export function handleLlmOutputDecision(
  broker: DecisionBroker,
  event: LlmOutputEvent,
  ctx: EventContext,
): void {
  broker.prefetchOutputDecision(nowDecisionContext({
    stage: "assistant_output",
    hook: "llm_output",
    sessionKey: ctx.sessionKey,
    content: event.assistantTexts?.join("\n") ?? "",
  }));
}

export async function handleMessageSendingDecision(
  broker: DecisionBroker,
  event: MessageSendingEvent,
  ctx: EventContext,
  timeoutMs = 800,
): Promise<void | { cancel?: boolean; content?: string }> {
  const decision = await broker.waitOutboundDecision(nowDecisionContext({
    stage: "outbound_message",
    hook: "message_sending",
    sessionKey: ctx.sessionKey,
    content: event.content,
    targetUri: event.to,
  }), timeoutMs);
  if (decision.block) {
    return { cancel: true };
  }
  return undefined;
}

export async function handleBeforeInstallDecision(
  broker: DecisionBroker,
  context: DecisionContext,
  timeoutMs = 3000,
) {
  return broker.waitInstallDecision({ ...context, stage: "install" }, timeoutMs);
}

function inputContext(hook: string, content: string, ctx: EventContext): DecisionContext {
  return nowDecisionContext({
    stage: "input",
    hook,
    sessionKey: ctx.sessionKey,
    channelId: ctx.channelId,
    requesterId: ctx.userId ?? ctx.senderId,
    content,
  });
}

function extractContent(content: MessageReceivedEvent["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((block) => block.text ?? "").join(" ");
  }
  return String(content ?? "");
}

function extractAgentPrompt(event: AgentStartEvent): string {
  if (typeof event.prompt === "string") {
    return event.prompt;
  }
  if (Array.isArray(event.messages)) {
    return event.messages.map((message) => extractContent(message.content as any)).join(" ");
  }
  return JSON.stringify(event.prompt ?? "");
}
