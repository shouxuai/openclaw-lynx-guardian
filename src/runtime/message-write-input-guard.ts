import { guardInput, type GuardDecision } from "../guard/safety-guard.js";
import {
  createReplacementMessage,
  extractMessageText,
} from "./plugin-runtime-helpers.js";

export interface MessageWriteInputGuardResult {
  blocked: boolean;
  message?: any;
  decision?: GuardDecision;
  reason?: string;
}

export interface MessageWriteInputGuardOptions {
  sessionKey?: string;
  guardContext?: Record<string, unknown>;
}

export function guardInboundMessageBeforeWrite(
  message: any,
  options: MessageWriteInputGuardOptions = {},
): MessageWriteInputGuardResult {
  if (!message || message.role === "assistant") {
    return { blocked: false };
  }

  const text = extractMessageText(message);
  if (!text.trim()) {
    return { blocked: false };
  }

  const decision = guardInput(text, options.sessionKey, options.guardContext as any);
  if (!decision.block && decision.riskAssessment.level !== "L4") {
    return { blocked: false, decision };
  }

  const reason = decision.blockReason ?? decision.riskAssessment.description;
  return {
    blocked: true,
    decision,
    reason,
    message: createReplacementMessage(message, buildBlockedInputReplacement(decision, reason)),
  };
}

function buildBlockedInputReplacement(decision: GuardDecision, reason: string): string {
  return [
    `[Lynx Guardian] Inbound message blocked before transcript persistence.`,
    `Risk: ${decision.riskAssessment.level}, score=${decision.riskAssessment.score}.`,
    `Reason: ${reason}`,
    `The original protected request has been removed. Reply with a brief refusal only.`,
  ].join("\n");
}
