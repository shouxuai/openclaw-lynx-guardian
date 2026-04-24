import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
    headers: {
      get: () => "application/json",
    },
  } as unknown as Response;
}

describe("App", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const dashboardOverview = {
    totals: {
      eventCount: 0,
      highRiskEventCount: 0,
      toolCallCount: 0,
      approvalCount: 0,
      lynxCheckCount: 0,
      totalTokens: 0,
    },
    riskDistribution: [],
    enforcementDistribution: [],
    eventTrend: [],
    tokenTrend: [],
    recentHighRiskEvents: [],
    recentToolCalls: [],
    recentApprovals: [],
  };

  beforeEach(() => {
    window.history.replaceState({}, "", "/webview/");
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input) => {
      const requestUrl = String(input);
      if (requestUrl.startsWith("/lynx/events")) {
        return createJsonResponse({ items: [] });
      }

      return createJsonResponse(dashboardOverview);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/webview/");
  });

  it("renders the Stitch reference console shell by default", async () => {
    const { container } = render(<App />);

    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByText("OpenClaw")).toBeInTheDocument();
    expect(screen.getByText("GUARDIAN CONSOLE")).toBeInTheDocument();
    expect(screen.getByText("安全概览")).toBeInTheDocument();
    expect(screen.getByText("L0 指标")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "过去 24 小时" })).not.toBeInTheDocument();
    expect(container.querySelector("a.topbar__githubButton")).toBeNull();
    expect(container.querySelectorAll(".sidebar__linkIcon")).toHaveLength(6);
    expect(screen.getByText("系统管理员")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/dashboard/overview");
    });
  });

  it("normalizes bare frontend paths into the webview route scope", async () => {
    window.history.replaceState({}, "", "/events");

    render(<App />);

    expect(window.location.pathname).toBe("/webview/events");
    expect(screen.getByText("审计控制台")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/events?limit=10");
    });
  });

  it("renders webview-prefixed navigation links that route to real pages", async () => {
    render(<App />);

    expect(screen.getByRole("link", { name: "概览" })).toHaveAttribute("href", "/webview");
    expect(screen.getByRole("link", { name: "工具调用" })).toHaveAttribute(
      "href",
      "/webview/tool-calls",
    );
    expect(screen.getByRole("link", { name: "审批管理" })).toHaveAttribute(
      "href",
      "/webview/approvals",
    );
    expect(screen.getByRole("link", { name: "检查任务" })).toHaveAttribute(
      "href",
      "/webview/lynx-checks",
    );
    expect(screen.getByRole("link", { name: "Token 统计" })).toHaveAttribute(
      "href",
      "/webview/tokens",
    );

    const eventsLink = screen.getByRole("link", { name: "审计日志" });
    expect(eventsLink).toHaveAttribute("href", "/webview/events");

    fireEvent.click(eventsLink);

    expect(window.location.pathname).toBe("/webview/events");
    expect(screen.getByText("审计控制台")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/lynx/events?limit=10");
    });
  });
});
