import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
    headers: {
      get: () => "application/json",
    },
  } as Response;
}

describe("App", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(createJsonResponse({
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
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("renders the dashboard shell by default", async () => {
    const { container } = render(<App />);

    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(container.querySelector(".page-header__title")?.textContent).toBeTruthy();
    expect(container.querySelector("a.topbar__githubButton")?.getAttribute("href")).toBe(
      "https://github.com/xuzhenggang/openclaw-lynx-guardian",
    );
    expect(container.querySelector(".topbar__githubIcon")).not.toBeNull();
    expect(container.querySelectorAll(".sidebar__linkIcon")).toHaveLength(7);
    expect(container.querySelector(".topbar__avatar")).not.toBeNull();
    expect(screen.getByText("Lynx Guardian")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/dashboard/overview");
    });
  });
});
