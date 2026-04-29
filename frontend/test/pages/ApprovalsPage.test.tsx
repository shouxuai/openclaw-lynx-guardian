import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expiresAtMs: 1_776_949_200_000,
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

    render(<ApprovalsPage />);

    expect(await screen.findByText("APR-001")).toBeInTheDocument();
    expect(screen.getAllByText("qa-1").length).toBeGreaterThan(0);
    expect(screen.getByText("未关联问答记录")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/approvals?pageNum=1&pageSize=20");
    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看详情" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 APR-001 审批详情" }));

    expect(await screen.findByRole("dialog", { name: "审批详情" })).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/approvals/APR-001");
    expect(screen.getByText("关联问答记录")).toBeInTheDocument();
    expect(screen.getAllByText("qa-1").length).toBeGreaterThan(0);
    expect(screen.getByText("ou-owner；ou-security")).toBeInTheDocument();
    expect(screen.getByText("fingerprint-001")).toBeInTheDocument();
    expect(screen.getByText(/"decisionId": "decision-001"/)).toBeInTheDocument();
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
});
