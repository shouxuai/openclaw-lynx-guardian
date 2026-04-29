import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GrantsPage } from "../../src/pages/GrantsPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
    headers: {
      get: () => "application/json",
    },
  } as unknown as Response;
}

function createGrant(grantId = "grant-1") {
  return {
    grantId,
    approvalId: "APR-001",
    chainId: "chain-1",
    sessionKey: "session-1",
    channelProfile: "webchat",
    channelId: "channel-1",
    conversationId: "conversation-1",
    requesterId: "requester-1",
    requesterOuId: "ou-requester",
    approverId: "approver-1",
    approverOuId: "ou-approver",
    riskFamily: "protected_file_access",
    toolName: "exec",
    targetKind: "file",
    targetHash: "hash-1",
    resourceScope: {
      path: "C:/Users/example/.env",
    },
    createdAt: "2026-04-29T10:00:00Z",
    expiresAt: "2026-04-29T11:00:00Z",
    revokedReason: "manual revoke",
  };
}

describe("GrantsPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses filters and moves scope/revocation detail out of the table", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ items: [createGrant()] }))
      .mockResolvedValueOnce(createJsonResponse({ items: [createGrant("grant-filtered")] }));

    render(<GrantsPage />);

    await screen.findByText("grant-1");
    expect(screen.getByLabelText("关键词")).toBeInTheDocument();
    expect(screen.getByLabelText("申请人")).toBeInTheDocument();
    expect(screen.queryByText("Grant ID")).not.toBeInTheDocument();
    expect(screen.queryByText("授权范围")).not.toBeInTheDocument();
    expect(screen.queryByText("撤销原因")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 grant-1 授权详情" }));
    expect(await screen.findByRole("dialog", { name: "授权详情" })).toBeInTheDocument();
    expect(screen.getByText("path:C:/Users/example/.env")).toBeInTheDocument();
    expect(screen.getByText("manual revoke")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "filtered" },
    });
    fireEvent.change(screen.getByLabelText("申请人"), {
      target: { value: "ou-requester" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("grant-filtered");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/grants?q=filtered&requesterId=ou-requester");
  });
});
