import { describe, expect, it } from "vitest";

import {
  PLUGIN_APPROVAL_EARLY_SUPPORT_END_VERSION,
  PLUGIN_APPROVAL_INTRO_VERSION,
  PLUGIN_APPROVAL_NATIVE_TRUST_VERSION,
  classifyPluginApprovalRuntime,
  resolvePluginApprovalCompat,
} from "../src/runtime/plugin-approval-compat.js";

describe("plugin approval compatibility", () => {
  it("classifies runtime versions into legacy, early-support, trusted, and unknown tiers", () => {
    expect(PLUGIN_APPROVAL_INTRO_VERSION).toBe("2026.3.28");
    expect(PLUGIN_APPROVAL_EARLY_SUPPORT_END_VERSION).toBe("2026.4.6");
    expect(PLUGIN_APPROVAL_NATIVE_TRUST_VERSION).toBe("2026.4.7");

    expect(classifyPluginApprovalRuntime("2026.3.27")).toEqual({
      runtimeVersion: "2026.3.27",
      tier: "legacy",
    });
    expect(classifyPluginApprovalRuntime("2026.4.1")).toEqual({
      runtimeVersion: "2026.4.1",
      tier: "early-support",
    });
    expect(classifyPluginApprovalRuntime("2026.4.7")).toEqual({
      runtimeVersion: "2026.4.7",
      tier: "trusted",
    });
    expect(classifyPluginApprovalRuntime(undefined)).toEqual({
      runtimeVersion: "unknown",
      tier: "unknown",
    });
  });

  it("keeps trusted webchat runtimes on native plugin approval", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.4.7",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "native-webchat",
      transport: "native",
      runtimeTier: "trusted",
    });
  });

  it("routes early-support webchat runtimes to feishu local approval when a feishu route exists", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.4.1",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: true,
        hasFeishuFallbackContext: true,
      }),
    ).toMatchObject({
      mode: "feishu-local",
      transport: "local-chat",
      runtimeTier: "early-support",
    });
  });

  it("fails closed on conservative runtimes without a feishu route", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.4.1",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
    });

    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: undefined,
        currentChannelProfile: "other",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
      runtimeTier: "unknown",
    });
  });
});
