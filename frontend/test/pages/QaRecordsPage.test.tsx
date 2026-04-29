import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QaRecordsPage } from "../../src/pages/QaRecordsPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function createQaRecord() {
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
    detectionCount: 0,
    totalTokens: 120,
    startedAtMs: 1_776_945_600_000,
    completedAtMs: 1_776_945_603_000,
  };
}

function createQaDetail() {
  const record = createQaRecord();
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
      { fromNodeId: "qa-1:terminal:tool-1", toNodeId: "qa-1:finalAnswer" },
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
    relatedEvents: [],
    relatedDetections: [],
  };
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

  it("loads QA records, expands the tool chain, and shows terminal command detail", async () => {
    render(<QaRecordsPage />);

    expect(screen.getByText("问答记录")).toBeInTheDocument();
    expect(await screen.findByText("qa-1")).toBeInTheDocument();
    expect(screen.getByLabelText("关键词")).toBeInTheDocument();
    expect(screen.getByLabelText("状态")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/lynx/qa-records?pageNum=1&pageSize=20");
      expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/lynx/qa-records/qa-1");
    });

    fireEvent.click(screen.getByRole("button", { name: /展开.*工具链/ }));

    expect(screen.getByTestId("qa-detail-flow")).toBeInTheDocument();
    expect(await screen.findByText("用户提示词")).toBeInTheDocument();
    expect(screen.getByText("工具调用")).toBeInTheDocument();
    expect(screen.getByText("最终回复")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /终端.*命令/ }));

    expect(await screen.findByText("执行命令")).toBeInTheDocument();
    expect(screen.getByTestId("qa-node-detail")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("C:/repo")).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();
  });
});
