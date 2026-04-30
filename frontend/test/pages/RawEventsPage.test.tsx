import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RawEventsPage } from "../../src/pages/RawEventsPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("RawEventsPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps raw audit events on the secondary page", async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      items: [
        {
          eventId: "raw-event-1",
          sourceKind: "plugin_hook",
          hookName: "before_tool_call",
          eventType: "tool_call_evaluated",
          category: "tool",
          title: "原始工具 Hook",
          riskLevel: "L3",
          enforcementAction: "requireApproval",
          occurredAtMs: 1_776_945_600_000,
        },
      ],
      total: 1,
      pageNum: 1,
      pageSize: 20,
      totalPages: 1,
    }));

    render(<RawEventsPage />);

    expect(await screen.findByText("raw-event-1")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/events?pageNum=1&pageSize=20");
    expect(screen.getByRole("columnheader", { name: "时间" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Hook" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "原始分类" })).toBeInTheDocument();
  });
});
