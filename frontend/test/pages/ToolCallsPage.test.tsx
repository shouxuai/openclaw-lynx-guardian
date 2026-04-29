import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolCallsPage } from "../../src/pages/ToolCallsPage";

function createJsonResponse(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
    headers: {
      get: () => "application/json",
    },
  } as unknown as Response;
}

function createToolCall() {
  return {
    toolCallId: "TOOL-001",
    sessionKey: "session-1",
    runId: "run-1",
    approvalId: "APR-001",
    toolName: "exec",
    riskLevel: "L3",
    riskScore: 72,
    policyDecision: "confirm",
    enforcementAction: "requireApproval",
    startedAtMs: 1_776_945_600_000,
    finishedAtMs: 1_776_945_601_500,
    durationMs: 1500,
    resultStatus: "blocked",
    resultExcerpt: "命令被拦截",
  };
}

function createToolCallDetail() {
  return {
    ...createToolCall(),
    paramSummary: "powershell Get-Content secret.txt",
    paramHash: "param-hash-001",
    triggeredModules: ["M2:protected_file_access"],
    errorText: "policy denied",
    metadataJson: {
      decisionId: "decision-001",
      grantId: "grant-001",
      taintSummary: "secret-read",
    },
  };
}

describe("ToolCallsPage", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("opens tool call JSON details in a dialog instead of navigating to a missing route", async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ items: [createToolCall()] }))
      .mockResolvedValueOnce(createJsonResponse(createToolCallDetail()));

    render(<ToolCallsPage />);

    expect(await screen.findByText("TOOL-001")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看 JSON" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看 TOOL-001 JSON 详情" }));

    expect(await screen.findByRole("dialog", { name: "工具调用详情" })).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/tool-calls/TOOL-001");
    expect(screen.getByText("powershell Get-Content secret.txt")).toBeInTheDocument();
    expect(screen.getByText("M2:protected_file_access")).toBeInTheDocument();
    expect(screen.getByText(/"decisionId": "decision-001"/)).toBeInTheDocument();
  });
});
