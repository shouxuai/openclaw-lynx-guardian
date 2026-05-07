import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

function createPage(items: unknown[], pageNum = 1, pageSize = 20, total = items.length) {
  return {
    items,
    total,
    pageNum,
    pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
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

  it("uses filters, pagination and renders grant details with the audit dialog structure", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(createPage([createGrant()], 1, 20, 41)))
      .mockResolvedValueOnce(createJsonResponse(createPage([createGrant("grant-page-2")], 2, 20, 41)))
      .mockResolvedValueOnce(
        createJsonResponse(createPage([createGrant("grant-filtered")], 1, 20, 1)),
      );

    const { container } = render(<GrantsPage />);

    expect(
      await screen.findByRole("heading", { name: "放行记录" }),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/grants?pageNum=1&pageSize=20");
    await screen.findByText("grant-1");
    expect(screen.getByTitle("2")).toBeInTheDocument();
    expect(screen.queryByText("链路授权")).not.toBeInTheDocument();
    expect(screen.queryByText("临时放行")).not.toBeInTheDocument();
    expect(screen.getByLabelText("关键词")).toBeInTheDocument();
    expect(screen.getByLabelText("申请人")).toBeInTheDocument();
    expect(screen.queryByText("Grant ID")).not.toBeInTheDocument();
    expect(screen.queryByText("放行范围")).not.toBeInTheDocument();
    expect(screen.queryByText("撤销原因")).not.toBeInTheDocument();
    expect(container.querySelector(".page-header__description")).toBeNull();
    expect(container.querySelector(".table-panel__header .panel__subtitle")).toBeNull();
    expect(screen.getByText("放行记录说明")).toBeInTheDocument();
    expect(screen.getByText(/审批通过后，后续同一链路里的 tool 调用如果命中已授权范围/)).toBeInTheDocument();
    expect(container.querySelector(".table-explanation-card.ant-card")).not.toBeNull();
    expect(container.querySelector(".table-panel .table-explanation-card")).toBeNull();
    expect(Number.parseInt(container.querySelector("table")?.style.minWidth ?? "0", 10)).toBeLessThanOrEqual(1136);

    fireEvent.click(
      screen.getByRole("button", { name: "查看 grant-1 放行详情" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "放行详情" }),
    ).toBeInTheDocument();
    expect(screen.getByText("放行概览")).toBeInTheDocument();
    expect(screen.getByText("授权上下文")).toBeInTheDocument();
    expect(screen.getByText("放行范围")).toBeInTheDocument();
    expect(screen.getByText("path:C:/Users/example/.env")).toBeInTheDocument();
    expect(screen.getByText("manual revoke")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    fireEvent.click(screen.getByTitle("2"));

    await screen.findByText("grant-page-2");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/grants?pageNum=2&pageSize=20");

    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "filtered" },
    });
    fireEvent.change(screen.getByLabelText("申请人"), {
      target: { value: "ou-requester" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("grant-filtered");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "/lynx/grants?q=filtered&requesterId=ou-requester&pageNum=1&pageSize=20",
    );
  });

  it("shows an uncluttered empty table state for grant records", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ items: [] }));

    const { container } = render(<GrantsPage />);

    expect(
      await screen.findByRole("heading", { name: "放行记录" }),
    ).toBeInTheDocument();
    expect(screen.getByText("审批后的工具放行流水")).toBeInTheDocument();
    expect(container.querySelector(".metric-grid--narrow")).toBeInTheDocument();
    expect((await screen.findAllByText("暂无放行记录")).length).toBeGreaterThan(0);
    expect(screen.getByText("放行记录说明")).toBeInTheDocument();
    expect(screen.getByText(/审批通过后，后续同一链路里的 tool 调用如果命中已授权范围/)).toBeInTheDocument();
    expect(screen.getByText(/换成 exec、换路径或链路结束就不会复用/)).toBeInTheDocument();
    expect(container.querySelector(".table-explanation-card.ant-card")).not.toBeNull();
    expect(container.querySelector(".table-panel .table-explanation-card")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "放行" })).toBeInTheDocument();
    expect(container.querySelector(".page-header__description")).toBeNull();
    expect(container.querySelector(".empty-explanation")).toBeNull();
    expect(container.querySelector(".table-wrap")).not.toBeNull();
  });
});
