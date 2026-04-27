import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventsPage } from "./EventsPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
    headers: {
      get: () => "application/json",
    },
  } as unknown as Response;
}

function createEvent(eventId: string, title: string) {
  return {
    eventId,
    sourceKind: "plugin_hook",
    hookName: "before_tool_call",
    eventType: "tool_call_evaluated",
    category: "execution_control",
    riskLevel: "L3",
    policyDecision: "confirm",
    enforcementAction: "requireApproval",
    title,
    summary: "需要审批后继续执行。",
    recommendation: "建议先核对申请人身份。",
    contentExcerpt: "用户请求读取配置，密钥 sk-*** 已脱敏。",
    occurredAtMs: 1_776_945_600_000,
  };
}

function createEventDetail(eventId: string, title: string) {
  return {
    ...createEvent(eventId, title),
    contentKind: "text",
    modules: ["M2:protected_file_access"],
    contentHash: "hash-detail",
    ingestedAtMs: 1_776_945_600_500,
    payloadJson: {
      toolName: "exec",
    },
  };
}

describe("EventsPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows bounded audit columns and opens event details in a dialog", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
        items: [createEvent("EVT-001", "初始审计事件")],
        nextCursor: "cursor-page-2",
      }))
      .mockResolvedValueOnce(createJsonResponse(createEventDetail("EVT-001", "初始审计事件")));

    render(<EventsPage />);

    await screen.findByText("EVT-001");
    expect(screen.getByTestId("audit-events-table-panel")).toHaveClass("audit-events-table-panel");
    expect(screen.getByText("脱敏摘要")).toBeInTheDocument();
    expect(screen.getAllByText("处置建议").length).toBeGreaterThan(0);
    expect(screen.getByText("用户请求读取配置，密钥 sk-*** 已脱敏。")).toBeInTheDocument();
    expect(screen.getByText("建议先核对申请人身份。")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/events?limit=10");

    fireEvent.click(screen.getByRole("button", { name: "查看 EVT-001 详情" }));

    const dialog = await screen.findByRole("dialog", { name: "初始审计事件" });
    expect(dialog).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/events/EVT-001");
    expect(screen.getByText("M2:protected_file_access")).toBeInTheDocument();
    expect(screen.getByText(/"toolName": "exec"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(screen.queryByRole("dialog", { name: "初始审计事件" })).not.toBeInTheDocument();
  });

  it("supports cursor pagination, page selection, page size, and filters", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
        items: [createEvent("EVT-001", "初始审计事件")],
        nextCursor: "cursor-page-2",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        items: [createEvent("EVT-002", "第二页审计事件")],
        nextCursor: "cursor-page-3",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        items: [createEvent("EVT-001", "初始审计事件")],
        nextCursor: "cursor-page-2",
      }))
      .mockResolvedValueOnce(createJsonResponse({
        items: [createEvent("EVT-PAGE-SIZE", "每页行数更新后的审计事件")],
      }))
      .mockResolvedValueOnce(createJsonResponse({
        items: [createEvent("EVT-SEARCH", "搜索命中的审计事件")],
      }));

    render(<EventsPage />);

    await screen.findByText("EVT-001");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/events?limit=10");

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    await screen.findByText("EVT-002");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/events?limit=10&cursor=cursor-page-2");

    fireEvent.change(screen.getByLabelText("当前页"), {
      target: { value: "0" },
    });

    await screen.findByText("EVT-001");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/lynx/events?limit=10");

    fireEvent.change(screen.getByLabelText("每页行数"), {
      target: { value: "25" },
    });

    await screen.findByText("EVT-PAGE-SIZE");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/lynx/events?limit=25");

    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "exec" },
    });
    fireEvent.change(screen.getByLabelText("风险等级"), {
      target: { value: "L3" },
    });
    fireEvent.change(screen.getByLabelText("策略判定"), {
      target: { value: "requireApproval" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("EVT-SEARCH");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      "/lynx/events?q=exec&riskLevel=L3&enforcementAction=requireApproval&limit=25",
    );
  });
});
