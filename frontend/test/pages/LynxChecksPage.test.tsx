import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LynxChecksPage } from "../../src/pages/LynxChecksPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function createCheck(overrides: Record<string, unknown>) {
  return {
    requestId: "CHECK-001",
    source: "manual",
    trigger: "lynx_command",
    preferredTargetKind: "recent",
    status: "completed",
    sendAttempted: true,
    sendSucceeded: true,
    transport: "webchat",
    createdAtMs: 1_776_945_600_000,
    completedAtMs: 1_776_945_603_000,
    ...overrides,
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

async function chooseSelectOption(name: string, optionText: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name }));
  const matches = await screen.findAllByText(optionText);
  fireEvent.click(matches.at(-1)!);
}

describe("LynxChecksPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses report paths from facts and evidenceBundle and avoids fake runtime status text", async () => {
    const fullReport = [
      "# Lynx Detection",
      "",
      "## Full Section",
      "这里是完整检测报告正文。",
      "END-OF-FULL-REPORT",
    ].join("\n");
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/lynx/lynx-checks/CHECK-FACTS") {
        return createJsonResponse({
          ...createCheck({
            requestId: "CHECK-FACTS",
            qaRecordId: "qa-1",
            reportPath: ".openclaw/lynx/check-runs/facts.report.md",
          }),
          reportMarkdown: fullReport,
        });
      }
      return createJsonResponse(createPage([
        createCheck({
          requestId: "CHECK-FACTS",
          qaRecordId: "qa-1",
          facts: {
            reportPath: ".openclaw/lynx/check-runs/facts.report.md",
          },
        }),
        createCheck({
          requestId: "CHECK-EVIDENCE",
          status: "failed",
          sendSucceeded: false,
          errorMessage: "delivery failed",
          completedAtMs: 1_776_945_601_000,
          evidenceBundle: {
            reportPath: ".openclaw/lynx/check-runs/evidence.report.md",
          },
        }),
      ]));
    });

    render(<LynxChecksPage />);

    expect(screen.getByText("检测报告")).toBeInTheDocument();
    expect(await screen.findByText("CHECK-FACTS")).toBeInTheDocument();
    expect(await screen.findByText("最近检测报告")).toBeInTheDocument();
    expect(screen.getByTestId("lynx-checks-workspace")).toBeInTheDocument();
    expect(screen.queryByText("Task State")).not.toBeInTheDocument();
    expect(screen.queryByText("证据")).not.toBeInTheDocument();
    expect(screen.queryByText("报告路径")).not.toBeInTheDocument();
    expect(screen.getByLabelText("关键词")).toBeInTheDocument();
    expect(screen.getByLabelText("处理状态")).toBeInTheDocument();
    expect(screen.getByText("qa-1")).toBeInTheDocument();
    expect(screen.getByText("未关联问答记录")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/lynx-checks?pageNum=1&pageSize=20");
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/lynx/lynx-checks/CHECK-FACTS");
    });
    fireEvent.click(screen.getByRole("button", { name: "查看 CHECK-FACTS 检测报告" }));
    const reportMarkdown = await screen.findByTestId("lynx-check-report-markdown");
    expect(reportMarkdown).toHaveTextContent("## Full Section");
    expect(reportMarkdown).toHaveTextContent("END-OF-FULL-REPORT");
    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
    expect(screen.getByText(".openclaw/lynx/check-runs/facts.report.md")).toBeInTheDocument();
    expect(screen.getByText(".openclaw/lynx/check-runs/evidence.report.md")).toBeInTheDocument();
    expect(screen.queryByText("Live Streaming")).not.toBeInTheDocument();
    expect(screen.queryByText(/2023-10-24/)).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.queryByText("5s / 次")).not.toBeInTheDocument();
    expect(screen.queryByText("P95: 1.2s")).not.toBeInTheDocument();
  });

  it("sends keyword, status, and trigger filters to the list API", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/CHECK-")) {
        return createJsonResponse(createCheck({ requestId: url.split("/").at(-1) ?? "CHECK-DETAIL" }));
      }
      if (url.includes("q=qa-42")) {
        return createJsonResponse(createPage([
          createCheck({ requestId: "CHECK-FILTERED" }),
        ], 1, 20, 1));
      }
      return createJsonResponse(createPage([
        createCheck({ requestId: "CHECK-001" }),
      ]));
    });

    render(<LynxChecksPage />);

    await screen.findByText("CHECK-001");
    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "qa-42" },
    });
    await chooseSelectOption("处理状态", "已完成");
    await chooseSelectOption("触发方式", "命令触发");
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("CHECK-FILTERED");
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain(
      "/lynx/lynx-checks?q=qa-42&status=completed&trigger=lynx_command&pageNum=1&pageSize=20",
    );

    fireEvent.click(screen.getByRole("button", { name: "重置条件" }));

    await waitFor(() => {
      const listRequests = fetchMock.mock.calls.map((call) => call[0]);
      expect(listRequests.filter((url) => url === "/lynx/lynx-checks?pageNum=1&pageSize=20")).toHaveLength(2);
    });
  });
});
