import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import { MemoryRouter } from "react-router-dom";
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

function createSecurityEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "security:tool:tool-1",
    eventKind: "tool",
    processKind: "conversation",
    processId: "qa-1",
    qaRecordId: "qa-1",
    runId: "run-1",
    sessionKey: "session-1",
    toolCallId: "tool-1",
    title: "工具调用检查",
    summary: "执行命令前触发 L4 阻断",
    objectLabel: "exec",
    contentExcerpt: "Remove-Item -Recurse C:\\important",
    occurredAtMs: 1_776_945_600_000,
    riskLevel: "L4",
    riskScore: 10,
    policyDecision: "deny",
    enforcementAction: "block",
    rawAuditEventIds: ["event-1", "event-2"],
    rawAuditCount: 2,
    detailJson: {
      command: "Remove-Item -Recurse C:\\important",
      cwd: "C:\\repo",
    },
    ...overrides,
  };
}

function createSecurityEventDetail() {
  return {
    ...createSecurityEvent(),
    rawAuditEvents: [
      {
        eventId: "event-1",
        sourceKind: "plugin_hook",
        hookName: "before_tool_call",
        eventType: "tool_call_evaluated",
        category: "tool",
        riskLevel: "L4",
        enforcementAction: "block",
        title: "原始工具审计",
        occurredAtMs: 1_776_945_600_000,
      },
    ],
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

function createSecurityEventSummary(overrides: Record<string, unknown> = {}) {
  return {
    total: 42,
    riskCounts: {
      L0: 10,
      L1: 0,
      L2: 0,
      L3: 7,
      L4: 5,
    },
    eventKindCounts: {
      input: 10,
      tool: 20,
      output: 8,
      install: 2,
      process: 2,
    },
    enforcementActionCounts: {
      allow: 30,
      logOnly: 0,
      warn: 7,
      redact: 0,
      requireApproval: 0,
      block: 5,
    },
    ...overrides,
  };
}

function renderEventsPage() {
  return render(
    <ConfigProvider locale={zhCN}>
      <MemoryRouter>
        <EventsPage />
      </MemoryRouter>
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

  it("renders user-visible security events by default with a standalone time column", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/lynx/security-events/summary") {
        return createJsonResponse(createSecurityEventSummary());
      }
      if (url === "/lynx/security-events/security%3Atool%3Atool-1") {
        return createJsonResponse(createSecurityEventDetail());
      }
      if (url === "/lynx/security-events?pageNum=1&pageSize=10") {
        return createJsonResponse(createPage([
          createSecurityEvent(),
          createSecurityEvent({
            eventId: "security:output:qa-2",
            eventKind: "output",
            title: "输出检查",
            objectLabel: "回答内容",
            contentExcerpt: "回答内容",
            riskLevel: "L3",
            enforcementAction: "warn",
            rawAuditEventIds: ["event-3"],
            rawAuditCount: 1,
          }),
          createSecurityEvent({
            eventId: "security:input:qa-1",
            eventKind: "input",
            title: "输入检查",
            objectLabel: "请检查当前项目",
            contentExcerpt: "请检查当前项目",
            riskLevel: "L0",
            enforcementAction: "allow",
            rawAuditEventIds: [],
            rawAuditCount: 0,
          }),
        ], 1, 10, 42));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderEventsPage();

    await screen.findByText("security:tool:tool-1");
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
        "/lynx/security-events?pageNum=1&pageSize=10",
        "/lynx/security-events/summary",
      ]));
    });
    const summary = screen.getByLabelText("当前筛选安全事件概览");
    expect(within(summary).getByText("42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即刷新" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "原始审计流水" })).toHaveAttribute("href", "/raw-events");
    const l4Card = within(summary).getByText("L4").closest("article");
    expect(l4Card).not.toBeNull();
    expect(within(l4Card!).getByText("5")).toBeInTheDocument();
    expect(within(summary).getByText("L0")).toBeInTheDocument();
    expect(within(summary).getByText("L1")).toBeInTheDocument();
    expect(within(summary).getByText("L2")).toBeInTheDocument();
    expect(within(summary).getByText("L3")).toBeInTheDocument();
    expect(within(summary).getByText("L4")).toBeInTheDocument();
    expect(within(summary).queryByText("L3 / L4")).not.toBeInTheDocument();
    expect(within(summary).queryByText("当前页")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "时间" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "事件类型" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "过程" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "对象/内容" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "风险等级" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "处置动作" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "关联问答" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "原始证据" })).toBeInTheDocument();
    expect(screen.getByText("工具调用检查")).toBeInTheDocument();
    expect(screen.getByText("工具")).toBeInTheDocument();
    expect(screen.getByText("会话")).toBeInTheDocument();
    expect(screen.getByText("2 条")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 security:tool:tool-1 详情" }));
    const dialog = await screen.findByRole("dialog", { name: "工具调用检查" });
    expect(within(dialog).getByText("事件概览")).toBeInTheDocument();
    expect(within(dialog).getByText("基础信息")).toBeInTheDocument();
    expect(within(dialog).getByText("原始证据")).toBeInTheDocument();
    expect(within(dialog).getByText("event-1")).toBeInTheDocument();
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/lynx/security-events/security%3Atool%3Atool-1");
  });

  it("links to raw audit evidence count and supports security-event filters", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/lynx/security-events/summary") {
        return createJsonResponse(createSecurityEventSummary({ total: 1 }));
      }
      if (url === "/lynx/security-events?pageNum=1&pageSize=10") {
        return createJsonResponse(createPage([createSecurityEvent()], 1, 10, 1));
      }
      if (url === "/lynx/security-events/summary?q=exec&riskLevel=L4&eventKind=output") {
        return createJsonResponse(createSecurityEventSummary({
          total: 9,
          riskCounts: { L0: 0, L1: 0, L2: 0, L3: 0, L4: 9 },
        }));
      }
      if (url === "/lynx/security-events?q=exec&riskLevel=L4&eventKind=output&pageNum=1&pageSize=10") {
        return createJsonResponse(createPage([
          createSecurityEvent({ eventId: "security:output:qa-2", eventKind: "output", title: "输出检查" }),
        ], 1, 10, 9));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderEventsPage();

    await screen.findByText("security:tool:tool-1");
    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "exec" },
    });
    await chooseSelectOption("风险等级", "L4 严重");
    await chooseSelectOption("事件类型", "输出");
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("security:output:qa-2");
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
        "/lynx/security-events/summary?q=exec&riskLevel=L4&eventKind=output",
        "/lynx/security-events?q=exec&riskLevel=L4&eventKind=output&pageNum=1&pageSize=10",
      ]));
    });
    const summary = screen.getByLabelText("当前筛选安全事件概览");
    expect(within(summary).getAllByText("9").length).toBeGreaterThan(0);
  });

  it("keeps rendering when the summary payload omits count maps", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/lynx/security-events/summary") {
        return createJsonResponse({ total: 3 });
      }
      if (url === "/lynx/security-events?pageNum=1&pageSize=10") {
        return createJsonResponse(createPage([], 1, 10, 3));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderEventsPage();

    const summary = await screen.findByLabelText("当前筛选安全事件概览");
    expect(within(summary).getByText("3")).toBeInTheDocument();
    const l0Card = within(summary).getByText("L0").closest("article");
    expect(l0Card).not.toBeNull();
    expect(within(l0Card!).getByText("0")).toBeInTheDocument();
    expect((await screen.findAllByText("暂无安全事件")).length).toBeGreaterThan(0);
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
