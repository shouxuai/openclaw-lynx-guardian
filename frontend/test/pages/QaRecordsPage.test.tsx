import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QaRecordsPage } from "../../src/pages/QaRecordsPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function createQaRecord(overrides: Record<string, unknown> = {}) {
  return {
    qaRecordId: "qa-1",
    sessionKey: "session-1",
    runId: "run-1",
    agentId: "main",
    userPromptExcerpt: "请运行测试",
    finalAnswerExcerpt: "测试已通过",
    status: "completed",
    riskLevel: "L2",
    toolCallCount: 1,
    approvalCount: 0,
    detectionCount: 1,
    totalTokens: 0,
    startedAtMs: 1_776_945_600_000,
    completedAtMs: 1_776_945_603_000,
    ...overrides,
  };
}

function createDisplayNode(kind: string, overrides: Record<string, unknown> = {}) {
  return {
    eventId: `security:${kind}:qa-1`,
    eventKind: kind,
    processKind: "conversation",
    processId: "qa-1",
    qaRecordId: "qa-1",
    title: kind === "input" ? "输入检查" : kind === "tool" ? "工具调用检查" : "输出检查",
    summary: kind === "tool" ? "npm test" : "安全检查通过",
    objectLabel: kind === "tool" ? "exec" : "请运行测试",
    occurredAtMs: kind === "input" ? 1_776_945_600_000 : kind === "tool" ? 1_776_945_601_000 : 1_776_945_603_000,
    riskLevel: kind === "tool" ? "L2" : "L0",
    enforcementAction: kind === "tool" ? "warn" : "allow",
    rawAuditEventIds: kind === "tool" ? ["event-qa-1"] : [],
    rawAuditCount: kind === "tool" ? 1 : 0,
    detailJson: kind === "tool"
      ? {
          command: "npm test",
          cwd: "C:/repo",
          durationMs: 1234,
          stdout: "PASS",
          stderr: "",
        }
      : {},
    ...overrides,
  };
}

function createAuditEvent() {
  return {
    eventId: "event-qa-1",
    qaRecordId: "qa-1",
    sourceKind: "hook",
    hookName: "before_tool_call",
    eventType: "policy_decision",
    category: "tool",
    riskLevel: "L2",
    riskScore: 42,
    policyDecision: "warn",
    enforcementAction: "warn",
    title: "工具调用存在风险信号",
    summary: "检测到工具调用风险，需要复核。",
    occurredAtMs: 1_776_945_602_000,
  };
}

function createQaDetail(overrides: Record<string, unknown> = {}) {
  const record = createQaRecord(overrides);
  return {
    ...record,
    displayChainNodes: [
      createDisplayNode("input"),
      createDisplayNode("tool"),
      createDisplayNode("output"),
    ],
    chainNodes: [],
    chainEdges: [],
    relatedToolCalls: [{
      toolCallId: "tool-1",
      qaRecordId: "qa-1",
      toolName: "exec",
      enforcementAction: "allow",
      startedAtMs: 1_776_945_601_000,
      resultStatus: "success",
      resultExcerpt: "PASS",
    }],
    relatedApprovals: [],
    relatedEvents: [createAuditEvent()],
    relatedDetections: [],
  };
}

function createQaSummary(overrides: Record<string, unknown> = {}) {
  return {
    total: 12,
    toolCallCount: 21,
    approvalCount: 3,
    detectionCount: 5,
    totalTokens: 1440,
    riskCounts: {
      L0: 4,
      L1: 0,
      L2: 6,
      L3: 1,
      L4: 1,
    },
    statusCounts: {
      completed: 9,
      running: 1,
      failed: 2,
    },
    ...overrides,
  };
}

function renderQaRecordsPage() {
  return render(
    <ConfigProvider locale={zhCN}>
      <QaRecordsPage />
    </ConfigProvider>,
  );
}

describe("QaRecordsPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/lynx/qa-records/qa-1") {
        return createJsonResponse(createQaDetail());
      }
      if (url === "/lynx/qa-records/summary") {
        return createJsonResponse(createQaSummary());
      }
      if (url === "/lynx/qa-records/summary?q=danger") {
        return createJsonResponse(createQaSummary({
          total: 4,
          toolCallCount: 8,
          approvalCount: 2,
          detectionCount: 3,
          totalTokens: 340,
        }));
      }
      if (url.includes("q=danger")) {
        return createJsonResponse({
          items: [createQaRecord({ qaRecordId: "qa-filtered", userPromptExcerpt: "danger command", totalTokens: 340 })],
          total: 1,
          pageNum: 1,
          pageSize: 20,
          totalPages: 1,
        });
      }
      return createJsonResponse({
        items: [createQaRecord()],
        total: 1,
        pageNum: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders QA records with a standalone time column", async () => {
    renderQaRecordsPage();

    expect(screen.getByText("问答记录")).toBeInTheDocument();
    expect(await screen.findByText("qa-1")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
        "/lynx/qa-records?pageNum=1&pageSize=20",
        "/lynx/qa-records/summary",
      ]));
    });
    const totalCard = screen.getByText("问答总数").closest(".metric-card");
    expect(totalCard).not.toBeNull();
    expect(within(totalCard!).getByText("12")).toBeInTheDocument();
    const toolCard = screen.getByText("工具次数").closest(".metric-card");
    expect(toolCard).not.toBeNull();
    expect(within(toolCard!).getByText("21")).toBeInTheDocument();
    expect(screen.getByText("时间范围")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "时间" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "问答 ID" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "用户输入" })).toBeInTheDocument();
    expect(screen.getByText("请运行测试")).toBeInTheDocument();
  });

  it("shows the display chain by default when QA detail loads", async () => {
    renderQaRecordsPage();

    await screen.findByText("qa-1");
    fireEvent.click(screen.getByRole("row", { name: /qa-1.*请运行测试/ }));

    const drawer = await screen.findByRole("dialog", { name: "问答详情" });
    expect(drawer).toHaveClass("side-drawer--wide");
    expect(await within(drawer).findByTestId("qa-display-chain")).toBeInTheDocument();
    expect(within(drawer).getByText("输入检查")).toBeInTheDocument();
    expect(within(drawer).getByText("工具调用检查")).toBeInTheDocument();
    expect(within(drawer).getByText("输出检查")).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: /展开执行链路/ })).not.toBeInTheDocument();
  });

  it("closes the QA detail drawer when its backdrop is clicked", async () => {
    renderQaRecordsPage();

    await screen.findByText("qa-1");
    fireEvent.click(screen.getByRole("row", { name: /qa-1.*请运行测试/ }));

    const drawer = await screen.findByRole("dialog", { name: "问答详情" });
    expect(drawer).toBeInTheDocument();
    const backdrop = document.querySelector(".side-drawer-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop!);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "问答详情" })).not.toBeInTheDocument();
    });
  });

  it("expands a clicked node inside that node card and does not render the old bottom detail panel", async () => {
    renderQaRecordsPage();

    await screen.findByText("qa-1");
    fireEvent.click(screen.getByRole("row", { name: /qa-1.*请运行测试/ }));
    const drawer = await screen.findByRole("dialog", { name: "问答详情" });

    fireEvent.click(await within(drawer).findByRole("button", { name: /工具调用检查/ }));

    const toolCard = await within(drawer).findByTestId("qa-display-node-security:tool:qa-1");
    expect(within(toolCard).getByText("命令")).toBeInTheDocument();
    expect(within(toolCard).getByText("npm test")).toBeInTheDocument();
    expect(within(toolCard).getByText("C:/repo")).toBeInTheDocument();
    expect(within(toolCard).getByText("PASS")).toBeInTheDocument();
    expect(screen.queryByTestId("qa-node-detail")).not.toBeInTheDocument();
  });

  it("shows related raw audit events in a secondary dialog", async () => {
    renderQaRecordsPage();

    await screen.findByText("qa-1");
    fireEvent.click(screen.getByRole("row", { name: /qa-1.*请运行测试/ }));
    await screen.findByRole("dialog", { name: "问答详情" });

    fireEvent.click(screen.getByRole("button", { name: "查看关联审计事件" }));

    const dialog = await screen.findByRole("dialog", { name: "关联审计事件" });
    expect(within(dialog).getByText("event-qa-1")).toBeInTheDocument();
    expect(within(dialog).getByText("工具调用存在风险信号")).toBeInTheDocument();
  });

  it("applies QA filters", async () => {
    renderQaRecordsPage();

    await screen.findByText("qa-1");
    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "danger" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("qa-filtered");
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining([
        "/lynx/qa-records/summary?q=danger",
        "/lynx/qa-records?q=danger&pageNum=1&pageSize=20",
      ]));
    });
    const totalCard = screen.getByText("问答总数").closest(".metric-card");
    expect(totalCard).not.toBeNull();
    expect(within(totalCard!).getByText("4")).toBeInTheDocument();
  });
});
