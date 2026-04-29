import { render, screen } from "@testing-library/react";
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
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      items: [
        createCheck({
          requestId: "CHECK-FACTS",
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
      ],
    }));

    render(<LynxChecksPage />);

    expect(await screen.findByText("CHECK-FACTS")).toBeInTheDocument();
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
