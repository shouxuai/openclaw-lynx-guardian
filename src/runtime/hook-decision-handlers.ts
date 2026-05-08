import type {
  AgentStartEvent,
  BeforeDispatchEvent,
  BeforeToolCallResult,
  BeforeMessageWriteEvent,
  EventContext,
  LlmOutputEvent,
  MessageReceivedEvent,
  MessageSendingEvent,
  ToolCallEvent,
  ToolResultPersistEvent,
} from "../types.js";
import type { DecisionResponse } from "../../shared/src/decision.js";
import type { DecisionBroker } from "./decision-broker.js";
import type { DecisionContext } from "./decision-context.js";
import { nowDecisionContext } from "./decision-context.js";
import { compactNativeApprovalDescription } from "../approval/native-approval-description.js";
import {
  buildToolApprovalDetailDescription,
  resolveToolApprovalProtectedTargetSummary,
  resolveToolApprovalScopeType,
} from "../approval/approval-prompts.js";

const TOOL_DECISION_METADATA_KEY = "__lynxDecision";

export function readBeforeToolCallDecisionMetadata(
  result: void | BeforeToolCallResult,
): DecisionResponse | undefined {
  const record = result as (BeforeToolCallResult & { [TOOL_DECISION_METADATA_KEY]?: DecisionResponse }) | undefined;
  return record?.[TOOL_DECISION_METADATA_KEY];
}

function attachBeforeToolCallDecisionMetadata<T extends void | BeforeToolCallResult>(
  result: T,
  decision: DecisionResponse,
): T {
  if (result && typeof result === "object") {
    Object.defineProperty(result, TOOL_DECISION_METADATA_KEY, {
      value: decision,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return result;
}

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
  const installContext = skillInstallDecisionContext(event, ctx);
  if (installContext) {
    const decision = await broker.waitInstallDecision(installContext, timeoutMs);
    return decisionToBeforeToolCallResult(
      decision,
      "Blocked by Lynx Guardian install decision.",
      "Lynx Guardian install approval required",
      buildInstallApprovalFallbackDescription(event, decision),
    );
  }

  const eventWithEvidence = event as ToolCallEvent & {
    scriptEvidence?: DecisionContext["scriptEvidence"];
    resourceEvidence?: DecisionContext["resourceEvidence"];
    policyVersion?: DecisionContext["policyVersion"];
  };
  const decision = await broker.waitToolDecision(nowDecisionContext({
    stage: "tool_call",
    hook: "before_tool_call",
    sessionKey: ctx.sessionKey,
    runId: optionalString(event.runId) ?? optionalString(ctx.runId),
    content: JSON.stringify(event.params ?? {}),
    toolName: event.toolName,
    toolArgs: event.params,
    targetUri: JSON.stringify(event.params ?? {}),
    scriptEvidence: eventWithEvidence.scriptEvidence,
    resourceEvidence: eventWithEvidence.resourceEvidence,
    policyVersion: eventWithEvidence.policyVersion,
  }), timeoutMs);
  return attachBeforeToolCallDecisionMetadata(
    decisionToBeforeToolCallResult(
      decision,
      "Blocked by Lynx Guardian decision control plane.",
      "Lynx Guardian approval required",
      buildToolDecisionApprovalFallbackDescription(event, decision),
    ),
    decision,
  );
}

function decisionToBeforeToolCallResult(
  decision: Awaited<ReturnType<DecisionBroker["waitToolDecision"]>>,
  blockFallback: string,
  approvalFallbackTitle: string,
  approvalFallbackDescription: string,
): void | BeforeToolCallResult {
  if (decisionRequiresHardBlock(decision)) {
    return { block: true, blockReason: decision.userMessage ?? blockFallback };
  }
  if (decision.requiresApproval || decision.action === "require_approval") {
    return {
      requireApproval: {
        title: decision.approvalRequest?.title ?? approvalFallbackTitle,
        description: buildNativeApprovalDescription(decision, approvalFallbackDescription),
        severity: decision.audit.eventSeverity === "critical" || decision.riskLevel === "L4" ? "critical" : "warning",
        timeoutBehavior: "deny",
      },
    };
  }
  return undefined;
}

function buildToolDecisionApprovalFallbackDescription(
  event: ToolCallEvent,
  decision: { riskLevel?: string; userMessage?: string },
): string {
  const reason = decision.userMessage ?? "Lynx Guardian 需要你确认这次工具调用";
  const detail = buildToolApprovalDetailDescription({
    reason,
    toolName: event.toolName,
    protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(event.toolName, event.params as any),
    scopeType: resolveToolApprovalScopeType(event.toolName),
  });
  return `${detail}；风险等级：${decision.riskLevel ?? "unknown"}`;
}

function buildInstallApprovalFallbackDescription(
  event: ToolCallEvent,
  decision: { riskLevel?: string; userMessage?: string },
): string {
  const reason = decision.userMessage ?? "Lynx Guardian 需要你确认这次安装或插件变更";
  const detail = buildToolApprovalDetailDescription({
    reason,
    toolName: event.toolName,
    protectedTargetSummary: resolveToolApprovalProtectedTargetSummary(event.toolName, event.params as any),
    scopeType: "singleTool",
  });
  return `${detail}；风险等级：${decision.riskLevel ?? "unknown"}`;
}

function decisionRequiresHardBlock(decision: {
  action?: string;
  block?: boolean;
  riskLevel?: string;
}): boolean {
  return decision.block === true
    || decision.riskLevel === "L4"
    || decision.action === "block"
    || decision.action === "deny";
}

function skillInstallDecisionContext(event: ToolCallEvent, ctx: EventContext): DecisionContext | null {
  const params = event.params ?? {};
  const command = typeof params.command === "string" ? params.command : "";
  const path = typeof params.file_path === "string"
    ? params.file_path
    : typeof params.path === "string"
      ? params.path
      : "";
  const looksLikeSkillInstall =
    /\bopenclaw\s+(?:plugins?\s+)?install\b/i.test(command)
    || (/\bgit\s+clone\b/i.test(command) && /\.openclaw[\\/]skills[\\/]/i.test(command))
    || (/\b(?:cp|rsync)\b/i.test(command) && /\.openclaw[\\/]skills[\\/]/i.test(command))
    || /\.openclaw[\\/]skills[\\/]/i.test(path);

  if (!looksLikeSkillInstall) {
    return null;
  }

  return nowDecisionContext({
    stage: "install",
    hook: "before_install",
    sessionKey: ctx.sessionKey,
    runId: optionalString(ctx.runId),
    channelId: ctx.channelId,
    requesterId: ctx.userId ?? ctx.senderId,
    content: JSON.stringify(params),
    toolName: event.toolName,
    toolArgs: params,
    targetUri: path || command,
  });
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
    runId: optionalString(event.runId) ?? optionalString(ctx.runId),
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
    runId: optionalString(ctx.runId),
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

export async function handleBeforeInstallEventDecision(
  broker: DecisionBroker,
  event: Record<string, unknown>,
  ctx: EventContext,
  timeoutMs = 3000,
): Promise<void | BeforeToolCallResult> {
  const source = extractInstallSource(event);
  const name = extractInstallName(event);
  const decision = await handleBeforeInstallDecision(broker, nowDecisionContext({
    stage: "install",
    hook: "before_install",
    sessionKey: ctx.sessionKey,
    runId: optionalString(ctx.runId),
    channelId: ctx.channelId,
    requesterId: ctx.userId ?? ctx.senderId,
    content: JSON.stringify(event ?? {}),
    toolName: "skill_install",
    toolArgs: event,
    targetUri: source ?? name,
  }), timeoutMs);
  if (decisionRequiresHardBlock(decision)) {
    return { block: true, blockReason: decision.userMessage ?? "Blocked by Lynx Guardian install decision." };
  }
  if (decision.requiresApproval || decision.action === "require_approval") {
    return {
      requireApproval: {
        title: decision.approvalRequest?.title ?? "Lynx Guardian install approval required",
        description: buildNativeApprovalDescription(
          decision,
          "原因：Lynx Guardian 需要你确认这次安装或插件变更；批准范围：仅本次安装动作",
        ),
        severity: decision.audit.eventSeverity === "critical" || decision.riskLevel === "L4" ? "critical" : "warning",
        timeoutBehavior: "deny",
      },
    };
  }
  return undefined;
}

function buildNativeApprovalDescription(
  decision: { approvalRequest?: { summary?: string }; userMessage?: string },
  fallback: string,
): string {
  return compactNativeApprovalDescription(
    decision.approvalRequest?.summary ?? decision.userMessage ?? fallback,
  ) || fallback;
}

function inputContext(hook: string, content: string, ctx: EventContext): DecisionContext {
  return nowDecisionContext({
    stage: "input",
    hook,
    sessionKey: ctx.sessionKey,
    runId: optionalString(ctx.runId),
    channelId: ctx.channelId,
    requesterId: ctx.userId ?? ctx.senderId,
    content,
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function extractInstallSource(event: Record<string, unknown>): string | undefined {
  const value = event.source ?? event.url ?? event.installSource ?? event.registry;
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractInstallName(event: Record<string, unknown>): string | undefined {
  const value = event.name ?? event.skillName ?? event.id;
  return typeof value === "string" && value.trim() ? value : undefined;
}
