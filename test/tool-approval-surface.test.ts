import { describe, expect, it } from "vitest";

import { resolveToolApprovalSurface } from "../src/approval/tool-approval-surface.js";

describe("tool approval surface routing", () => {
  it("hard-denies L4 instead of requesting approval", () => {
    expect(resolveToolApprovalSurface({
      toolName: "exec",
      riskLevel: "L4",
      modules: ["M5:credential_theft"],
      nativeExecApprovalAvailable: true,
      systemPluginApprovalAvailable: true,
    }).surface).toBe("hard-deny");
  });

  it("routes risky exec to Lynx workflow approval so one prompt can cover the current run", () => {
    expect(resolveToolApprovalSurface({
      toolName: "exec",
      riskLevel: "L3",
      modules: ["chain_context"],
      nativeExecApprovalAvailable: true,
      systemPluginApprovalAvailable: true,
    })).toMatchObject({
      surface: "plugin-native",
      requiresOpenClawApprovalContext: false,
    });
  });

  it("routes risky non-exec tools to system plugin approval", () => {
    for (const toolName of ["read", "write", "edit", "cron", "gateway", "feishu_doc"]) {
      expect(resolveToolApprovalSurface({
        toolName,
        riskLevel: "L3",
        modules: ["M2:protected_file_access"],
        nativeExecApprovalAvailable: true,
        systemPluginApprovalAvailable: true,
      }).surface).toBe("plugin-native");
    }
  });

  it("fails closed when non-exec L3 has no approval route", () => {
    expect(resolveToolApprovalSurface({
      toolName: "read",
      riskLevel: "L3",
      modules: ["M2:protected_file_access"],
      nativeExecApprovalAvailable: false,
      systemPluginApprovalAvailable: false,
    })).toMatchObject({
      surface: "block-no-approval-route",
    });
  });
});
