import type { DecisionRequest, DecisionStage } from "../../shared/src/decision.js";

export interface DecisionContext {
  stage: DecisionStage;
  hook: string;
  requestId?: string;
  sessionKey?: string;
  channelProfile?: string;
  channelId?: string;
  conversationId?: string;
  requesterId?: string;
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  targetUri?: string;
  chainSummary?: Record<string, unknown>;
  taintSummary?: Record<string, unknown>;
  providerSafety?: Record<string, unknown>;
  createdAt: string;
}

export function decisionRequestFromContext(context: DecisionContext): DecisionRequest {
  return {
    requestId: context.requestId ?? `${context.stage}-${Date.now()}`,
    stage: context.stage,
    hook: context.hook,
    sessionKey: context.sessionKey,
    channelProfile: context.channelProfile,
    channelId: context.channelId,
    conversationId: context.conversationId,
    requesterId: context.requesterId,
    content: context.content,
    toolName: context.toolName,
    toolArgs: context.toolArgs,
    targetUri: context.targetUri,
    chainSummary: context.chainSummary,
    taintSummary: context.taintSummary,
    providerSafety: context.providerSafety,
    createdAt: context.createdAt,
  };
}

export function nowDecisionContext(input: Omit<DecisionContext, "createdAt"> & { createdAt?: string }): DecisionContext {
  return {
    ...input,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
