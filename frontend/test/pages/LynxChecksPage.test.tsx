import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("LynxChecksPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
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

    expect(screen.getByText("检测")).toBeInTheDocument();
    expect(await screen.findByText("CHECK-FACTS")).toBeInTheDocument();
    expect(await screen.findByText("最近检测报告")).toBeInTheDocument();
    expect(screen.getByText("qa-1")).toBeInTheDocument();
    expect(screen.getByText("未关联问答记录")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/lynx-checks?pageNum=1&pageSize=20");
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/lynx/lynx-checks/CHECK-FACTS");
    });
    fireEvent.click(screen.getByRole("button", { name: "查看 CHECK-FACTS 检测报告" }));
    expect(await screen.findByText("## Full Section")).toBeInTheDocument();
    expect(screen.getByText("END-OF-FULL-REPORT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
    expect(screen.getByText(".openclaw/lynx/check-runs/facts.report.md")).toBeInTheDocument();
    expect(screen.getByText(".openclaw/lynx/check-runs/evidence.report.md")).toBeInTheDocument();
    expect(screen.queryByText("Live Streaming")).not.toBeInTheDocument();
    expect(screen.queryByText(/2023-10-24/)).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.queryByText("5s / 次")).not.toBeInTheDocument();
    expect(screen.queryByText("P95: 1.2s")).not.toBeInTheDocument();
  });
});
