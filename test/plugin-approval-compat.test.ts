import { describe, expect, it } from "vitest";

import {
  PLUGIN_APPROVAL_EARLY_SUPPORT_END_VERSION,
  PLUGIN_APPROVAL_INTRO_VERSION,
  PLUGIN_APPROVAL_NATIVE_TRUST_VERSION,
  classifyPluginApprovalRuntime,
  resolvePluginApprovalCompat,
} from "../src/runtime/plugin-approval-compat.js";

describe("plugin approval compatibility", () => {
  it("exposes plugin approval runtime boundary constants", () => {
    expect(PLUGIN_APPROVAL_INTRO_VERSION).toBe("2026.3.28");
    expect(PLUGIN_APPROVAL_EARLY_SUPPORT_END_VERSION).toBe("2026.4.6");
    expect(PLUGIN_APPROVAL_NATIVE_TRUST_VERSION).toBe("2026.4.7");
  });

  it("classifies runtime versions into legacy, early-support, trusted, and unknown tiers", () => {
    expect(classifyPluginApprovalRuntime("2026.3.27")).toEqual({
      runtimeVersion: "2026.3.27",
      tier: "legacy",
    });
    expect(classifyPluginApprovalRuntime("2026.3.28")).toEqual({
      runtimeVersion: "2026.3.28",
      tier: "early-support",
    });
    expect(classifyPluginApprovalRuntime("2026.4.1")).toEqual({
      runtimeVersion: "2026.4.1",
      tier: "early-support",
    });
    expect(classifyPluginApprovalRuntime("2026.4.6")).toEqual({
      runtimeVersion: "2026.4.6",
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

  it("auto-detects runtime version when resolver runtimeVersion is omitted or undefined", () => {
    const previousRuntimeVersion = process.env.OPENCLAW_VERSION;
    process.env.OPENCLAW_VERSION = "2026.4.7";

    try {
      expect(
        resolvePluginApprovalCompat({
          currentChannelProfile: "webchat",
          hasFeishuApproverRoute: false,
          hasFeishuFallbackContext: false,
        }),
      ).toMatchObject({
        runtimeVersion: "2026.4.7",
        runtimeTier: "trusted",
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
        runtimeVersion: "2026.4.7",
        runtimeTier: "trusted",
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

  it("keeps trusted webchat on native approval even when feishu wiring is present", () => {
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
      runtimeTier: "trusted",
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
      runtimeTier: "early-support",
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
      runtimeTier: "early-support",
    });
  });

  it("routes boundary early-support webchat runtimes to feishu local approval when a feishu route exists", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.28",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: true,
        hasFeishuFallbackContext: true,
      }),
    ).toMatchObject({
      mode: "feishu-local",
      transport: "local-chat",
      runtimeTier: "early-support",
    });

    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.4.6",
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

  it("keeps half-wired non-feishu runtimes on deny path", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.4.6",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: true,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
      runtimeTier: "early-support",
    });
  });

  it("fails closed for boundary early-support runtimes without a feishu route", () => {
    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.3.28",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
      runtimeTier: "early-support",
    });

    expect(
      resolvePluginApprovalCompat({
        runtimeVersion: "2026.4.6",
        currentChannelProfile: "webchat",
        hasFeishuApproverRoute: false,
        hasFeishuFallbackContext: false,
      }),
    ).toMatchObject({
      mode: "deny-no-route",
      transport: "none",
      runtimeTier: "early-support",
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
