import { describe, expect, it } from "vitest";

import {
  PLUGIN_APPROVAL_INTRO_VERSION,
  classifyPluginApprovalRuntime,
  resolvePluginApprovalCompat,
} from "../src/runtime/plugin-approval-compat.js";

describe("plugin approval compatibility", () => {
  it("exposes the plugin approval compatibility boundary constant", () => {
    expect(PLUGIN_APPROVAL_INTRO_VERSION).toBe("2026.3.28");
  });

  it("classifies runtime versions into legacy, modern, and unknown tiers", () => {
    expect(classifyPluginApprovalRuntime("2026.3.27")).toEqual({
      runtimeVersion: "2026.3.27",
      tier: "legacy",
    });
    expect(classifyPluginApprovalRuntime("2026.3.28")).toEqual({
      runtimeVersion: "2026.3.28",
      tier: "modern",
    });
    expect(classifyPluginApprovalRuntime("2026.4.7")).toEqual({
      runtimeVersion: "2026.4.7",
      tier: "modern",
    });
    expect(classifyPluginApprovalRuntime(undefined)).toEqual({
      runtimeVersion: "unknown",
      tier: "unknown",
    });
  });

  it("auto-detects runtime version when resolver runtimeVersion is omitted or undefined", () => {
    const previousRuntimeVersion = process.env.OPENCLAW_VERSION;
    process.env.OPENCLAW_VERSION = "2026.3.28";

    try {
      expect(
        resolvePluginApprovalCompat({
          currentChannelProfile: "webchat",
          hasFeishuApproverRoute: false,
          hasFeishuFallbackContext: false,
        }),
      ).toMatchObject({
        runtimeVersion: "2026.3.28",
        runtimeTier: "modern",
        mode: "native-webchat",
        transport: "native",
      });

      expect(
        resolvePluginApprovalCompat({
          runtimeVersion: undefined,
          currentChannelProfile: "webchat",
          hasFeishuApproverRoute: false,
          hasFeishuFallbackContext: false,
        }),
      ).toMatchObject({
        runtimeVersion: "2026.3.28",
        runtimeTier: "modern",
        mode: "native-webchat",
        transport: "native",
      });
    } finally {
      if (previousRuntimeVersion === undefined) {
        delete process.env.OPENCLAW_VERSION;
      } else {
        process.env.OPENCLAW_VERSION = previousRuntimeVersion;
      }
    }
  });

  it("keeps 2026.3.28+ webchat runtimes on native plugin approval", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.28",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "native-webchat",
      transport: "native",
      runtimeTier: "modern",
    });

    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.4.7",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: true,
        hasFeishuFallbackContext: true,
      }),
    ).toMatchObject({
      mode: "native-webchat",
      transport: "native",
      runtimeTier: "modern",
    });
  });

  it("uses dedicated feishu branch with route presence deciding allow vs deny", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.28",
        currentChannelProfile: "feishu",
        hasFeishuApproverRoute: true,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "feishu-local",
      transport: "local-chat",
      runtimeTier: "modern",
    });

    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.28",
        currentChannelProfile: "feishu",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: true,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
      runtimeTier: "modern",
    });
  });

  it("routes legacy webchat runtimes to feishu local approval when a feishu route exists", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.27",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: true,
        hasFeishuFallbackContext: true,
      }),
    ).toMatchObject({
      mode: "feishu-local",
      transport: "local-chat",
      runtimeTier: "legacy",
    });
  });

  it("keeps half-wired legacy non-feishu runtimes on deny path", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.27",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: true,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
      runtimeTier: "legacy",
    });
  });

  it("fails closed for legacy and unknown runtimes without a feishu route", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.27",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
      runtimeTier: "legacy",
    });

    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.27",
        currentChannelProfile: "other",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
      runtimeTier: "legacy",
    });
  });
});
