import { describe, expect, it, vi } from "vitest";

import { buildToolApprovalRequest } from "../src/approval/approval-bridge.js";

describe("buildToolApprovalRequest description length", () => {
  it("caps approval descriptions while preserving risk identifiers", () => {
    const longDescription = "这是一个可读的中文审批说明，用来描述受保护文件访问的上下文、请求来源、操作原因和风险提示。".repeat(12);

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
  });
});
