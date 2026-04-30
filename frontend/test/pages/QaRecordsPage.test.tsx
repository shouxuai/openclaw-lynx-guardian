import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    chainNodes: [
      {
        nodeId: "qa-1:userPrompt",
        qaRecordId: "qa-1",
        type: "userPrompt",
        title: "用户提示词",
        summary: "请运行测试",
        occurredAtMs: 1_776_945_600_000,
      },
      {
        nodeId: "qa-1:terminal:tool-1",
        qaRecordId: "qa-1",
        type: "terminal",
        title: "终端命令",
        summary: "npm test",
        occurredAtMs: 1_776_945_601_000,
        status: "success",
        detailJson: {
          command: "npm test",
          cwd: "C:/repo",
          durationMs: 1234,
          stdout: "PASS",
          stderr: "",
        },
      },
      {
        nodeId: "qa-1:token:usage-1",
        qaRecordId: "qa-1",
        type: "tokenUsage",
        title: "Token 用量",
        summary: "900",
        occurredAtMs: 1_776_945_602_000,
        status: "estimated",
        detailJson: {
          usageEventId: "usage-1",
          sourceType: "estimated",
          totalTokens: 900,
          inputTokens: 600,
          outputTokens: 300,
        },
      },
      {
        nodeId: "qa-1:finalAnswer",
        qaRecordId: "qa-1",
        type: "finalAnswer",
        title: "最终回复",
        summary: "测试已通过",
        occurredAtMs: 1_776_945_603_000,
      },
    ],
    chainEdges: [
      { fromNodeId: "qa-1:userPrompt", toNodeId: "qa-1:terminal:tool-1" },
      { fromNodeId: "qa-1:terminal:tool-1", toNodeId: "qa-1:token:usage-1" },
      { fromNodeId: "qa-1:token:usage-1", toNodeId: "qa-1:finalAnswer" },
    ],
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

function createQaDetailWithoutTokenUsage() {
  const detail = createQaDetail({
    qaRecordId: "qa-no-usage",
    userPromptExcerpt: "abcd",
    finalAnswerExcerpt: "efgh",
    totalTokens: 0,
  });
  return {
    ...detail,
    chainNodes: detail.chainNodes.filter((node) => node.type !== "tokenUsage"),
    chainEdges: [],
    relatedEvents: [],
  };
}

async function chooseSelectOption(name: string, optionText: string): Promise<void> {
  fireEvent.mouseDown(screen.getByLabelText(name));
  const candidates = await screen.findAllByText(optionText);
  const dropdownOption = candidates.find((candidate) => candidate.closest(".ant-select-dropdown"));
  expect(dropdownOption).toBeDefined();
  fireEvent.click(dropdownOption!);
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
      if (url === "/lynx/qa-records/qa-no-usage") {
        return createJsonResponse(createQaDetailWithoutTokenUsage());
      }
      if (url === "/lynx/qa-records/qa-filtered") {
        return createJsonResponse(createQaDetail({
          qaRecordId: "qa-filtered",
          userPromptExcerpt: "danger command",
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
      if (url.includes("q=no-usage")) {
        return createJsonResponse({
          items: [createQaRecord({
            qaRecordId: "qa-no-usage",
            userPromptExcerpt: "abcd",
            finalAnswerExcerpt: "efgh",
            totalTokens: 0,
          })],
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

  it("renders QA records as a structured list with filter-visible columns", async () => {
    render(<QaRecordsPage />);

    expect(screen.getByText("问答记录")).toBeInTheDocument();
    expect(await screen.findByText("qa-1")).toBeInTheDocument();

    expect(screen.getByRole("columnheader", { name: "问答 ID" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "用户输入" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "状态" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "风险" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "工具调用" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Token" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "操作" })).not.toBeInTheDocument();
    expect(screen.getByText("请运行测试")).toBeInTheDocument();
    expect(screen.getByText("1 次")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看 .*问答详情/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "问答详情" })).not.toBeInTheDocument();
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
    expect(screen.getAllByText("L2 中危").length).toBeGreaterThan(0);
    expect(screen.queryByText("0 Token")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "danger" },
    });
    await chooseSelectOption("状态", "已完成");
    await chooseSelectOption("风险等级", "L2 中危");
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("qa-filtered");
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => {
        const url = String(call[0]);
        return url.includes("/lynx/qa-records?")
          && url.includes("q=danger")
          && url.includes("status=completed")
          && url.includes("riskLevel=L2");
      })).toBe(true);
    });
  });

  it("opens QA details in a side drawer and shows related audit events in a dialog", async () => {
    render(<QaRecordsPage />);

    await screen.findByText("qa-1");
    fireEvent.click(screen.getByRole("row", { name: /qa-1.*请运行测试/ }));

    const detailDrawer = await screen.findByRole("dialog", { name: "问答详情" });
    expect(detailDrawer).toHaveClass("side-drawer");
    expect(detailDrawer).not.toHaveClass("modal-dialog");
    expect(within(detailDrawer).getByText("用户问题")).toBeInTheDocument();
    await screen.findByText("约 900 Token");
    expect(screen.queryByText("0 Token")).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "查看关联审计事件" })).toBeInTheDocument();
    expect(screen.queryByText("event-qa-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看关联审计事件" }));

    const dialog = await screen.findByRole("dialog", { name: "关联审计事件" });
    expect(within(dialog).getByText("event-qa-1")).toBeInTheDocument();
    expect(within(dialog).getByText("工具调用存在风险信号")).toBeInTheDocument();
  });

  it("estimates token usage in the detail drawer when stored usage is unavailable", async () => {
    render(<QaRecordsPage />);

    await screen.findByText("qa-1");
    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "no-usage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("qa-no-usage");
    fireEvent.click(screen.getByRole("row", { name: /qa-no-usage.*abcd/ }));

    const detailDrawer = await screen.findByRole("dialog", { name: "问答详情" });
    expect(detailDrawer).toHaveClass("side-drawer");
    expect(await within(detailDrawer).findByText("约 3 Token")).toBeInTheDocument();
    expect(within(detailDrawer).queryByText("未统计")).not.toBeInTheDocument();
    expect(within(detailDrawer).queryByText("0 Token")).not.toBeInTheDocument();
  });

  it("expands the execution chain and shows terminal command detail", async () => {
    render(<QaRecordsPage />);

    await screen.findByText("qa-1");
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/lynx/qa-records?pageNum=1&pageSize=20");
    });
    fireEvent.click(screen.getByRole("row", { name: /qa-1.*请运行测试/ }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/lynx/qa-records/qa-1");
    });
    await screen.findByText("约 900 Token");

    fireEvent.click(screen.getByRole("button", { name: /展开.*执行链路/ }));

    const detailDrawer = await screen.findByRole("dialog", { name: "问答详情" });
    expect(await within(detailDrawer).findByTestId("qa-detail-flow")).toBeInTheDocument();
    expect(await within(detailDrawer).findByText("用户提示词")).toBeInTheDocument();
    expect(within(detailDrawer).getByText("工具调用")).toBeInTheDocument();
    expect(within(detailDrawer).getByText("最终回复")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /终端.*命令/ }));

    expect(await screen.findByText("执行命令")).toBeInTheDocument();
    expect(screen.getByTestId("qa-node-detail")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("C:/repo")).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });
});
