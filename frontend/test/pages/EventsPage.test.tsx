import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventsPage, buildDateRangeQuery } from "../../src/pages/EventsPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
    headers: {
      get: () => "application/json",
    },
  } as unknown as Response;
}

function createEvent(eventId: string, title: string, overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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

function createPage(items: unknown[], pageNum = 1, pageSize = 10, total = items.length) {
  return {
    items,
    total,
    pageNum,
    pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

function renderEventsPage() {
  return render(
    <ConfigProvider locale={zhCN}>
      <EventsPage />
    </ConfigProvider>,
  );
}

async function chooseSelectOption(name: string, optionText: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name }));
  const matches = await screen.findAllByText(optionText);
  fireEvent.click(matches.at(-1)!);
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
      .mockResolvedValueOnce(createJsonResponse(createPage([
        createEvent("EVT-001", "初始审计事件", { qaRecordId: "qa-1" }),
        createEvent("EVT-LEGACY", "历史审计事件", {
          contentExcerpt: "历史事件未关联问答记录。",
          recommendation: "等待人工补充上下文。",
        }),
      ])))
      .mockResolvedValueOnce(createJsonResponse({
        ...createEventDetail("EVT-001", "初始审计事件"),
        qaRecordId: "qa-1",
      }));

    const { container } = renderEventsPage();

    await screen.findByText("EVT-001");
    expect(screen.getAllByText("qa-1").length).toBeGreaterThan(0);
    expect(screen.getByText("未关联问答记录")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".audit-filter-form .ant-select")).toHaveLength(3);
    expect(container.querySelector(".audit-filter-form .ant-picker")).not.toBeNull();
    expect(screen.getByTestId("audit-events-table-panel")).toHaveClass("audit-events-table-panel");
    expect(screen.getByText("脱敏摘要")).toBeInTheDocument();
    expect(screen.getAllByText("处置建议").length).toBeGreaterThan(0);
    expect(screen.getByText("用户请求读取配置，密钥 sk-*** 已脱敏。")).toBeInTheDocument();
    expect(screen.getByText("建议先核对申请人身份。")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/events?pageNum=1&pageSize=10");

    fireEvent.click(screen.getByRole("button", { name: "查看 EVT-001 详情" }));

    const dialog = await screen.findByRole("dialog", { name: "初始审计事件" });
    expect(dialog).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/events/EVT-001");
    expect(screen.getByText("关联问答记录")).toBeInTheDocument();
    expect(screen.getAllByText("qa-1").length).toBeGreaterThan(0);
    expect(screen.getByText("M2:protected_file_access")).toBeInTheDocument();
    expect(screen.getByText(/"toolName": "exec"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(screen.queryByRole("dialog", { name: "初始审计事件" })).not.toBeInTheDocument();
  });

  it("summarizes control-plane evidence from real list fields and optional top-level evidence", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(createPage([
        {
          ...createEvent("EVT-FIELDS", "列表字段证据"),
          primaryModule: "M2:protected_file_access",
          riskScore: 88,
          requestId: "REQ-001",
          approvalId: "APR-001",
        },
        {
          ...createEvent("EVT-TOPLEVEL", "列表顶层证据"),
          winningArbiter: "evidence_score",
          matchedRules: ["critical_exec"],
          scoreBreakdown: [{ ruleId: "chain.recent_denial", delta: 30 }],
          evidence: [{ id: "taint.recent_sensitive_read", module: "taint_context" }],
        },
      ])));

    renderEventsPage();

    await screen.findByText("EVT-FIELDS");
    expect(screen.getByText(/module:M2:protected_file_access/)).toBeInTheDocument();
    expect(screen.getByText(/score:88/)).toBeInTheDocument();
    expect(screen.getByText(/request:REQ-001/)).toBeInTheDocument();
    expect(screen.getByText(/approval:APR-001/)).toBeInTheDocument();
    expect(screen.getByText(/arbiter:evidence_score/)).toBeInTheDocument();
    expect(screen.getByText(/rules:critical_exec/)).toBeInTheDocument();
    expect(screen.getByText(/trace:chain\.recent_denial \+30/)).toBeInTheDocument();
    expect(screen.getByText(/evidence:taint\.recent_sensitive_read/)).toBeInTheDocument();
    expect(screen.queryByText("暂无控制面证据")).not.toBeInTheDocument();
  });

  it("does not say control-plane evidence is absent when list rows omit detail payloadJson", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse(createPage([
        {
          ...createEvent("EVT-DETAIL-ONLY", "详情包含控制面证据"),
          policyDecision: undefined,
          primaryModule: undefined,
          requestId: undefined,
          approvalId: undefined,
          toolCallId: undefined,
          riskScore: undefined,
        },
      ])));

    renderEventsPage();

    await screen.findByText("EVT-DETAIL-ONLY");
    expect(screen.getByText(/列表未包含控制面证据/)).toBeInTheDocument();
    expect(screen.queryByText("暂无控制面证据")).not.toBeInTheDocument();
  });

  it("supports backend total-pages pagination, page selection, page size, and filters", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(createPage([createEvent("EVT-001", "初始审计事件")], 1, 10, 41)))
      .mockResolvedValueOnce(createJsonResponse(createPage([createEvent("EVT-LAST", "最后一页审计事件")], 5, 10, 41)))
      .mockResolvedValueOnce(createJsonResponse(createPage([createEvent("EVT-001", "初始审计事件")], 1, 10, 41)))
      .mockResolvedValueOnce(createJsonResponse(createPage([createEvent("EVT-PAGE-SIZE", "每页行数更新后的审计事件")], 1, 25, 41)))
      .mockResolvedValueOnce(createJsonResponse(createPage([createEvent("EVT-SEARCH", "搜索命中的审计事件")], 1, 25, 1)));

    renderEventsPage();

    await screen.findByText("EVT-001");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/events?pageNum=1&pageSize=10");
    expect(screen.getByTitle("5")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("5"));

    await screen.findByText("EVT-LAST");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/events?pageNum=5&pageSize=10");

    fireEvent.click(screen.getByTitle("1"));

    await screen.findByText("EVT-001");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/lynx/events?pageNum=1&pageSize=10");

    fireEvent.mouseDown(screen.getAllByRole("combobox").at(-1)!);
    fireEvent.click(await screen.findByText(/25/));

    await screen.findByText("EVT-PAGE-SIZE");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/lynx/events?pageNum=1&pageSize=25");

    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "exec" },
    });
    await chooseSelectOption("风险等级", "L3 高危");
    await chooseSelectOption("策略判定", "需审批");
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("EVT-SEARCH");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      "/lynx/events?q=exec&riskLevel=L3&enforcementAction=requireApproval&pageNum=1&pageSize=25",
    );
  });

  it("converts the component-library date range into list query bounds", () => {
    const query = buildDateRangeQuery([
      dayjs("2026-04-01"),
      dayjs("2026-04-03"),
    ]);

    expect(query).toEqual({
      fromMs: new Date(2026, 3, 1).getTime(),
      toMs: new Date(2026, 3, 3, 23, 59, 59, 999).getTime(),
    });
  });
});
