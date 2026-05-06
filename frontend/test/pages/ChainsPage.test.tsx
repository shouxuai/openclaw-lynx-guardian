import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    coveredPrompts: [
      {
        qaRecordId: "qa-1",
        userPromptExcerpt: "first prompt",
        riskLevel: "L2",
        startedAtMs: 1,
        status: "completed",
      },
      {
        qaRecordId: "qa-2",
        userPromptExcerpt: "second prompt",
        riskLevel: "L3",
        startedAtMs: 2,
        status: "completed",
      },
    ],
    promptCount: 2,
  };
}

function createSparseChain(chainId = "chain-sparse") {
  return {
    chainId,
    sessionKey: "session-sparse",
    recentIdentity: null,
    recentSensitive: null,
    recentDenials: null,
    recentApprovals: null,
    recentTools: null,
    recentTaintReads: null,
    recentEvasions: null,
    activeGrantId: "",
    pendingApproval: "",
    coveredPrompts: null,
    promptCount: 0,
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
      .mockResolvedValueOnce(
        createJsonResponse({ items: [createChain("chain-filtered")] }),
      );

    render(<ChainsPage />);

    await screen.findByText("chain-1");
    expect(
      screen.getByText("覆盖的输入词：first prompt；second prompt"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("关键词")).toBeInTheDocument();
    expect(screen.getByLabelText("渠道")).toBeInTheDocument();
    expect(screen.queryByText("Taint")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Grant")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending Approval")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "查看 chain-1 链路详情" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "链路详情" }),
    ).toBeInTheDocument();
    expect(screen.getByText("secret-read")).toBeInTheDocument();
    expect(screen.getByText("grant-1")).toBeInTheDocument();
    expect(screen.getByText("覆盖的输入词")).toBeInTheDocument();
    expect(screen.getByText("first prompt")).toBeInTheDocument();
    expect(screen.getByText("second prompt")).toBeInTheDocument();

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
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/lynx/chains?q=filtered&channelProfile=webchat",
    );
  });

  it("renders chain summaries when backend returns null signal arrays", async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({ items: [createSparseChain()] }),
    );

    render(<ChainsPage />);

    await screen.findByText("chain-sparse");
    expect(screen.getByText("session-sparse")).toBeInTheDocument();
    expect(screen.getAllByText("暂无").length).toBeGreaterThan(0);
  });
});
