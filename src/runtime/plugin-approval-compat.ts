import {
  getOpenClawRuntimeVersion,
  isVersionAtLeast,
} from "./hook-capabilities.js";

export const PLUGIN_APPROVAL_INTRO_VERSION = "2026.3.28";

export type PluginApprovalCompatTier =
  | "legacy"
  | "modern"
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
  return { runtimeVersion: normalized, tier: "modern" };
}

function buildNoRouteReason(tier: PluginApprovalCompatTier): string {
  if (tier === "unknown") {
    return "[Lynx Guardian] OpenClaw version could not be identified safely and no Feishu approval route is configured, so this request is blocked. Upgrade OpenClaw or configure Feishu approval.";
  }
  return "[Lynx Guardian] OpenClaw is below 2026.3.28 and no Feishu approval route is configured, so this request is blocked. Upgrade OpenClaw or configure Feishu approval.";
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

  if (runtime.tier === "modern" && params.currentChannelProfile === "webchat") {
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
