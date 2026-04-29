import { createHash } from "crypto";
import type { ChannelProfile } from "../runtime/requester-provenance-store.js";

export interface ApprovalFingerprintInput {
  sessionKey?: string;
  toolName?: string;
  command?: string;
  targetUri?: string;
  requesterId?: string;
  channelId?: string;
  channelProfile?: ChannelProfile;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  promptText?: string;
  module?: string;
  protectedTargetSummary?: string;
}

function normalizeToken(value?: string): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePromptText(value?: string): string {
  return normalizeToken(value).replace(/\s+/g, " ").toLowerCase();
}

export function buildApprovalRequestFingerprint(input: ApprovalFingerprintInput): string {
  const payload = {
    sessionKey: normalizeToken(input.sessionKey),
    channelProfile: normalizeToken(input.channelProfile).toLowerCase(),
    channelId: normalizeToken(input.channelId),
    accountId: normalizeToken(input.accountId),
    conversationId: normalizeToken(input.conversationId),
    requesterId: normalizeToken(input.requesterId),
    requesterOuId: normalizeToken(input.requesterOuId),
    promptText: normalizePromptText(input.promptText ?? input.command),
    toolName: normalizeToken(input.toolName).toLowerCase(),
    module: normalizeToken(input.module),
    targetUri: normalizeToken(input.targetUri),
    protectedTargetSummary: normalizeToken(input.protectedTargetSummary),
  };

  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}
