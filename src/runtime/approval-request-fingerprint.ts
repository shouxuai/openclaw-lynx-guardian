import { createHash } from "crypto";
import type { ChannelProfile } from "./requester-provenance-store.js";

type ApprovalRequestFingerprintInput = {
  channelProfile?: ChannelProfile;
  accountId?: string;
  conversationId?: string;
  requesterOuId?: string;
  promptText?: string;
  toolName?: string;
  module?: string;
  protectedTargetSummary?: string;
};

function normalizeToken(value?: string): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePromptText(value?: string): string {
  return normalizeToken(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeProtectedTargetSummary(value?: string): string {
  return normalizeToken(value);
}

export function buildApprovalRequestFingerprint(input: ApprovalRequestFingerprintInput): string {
  const payload = {
    channelProfile: normalizeToken(input.channelProfile).toLowerCase(),
    accountId: normalizeToken(input.accountId),
    conversationId: normalizeToken(input.conversationId),
    requesterOuId: normalizeToken(input.requesterOuId),
    promptText: normalizePromptText(input.promptText),
    toolName: normalizeToken(input.toolName).toLowerCase(),
    module: normalizeToken(input.module),
    protectedTargetSummary: normalizeProtectedTargetSummary(input.protectedTargetSummary),
  };

  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}
