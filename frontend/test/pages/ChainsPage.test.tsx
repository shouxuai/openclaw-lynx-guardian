import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChainsPage } from "../../src/pages/ChainsPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
    headers: {
      get: () => "application/json",
    },
  } as unknown as Response;
}

function createChain(chainId = "chain-1") {
  return {
    chainId,
    sessionKey: "session-1",
    recentIdentity: ["requester:ou-1"],
    recentSensitive: ["protected_file"],
    recentDenials: ["deny-1"],
    recentApprovals: ["APR-001"],
    recentTools: ["exec"],
    recentTaintReads: ["secret-read"],
    recentEvasions: ["approval-bypass"],
    activeGrantId: "grant-1",
    pendingApproval: "APR-002",
  };
}

describe("ChainsPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses filters and keeps chain internals in details", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ items: [createChain()] }))
      .mockResolvedValueOnce(createJsonResponse({ items: [createChain("chain-filtered")] }));

    render(<ChainsPage />);

    await screen.findByText("chain-1");
    expect(screen.getByLabelText("关键词")).toBeInTheDocument();
    expect(screen.getByLabelText("渠道")).toBeInTheDocument();
    expect(screen.queryByText("Taint")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Grant")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending Approval")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 chain-1 链路详情" }));
    expect(await screen.findByRole("dialog", { name: "链路详情" })).toBeInTheDocument();
    expect(screen.getByText("secret-read")).toBeInTheDocument();
    expect(screen.getByText("grant-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "filtered" },
    });
    fireEvent.change(screen.getByLabelText("渠道"), {
      target: { value: "webchat" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("chain-filtered");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/chains?q=filtered&channelProfile=webchat");
  });
});
