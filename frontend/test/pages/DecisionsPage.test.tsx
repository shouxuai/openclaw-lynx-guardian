import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DecisionsPage } from "../../src/pages/DecisionsPage";

function createDecision(overrides: Record<string, unknown>) {
  return {
    decisionId: "decision-approval-1",
    stage: "input",
    block: false,
    action: "require_approval",
    riskLevel: "L0",
    score: 8,
    winningArbiter: "evidence_score",
    matchedModules: ["approval_bypass"],
    requiresApproval: true,
    audit: {
      eventSeverity: "info",
      policyDecision: "require_approval",
      enforcementAction: "require_approval",
      color: "yellow",
    },
    arbiters: [
      {
        arbiter: "evidence_score",
        riskLevel: "L2",
        action: "require_approval",
        score: 42,
        matchedModules: ["approval_bypass"],
        evidence: [
          {
            id: "approval.bypass_phrase",
            module: "approval_bypass",
            kind: "phrase",
            value: "skip approval",
            severity: "warn",
            scoreDelta: 30,
            source: "input",
          },
        ],
        scoreBreakdown: [
          {
            ruleId: "approval.bypass_phrase",
            label: "approval bypass phrase",
            delta: 30,
            reason: "User tried to bypass approval",
          },
        ],
        reason: "approval bypass phrase",
      },
    ],
    ...overrides,
  };
}

function expectTableFitsDefaultContentWidth(container: HTMLElement): void {
  const table = container.querySelector(".data-table") as HTMLTableElement | null;
  const minWidth = Number.parseFloat(table?.style.minWidth ?? "0");

  expect(minWidth).toBeLessThanOrEqual(1136);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DecisionsPage tone mapping", () => {
  it("renders block false approval and degraded decisions as warning instead of safe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [
      createDecision({ decisionId: "decision-approval-1", requiresApproval: true }),
      createDecision({
        decisionId: "decision-degraded-1",
        requiresApproval: false,
        degraded: { reason: "backend fallback" },
      }),
      ],
      total: 2,
      pageNum: 1,
      pageSize: 20,
      totalPages: 1,
    }), { status: 200 })));

    render(<DecisionsPage />);

    const approvalRow = (await screen.findByText("decision-approval-1")).closest("tr");
    const degradedRow = screen.getByText("decision-degraded-1").closest("tr");

    expect(approvalRow).not.toBeNull();
    expect(degradedRow).not.toBeNull();
    expect(within(approvalRow!).getByText("未阻断")).toHaveClass("status-badge--warning");
    expect(within(degradedRow!).getByText("未阻断")).toHaveClass("status-badge--warning");
  });

  it("shows control-plane audit action, approval, matched rules, and score evidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [
      createDecision({ decisionId: "decision-evidence-1" }),
      ],
      total: 1,
      pageNum: 1,
      pageSize: 20,
      totalPages: 1,
    }), { status: 200 })));

    render(<DecisionsPage />);

    const row = (await screen.findByText("decision-evidence-1")).closest("tr");

    expect(row).not.toBeNull();
    expect(within(row!).getByText("审批")).toBeInTheDocument();
    expect(within(row!).getByText("需要审批")).toBeInTheDocument();
    fireEvent.click(within(row!).getByRole("button", { name: "查看 decision-evidence-1 裁决详情" }));

    expect(screen.getByRole("dialog", { name: "裁决详情" })).toBeInTheDocument();
    expect(screen.getByText("approval.bypass_phrase")).toBeInTheDocument();
    expect(screen.getByText("approval.bypass_phrase +30")).toBeInTheDocument();
    expect(screen.getByText("evidence_score")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "裁决详情" })).getByText("绕过审批意图（approval_bypass）")).toBeInTheDocument();
  });

  it("shows the ordinary-language decision reason directly in the table", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [
      createDecision({
        decisionId: "decision-why-1",
        riskLevel: "L3",
        matchedModules: ["approval_bypass", "protected_file_access"],
        winningArbiter: "evidence_score",
      }),
      ],
      total: 1,
      pageNum: 1,
      pageSize: 20,
      totalPages: 1,
    }), { status: 200 })));

    render(<DecisionsPage />);

    const row = (await screen.findByText("decision-why-1")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText(/这次被判为 L3 高危/)).toBeInTheDocument();
    expect(within(row!).getByText(/命中了 绕过审批意图（approval_bypass）、访问受保护文件（protected_file_access）/)).toBeInTheDocument();
    expect(within(row!).getByText(/需要人工审批，不是直接放行/)).toBeInTheDocument();

    fireEvent.click(within(row!).getByRole("button", { name: "查看 decision-why-1 裁决详情" }));

    const dialog = screen.getByRole("dialog", { name: "裁决详情" });
    expect(within(dialog).getByText("裁决概览")).toBeInTheDocument();
    expect(within(dialog).queryByText("系统为什么这么判？")).not.toBeInTheDocument();
  });

  it("translates raw decision module codes in the table reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [
      createDecision({
        decisionId: "decision-raw-module-1",
        matchedModules: ["semantic", "M3", "M2"],
      }),
      ],
      total: 1,
      pageNum: 1,
      pageSize: 20,
      totalPages: 1,
    }), { status: 200 })));

    render(<DecisionsPage />);

    const row = (await screen.findByText("decision-raw-module-1")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText(/语义风险信号（semantic）/)).toBeInTheDocument();
    expect(within(row!).getByText(/高风险代理\/权限操作（M3）/)).toBeInTheDocument();
    expect(within(row!).getByText(/受保护资源访问（M2）/)).toBeInTheDocument();
  });

  it("uses pagination and filter controls instead of exposing every internal decision field in the table", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [createDecision({ decisionId: "decision-page-1" })],
        total: 41,
        pageNum: 1,
        pageSize: 20,
        totalPages: 3,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [createDecision({ decisionId: "decision-filtered" })],
        total: 1,
        pageNum: 1,
        pageSize: 20,
        totalPages: 1,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<DecisionsPage />);

    await screen.findByText("decision-page-1");
    expect(document.querySelector(".decision-summary-grid")).not.toBeNull();
    expectTableFitsDefaultContentWidth(container);
    expect(screen.getByText("裁决记录说明")).toBeInTheDocument();
    expect(screen.getByText(/回答“系统为什么这么判”/)).toBeInTheDocument();
    expect(screen.getByText(/告警类裁决需要查看详情证据/)).toBeInTheDocument();
    expect(container.querySelector(".table-explanation-card.ant-card")).not.toBeNull();
    expect(container.querySelector(".table-panel .table-explanation-card")).toBeNull();
    expect(container.querySelector(".table-panel__header .panel__subtitle")).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/lynx/decisions?pageNum=1&pageSize=20");
    expect(screen.getByTitle("3")).toBeInTheDocument();
    expect(screen.getByLabelText("关键词")).toBeInTheDocument();
    expect(screen.queryByText("Matched Rules")).not.toBeInTheDocument();
    expect(screen.queryByText("Score Breakdown")).not.toBeInTheDocument();
    expect(screen.queryByText("block:false")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("关键词"), {
      target: { value: "approval" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));

    await screen.findByText("decision-filtered");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/lynx/decisions?q=approval&pageNum=1&pageSize=20");
  });
});
