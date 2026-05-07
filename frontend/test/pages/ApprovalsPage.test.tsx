import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalsPage } from "../../src/pages/ApprovalsPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
    headers: {
      get: () => "application/json",
    },
  } as unknown as Response;
}

function createApproval() {
  return {
    approvalId: "APR-001",
    qaRecordId: "qa-1",
    pendingId: "pending-1",
    sessionKey: "session-1",
    runId: "run-1",
    transport: "webchat",
    requesterOuId: "ou-requester",
    module: "M2:protected_file_access",
    riskLevel: "L3",
    toolName: "exec",
    scopeType: "singleTool",
    requestedAtMs: 1_776_945_600_000,
    expiresAtMs: Date.now() + 60_000,
    resolution: "pending",
    promptExcerpt: "申请读取受保护文件",
  };
}

function createApprovalDetail() {
  return {
    ...createApproval(),
    channelProfile: "feishu",
    channelId: "chat-1",
    accountId: "account-1",
    conversationId: "conversation-1",
    approverOuIds: ["ou-owner", "ou-security"],
    resolvedApproverOuId: "ou-security",
    requestFingerprintHash: "fingerprint-001",
    auditSummaryJson: {
      decisionId: "decision-001",
      grantId: "grant-001",
    },
    metadataJson: {
      resourceScope: {
        path: "C:/Users/example/.env",
      },
      revokedReason: "暂无撤销",
    },
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

function expectTableFitsDefaultContentWidth(container: HTMLElement): void {
  const table = container.querySelector(".data-table") as HTMLTableElement | null;
  const minWidth = Number.parseFloat(table?.style.minWidth ?? "0");

  expect(minWidth).toBeLessThanOrEqual(1136);
}

describe("ApprovalsPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens approval details in a dialog instead of navigating to a missing route", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(createPage([
        createApproval(),
        {
          ...createApproval(),
          approvalId: "APR-LEGACY",
          qaRecordId: undefined,
        },
      ])))
      .mockResolvedValueOnce(createJsonResponse(createApprovalDetail()));

    const { container } = render(<ApprovalsPage />);

    expect(await screen.findByText("APR-001")).toBeInTheDocument();
    expect(screen.getByText("拦截理由")).toBeInTheDocument();
    expectTableFitsDefaultContentWidth(container);
    expect(screen.getByText("审批记录说明")).toBeInTheDocument();
    expect(screen.getByText(/OpenClaw 原生审批窗口之外/)).toBeInTheDocument();
    expect(screen.getByText(/列表先展示拦截理由/)).toBeInTheDocument();
    expect(container.querySelector(".table-explanation-card.ant-card")).not.toBeNull();
    expect(container.querySelector(".table-panel .table-explanation-card")).toBeNull();
    expect(container.querySelector(".table-panel__header .panel__subtitle")).toBeNull();
    const approvalRow = screen.getByText("APR-001").closest("tr");
    expect(approvalRow).not.toBeNull();
    expect(within(approvalRow!).getByText(/访问受保护文件/)).toBeInTheDocument();
    expect(within(approvalRow!).getByText(/需要审批确认后才可继续/)).toBeInTheDocument();
    expect(screen.getAllByText("qa-1").length).toBeGreaterThan(0);
    expect(screen.getByText("未关联问答记录")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/approvals?pageNum=1&pageSize=20");
    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看详情" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 APR-001 审批详情" }));

    expect(await screen.findByRole("dialog", { name: "审批详情" })).toBeInTheDocument();
    expect(screen.getByText("审批概览")).toBeInTheDocument();
    expect(screen.getByText("审批证据")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/approvals/APR-001");
    expect(screen.getByText("关联问答记录")).toBeInTheDocument();
    expect(screen.getAllByText("qa-1").length).toBeGreaterThan(0);
    expect(screen.getByText("ou-owner；ou-security")).toBeInTheDocument();
    expect(screen.getByText("访问受保护文件（M2:protected_file_access）")).toBeInTheDocument();
    expect(screen.getByText("fingerprint-001")).toBeInTheDocument();
    expect(screen.getByText(/"decisionId": "decision-001"/)).toBeInTheDocument();
  });

  it("translates raw module codes in the interception reason", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(createPage([
      {
        ...createApproval(),
        approvalId: "APR-M3",
        module: "M3",
        riskLevel: "L4",
      },
    ])));

    render(<ApprovalsPage />);

    const approvalRow = (await screen.findByText("APR-M3")).closest("tr");
    expect(approvalRow).not.toBeNull();
    expect(within(approvalRow!).getByText(/高风险代理\/权限操作/)).toBeInTheDocument();
    expect(within(approvalRow!).getByText(/硬拒绝/)).toBeInTheDocument();
  });

  it("uses real filters and keeps grant internals in the detail dialog", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(createPage([createApproval()], 1, 20, 41)))
      .mockResolvedValueOnce(createJsonResponse(createPage([
        {
          ...createApproval(),
          approvalId: "APR-FILTERED",
          requesterOuId: "ou-filtered",
          resolution: "approved",
        },
      ])));

    render(<ApprovalsPage />);

    await screen.findByText("APR-001");
    expect(screen.getByLabelText("关键词")).toBeInTheDocument();
    expect(screen.getByLabelText("处理状态")).toBeInTheDocument();
    expect(screen.getByLabelText("申请人")).toBeInTheDocument();
    expect(screen.queryByText("Grant 范围")).not.toBeInTheDocument();
    expect(screen.queryByText("撤销原因")).not.toBeInTheDocument();
    expect(screen.queryByText("范围类型")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "protected" },
    });
    fireEvent.change(screen.getByLabelText("申请人"), {
      target: { value: "ou-filtered" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    expect(await screen.findByText("APR-FILTERED")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/approvals?q=protected&requesterOuId=ou-filtered&pageNum=1&pageSize=20");
  });

  it("does not count expired unresolved approvals as pending", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(createPage([
      {
        ...createApproval(),
        approvalId: "APR-PENDING",
        expiresAtMs: Date.now() + 60_000,
        resolution: "pending",
      },
      {
        ...createApproval(),
        approvalId: "APR-EXPIRED",
        expiresAtMs: Date.now() - 60_000,
        resolution: "pending",
      },
      {
        ...createApproval(),
        approvalId: "APR-APPROVED",
        expiresAtMs: Date.now() - 60_000,
        resolution: "approved",
      },
    ])));

    render(<ApprovalsPage />);

    expect(await screen.findByText("APR-PENDING")).toBeInTheDocument();
    const pendingCard = screen.getByText("待处理申请").closest("article");
    const expiredCard = screen.getByText("已过期未处理").closest("article");
    expect(pendingCard).not.toBeNull();
    expect(expiredCard).not.toBeNull();
    expect(within(pendingCard!).getByText("1")).toBeInTheDocument();
    expect(within(expiredCard!).getByText("1")).toBeInTheDocument();

    const expiredRow = screen.getByText("APR-EXPIRED").closest("tr");
    const pendingRow = screen.getByText("APR-PENDING").closest("tr");
    expect(expiredRow).not.toBeNull();
    expect(pendingRow).not.toBeNull();
    expect(within(expiredRow!).getByText("已过期")).toBeInTheDocument();
    expect(within(pendingRow!).getByText("待处理")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量处理" })).not.toBeInTheDocument();
  });

  it("allows resolving an unexpired L3 approval from the detail dialog", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(createPage([createApproval()])))
      .mockResolvedValueOnce(createJsonResponse({
        ...createApprovalDetail(),
        metadataJson: {
          chainId: "chain-1",
          requesterId: "requester-1",
          targetKind: "tool",
          targetHash: "target-1",
          resourceScope: {
            operationKind: "read",
          },
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({ grantId: "grant-APR-001" }))
      .mockResolvedValueOnce(createJsonResponse(createPage([
        {
          ...createApproval(),
          resolution: "approved",
        },
      ])));

    render(<ApprovalsPage />);

    expect(await screen.findByText("APR-001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看 APR-001 审批详情" }));
    expect(await screen.findByRole("dialog", { name: "审批详情" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "批准本次" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/lynx/approvals/APR-001/resolve",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const resolveInit = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(resolveInit?.body))).toMatchObject({
      approvalId: "APR-001",
      resolution: "allow-current-chain",
      chainId: "chain-1",
      requesterId: "requester-1",
      requesterOuId: "ou-requester",
      approverOuId: "ou-owner",
      riskFamily: "M2:protected_file_access",
      riskLevel: "L3",
      toolName: "exec",
      targetKind: "tool",
      targetHash: "target-1",
      resourceScope: {
        operationKind: "read",
      },
    });
    expect(await screen.findByText("审批已批准")).toBeInTheDocument();
  });

  it("does not expose local approval actions for L4 hard-deny records", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(createPage([
        {
          ...createApproval(),
          riskLevel: "L4",
        },
      ])))
      .mockResolvedValueOnce(createJsonResponse({
        ...createApprovalDetail(),
        riskLevel: "L4",
      }));

    render(<ApprovalsPage />);

    expect(await screen.findByText("APR-001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看 APR-001 审批详情" }));
    expect(await screen.findByRole("dialog", { name: "审批详情" })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "批准本次" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝" })).not.toBeInTheDocument();
    expect(screen.getByText("L4 是硬拒绝，不能在本地审批放行。")).toBeInTheDocument();
  });
});
