import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App";
import { PRIMARY_NAV_ITEMS } from "../../src/app/nav-config";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
    headers: {
      get: () => "application/json",
    },
  } as unknown as Response;
}

function createPage(items: unknown[]) {
  return {
    items,
    total: items.length,
    pageNum: 1,
    pageSize: 10,
    totalPages: items.length === 0 ? 0 : 1,
  };
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
        return createJsonResponse(createPage([]));
      }
      if (requestUrl.startsWith("/lynx/sessions")) {
        return createJsonResponse(createPage([]));
      }
      if (requestUrl.startsWith("/lynx/qa-records")) {
        return createJsonResponse(createPage([]));
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

  it("renders the control plane console shell by default", async () => {
    const { container } = render(<App />);

    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByText("OpenClaw")).toBeInTheDocument();
    expect(screen.getByText("GUARDIAN CONSOLE")).toBeInTheDocument();
    expect(screen.getByText("安全概览")).toBeInTheDocument();
    expect(screen.getByText("L0 指标")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "过去 24 小时" })).not.toBeInTheDocument();
    expect(container.querySelector("a.topbar__githubButton")).toBeNull();
    const sidebarIcons = [...container.querySelectorAll(".sidebar__linkIcon")];
    expect(sidebarIcons).toHaveLength(PRIMARY_NAV_ITEMS.length);
    expect(new Set(sidebarIcons.map((icon) => icon.innerHTML)).size).toBe(sidebarIcons.length);
    expect(screen.queryByText("系统管理员")).not.toBeInTheDocument();

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
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/events?pageNum=1&pageSize=10");
    });
  });

  it("renders webview-prefixed navigation links that route to real pages", async () => {
    render(<App />);

    expect(screen.getByRole("link", { name: "概览" })).toHaveAttribute("href", "/webview");
    expect(screen.getByRole("link", { name: "问答记录" })).toHaveAttribute(
      "href",
      "/webview/qa-records",
    );
    expect(screen.getByRole("link", { name: "决策观测" })).toHaveAttribute(
      "href",
      "/webview/decisions",
    );
    expect(screen.getByRole("link", { name: "工具调用" })).toHaveAttribute(
      "href",
      "/webview/tool-calls",
    );
    expect(screen.getByRole("link", { name: "审批管理" })).toHaveAttribute(
      "href",
      "/webview/approvals",
    );
    expect(screen.getByRole("link", { name: "多轮链路" })).toHaveAttribute(
      "href",
      "/webview/chains",
    );
    expect(screen.getByRole("link", { name: "链路授权" })).toHaveAttribute(
      "href",
      "/webview/grants",
    );
    expect(screen.getByRole("link", { name: "检测报告" })).toHaveAttribute(
      "href",
      "/webview/lynx-checks",
    );
    expect(screen.getByRole("link", { name: "会话" })).toHaveAttribute(
      "href",
      "/webview/sessions",
    );
    expect(screen.getByRole("link", { name: "Skill 供应链" })).toHaveAttribute(
      "href",
      "/webview/skills",
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
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("/lynx/events?pageNum=1&pageSize=10");
    });
  });

  it("lets sidebar function groups collapse without breaking route links", async () => {
    render(<App />);

    const auditGroup = screen.getByRole("button", { name: "审计" });
    expect(auditGroup).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "审计日志" })).toHaveAttribute(
      "href",
      "/webview/events",
    );

    fireEvent.click(auditGroup);

    expect(auditGroup).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "审计日志" })).not.toBeInTheDocument();

    fireEvent.click(auditGroup);

    const eventsLink = screen.getByRole("link", { name: "审计日志" });
    expect(auditGroup).toHaveAttribute("aria-expanded", "true");
    expect(eventsLink).toHaveAttribute("href", "/webview/events");

    await waitFor(() => {
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/dashboard/overview");
    });
  });

  it("selects light, mixed, and dark console themes from the top bar dropdown", async () => {
    const { container } = render(<App />);
    const shell = container.querySelector(".console-shell");
    const mixedThemeButton = screen.getByRole("button", { name: "主题模式：混合" });

    expect(shell).toHaveAttribute("data-theme", "mixed");
    expect(mixedThemeButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(mixedThemeButton);
    fireEvent.click(screen.getByRole("option", { name: "浅色" }));

    expect(shell).toHaveAttribute("data-theme", "light");
    expect(screen.getByRole("button", { name: "主题模式：浅色" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "主题模式：浅色" }));
    fireEvent.click(screen.getByRole("option", { name: "深色" }));

    expect(shell).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: "主题模式：深色" })).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/dashboard/overview");
    });
  });

  it("collapses and expands the sidebar from the sidebar footer", async () => {
    const { container } = render(<App />);
    const shell = container.querySelector(".console-shell");

    expect(shell).toHaveAttribute("data-sidebar", "expanded");

    fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));

    expect(shell).toHaveAttribute("data-sidebar", "collapsed");
    expect(screen.getByRole("button", { name: "展开侧边栏" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "审计日志" })).toHaveAttribute(
      "href",
      "/webview/events",
    );

    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));

    expect(shell).toHaveAttribute("data-sidebar", "expanded");
    expect(screen.getByRole("button", { name: "收起侧边栏" })).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/dashboard/overview");
    });
  });
});
