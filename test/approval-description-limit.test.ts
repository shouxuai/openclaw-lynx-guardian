import { describe, expect, it, vi } from "vitest";

import { buildToolApprovalRequest } from "../src/approval/approval-bridge.js";
import { compactApprovalText } from "../src/approval/native-approval-description.js";

describe("buildToolApprovalRequest description length", () => {
  it("caps approval descriptions while preserving risk identifiers", () => {
    const longDescription =
      "这是一个可读的中文审批说明，用来描述受保护文件访问的上下文、请求来源、操作原因和风险提示。".repeat(12);

    const request = buildToolApprovalRequest({
      toolName: "read",
      module: "M2:protected_file_access",
      riskLevel: "L3",
      description: longDescription,
      timeoutMs: 120_000,
      onResolution: vi.fn(),
    });

    expect(request.description.length).toBeLessThanOrEqual(256);
    expect(request.description).toContain("M2:protected_file_access");
    expect(request.description).toContain("L3");
    expect(request.description).not.toMatch(/webview|local[- ]console|控制台/i);
  });

  it("preserves the risk marker when module and detail text are extreme", () => {
    const request = buildToolApprovalRequest({
      toolName: "read",
      module: `M2:${"protected_file_access_".repeat(40)}`,
      riskLevel: "L3",
      description: "这是一个可读的中文审批说明".repeat(80),
      timeoutMs: 120_000,
      onResolution: vi.fn(),
    });

    expect(request.description.length).toBeLessThanOrEqual(256);
    expect(request.description).toContain("[module]");
    expect(request.description).toContain("[risk] L3");
    expect(request.description).toContain("批准后继续当前工具调用");
  });

  it("compacts approval text without exceeding zero or splitting surrogate pairs", () => {
    expect(compactApprovalText("abcdef", 0)).toBe("");
    expect(compactApprovalText("abcdef", -1)).toBe("");
    expect(compactApprovalText("abc😊def", 6)).toBe("abc😊…");
  });
});
