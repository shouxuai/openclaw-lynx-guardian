import {
  getOpenClawRuntimeVersion,
  isVersionAtLeast,
} from "./hook-capabilities.js";

export const PLUGIN_APPROVAL_INTRO_VERSION = "2026.3.28";
export const PLUGIN_APPROVAL_EARLY_SUPPORT_END_VERSION = "2026.4.6";
export const PLUGIN_APPROVAL_NATIVE_TRUST_VERSION = "2026.4.7";

export type PluginApprovalCompatTier =
  | "legacy"
  | "early-support"
  | "trusted"
  | "unknown";

export type PluginApprovalCompatMode =
  | "native-webchat"
  | "feishu-local"
  | "deny-no-route";

export type PluginApprovalCompatDecision = {
  runtimeVersion: string;
  runtimeTier: PluginApprovalCompatTier;
  mode: PluginApprovalCompatMode;
  transport: "native" | "local-chat" | "none";
  blockReason?: string;
};

export function classifyPluginApprovalRuntime(
  runtimeVersion?: string,
): { runtimeVersion: string; tier: PluginApprovalCompatTier } {
  const sourceVersion =
    arguments.length === 0 ? getOpenClawRuntimeVersion() : runtimeVersion;
  const normalized = sourceVersion?.trim();
  if (!normalized) {
    return { runtimeVersion: "unknown", tier: "unknown" };
  }
  if (!isVersionAtLeast(normalized, PLUGIN_APPROVAL_INTRO_VERSION)) {
    return { runtimeVersion: normalized, tier: "legacy" };
  }

  const isInEarlySupportWindow =
    isVersionAtLeast(normalized, PLUGIN_APPROVAL_INTRO_VERSION) &&
    isVersionAtLeast(PLUGIN_APPROVAL_EARLY_SUPPORT_END_VERSION, normalized);

  if (isInEarlySupportWindow) {
    return { runtimeVersion: normalized, tier: "early-support" };
  }

  if (isVersionAtLeast(normalized, PLUGIN_APPROVAL_NATIVE_TRUST_VERSION)) {
    return { runtimeVersion: normalized, tier: "trusted" };
  }

  return { runtimeVersion: normalized, tier: "early-support" };
}

function buildNoRouteReason(tier: PluginApprovalCompatTier): string {
  if (tier === "early-support") {
    return "[Lynx Guardian] OpenClaw is in the early plugin-approval support window and native approval is not trusted by default. No Feishu approval route is configured, so this request is blocked. Upgrade OpenClaw or configure Feishu approval.";
  }
  return "[Lynx Guardian] OpenClaw does not provide a trusted plugin-approval path and no Feishu approval route is configured, so this request is blocked. Upgrade OpenClaw or configure Feishu approval.";
}

export function resolvePluginApprovalCompat(params: {
  runtimeVersion?: string;
  currentChannelProfile: "webchat" | "feishu" | "other";
  hasFeishuApproverRoute: boolean;
  hasFeishuFallbackContext: boolean;
}): PluginApprovalCompatDecision {
  const runtime =
    params.runtimeVersion === undefined
      ? classifyPluginApprovalRuntime()
      : classifyPluginApprovalRuntime(params.runtimeVersion);

  if (params.currentChannelProfile === "feishu") {
    if (params.hasFeishuApproverRoute) {
      return {
        runtimeVersion: runtime.runtimeVersion,
        runtimeTier: runtime.tier,
        mode: "feishu-local",
        transport: "local-chat",
      };
    }
    return {
      runtimeVersion: runtime.runtimeVersion,
      runtimeTier: runtime.tier,
      mode: "deny-no-route",
      transport: "none",
      blockReason:
        "[Lynx Guardian] This request requires Feishu local approval, but no Feishu approver route is configured.",
    };
  }

  if (runtime.tier === "trusted" && params.currentChannelProfile === "webchat") {
    return {
      runtimeVersion: runtime.runtimeVersion,
      runtimeTier: runtime.tier,
      mode: "native-webchat",
      transport: "native",
    };
  }

  if (params.hasFeishuApproverRoute && params.hasFeishuFallbackContext) {
    return {
      runtimeVersion: runtime.runtimeVersion,
      runtimeTier: runtime.tier,
      mode: "feishu-local",
      transport: "local-chat",
    };
  }

  return {
    runtimeVersion: runtime.runtimeVersion,
    runtimeTier: runtime.tier,
    mode: "deny-no-route",
    transport: "none",
    blockReason: buildNoRouteReason(runtime.tier),
  };
}
