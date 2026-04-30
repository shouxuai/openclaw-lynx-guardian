import { describe, expect, it, vi } from "vitest";

import {
  buildToolApprovalRequest,
  persistGrantFromApproval,
} from "../src/approval/approval-bridge.js";

describe("tool approval runtime", () => {
  it("keeps native approval descriptions focused on schema-safe decision context", () => {
    const approval = buildToolApprovalRequest({
      toolName: "exec",
      module: "M3:over_agency",
      riskLevel: "L3",
      description: "high-risk tool call",
      timeoutMs: 30_000,
      onResolution: vi.fn(),
    });

    expect(approval.description.length).toBeLessThanOrEqual(256);
    expect(approval.description).toContain("[module] M3:over_agency");
    expect(approval.description).toContain("[risk] L3");
    expect(approval.description).toContain("high-risk tool call");
    expect(approval.description).not.toContain("\n---\n");
    expect(approval.description).not.toContain("[^lynx-log]");
    expect(approval.description).not.toContain("http://127.0.0.1:18789/webview");
    expect(approval.description).not.toMatch(/webview|local[- ]console|本地日志页面|控制台/i);
  });

  it("syncs allow-current-chain grants to the Go control plane", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ grantId: "grant-1" }), { status: 200 }));

    await persistGrantFromApproval({
      decision: "allow-once",
      approvalId: "approval-1",
      channelProfile: "feishu",
      channelId: "channel-1",
      conversationId: "conversation-1",
      requesterOuId: "ou-1",
      module: "file_read",
      riskLevel: "L2",
      grantWindowMs: 30_000,
      grantControlPlane: {
        baseUrl: "http://127.0.0.1:18789/",
        getToken: () => "token-1",
        fetchImpl,
        chainId: "chain-1",
        sessionKey: "session-1",
        requesterId: "requester-1",
        approverOuId: "owner-1",
        toolName: "read_file",
        targetKind: "file",
        targetHash: "target-a",
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:18789/lynx/internal/v1/approvals/approval-1/resolve");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer token-1",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      approvalId: "approval-1",
      resolution: "allow-current-chain",
      chainId: "chain-1",
      sessionKey: "session-1",
      channelProfile: "feishu",
      channelId: "channel-1",
      conversationId: "conversation-1",
      requesterId: "requester-1",
      requesterOuId: "ou-1",
      riskFamily: "file_read",
      riskLevel: "L2",
      toolName: "read_file",
      targetKind: "file",
      targetHash: "target-a",
    });
  });
});
