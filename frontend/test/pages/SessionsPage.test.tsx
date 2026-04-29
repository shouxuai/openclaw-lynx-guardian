import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionsPage } from "../../src/pages/SessionsPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

function createSession(sessionKey: string) {
  return {
    sessionKey,
    channelProfile: "webchat",
    isGroup: false,
    firstSeenAtMs: 1_776_945_000_000,
    lastSeenAtMs: 1_776_945_600_000,
    eventCount: 2,
    highRiskEventCount: 0,
    toolCallCount: 1,
  };
}

function createSessionDetail(sessionKey: string, totalTokens: number) {
  return {
    ...createSession(sessionKey),
    requesterOuId: `${sessionKey}-requester`,
    recentEvents: [],
    recentToolCalls: [],
    recentApprovals: [],
    tokenSummary: {
      totalTokens,
      inputTokens: totalTokens - 10,
      outputTokens: 10,
    },
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

describe("SessionsPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads the first session detail and switches detail when a different session row is clicked", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/lynx/sessions/session-a") {
        return createJsonResponse(createSessionDetail("session-a", 111));
      }
      if (url === "/lynx/sessions/session-b") {
        return createJsonResponse(createSessionDetail("session-b", 999));
      }
      return createJsonResponse(createPage([
        createSession("session-a"),
        createSession("session-b"),
      ]));
    });

    render(<SessionsPage />);

    expect(await screen.findByText("session-a")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/sessions?pageNum=1&pageSize=20");
    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/lynx/sessions/session-a");
    });

    fireEvent.click(screen.getByText("session-b"));

    await waitFor(() => {
      expect(fetchMock.mock.calls.map((call) => call[0])).toContain("/lynx/sessions/session-b");
    });
    expect(await screen.findByText(/总量：999/)).toBeInTheDocument();
    expect(screen.getByText(/session-b-requester/)).toBeInTheDocument();
  });
});
