import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { afterEach, describe, expect, it } from "vitest";

import { DataTable } from "../../src/components/tables/DataTable";

function mockElementOverflow(isOverflowing: boolean): () => void {
  const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
  const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const clientHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get: () => isOverflowing ? 200 : 80,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 100,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => isOverflowing ? 48 : 20,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 24,
  });

  return () => {
    for (const [key, descriptor] of [
      ["scrollWidth", scrollWidthDescriptor],
      ["clientWidth", clientWidthDescriptor],
      ["scrollHeight", scrollHeightDescriptor],
      ["clientHeight", clientHeightDescriptor],
    ] as const) {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, key, descriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, key);
      }
    }
  };
}

function expectTooltipContent(text: string): void {
  const tooltipTexts = Array.from(document.querySelectorAll(".table-cell-tooltip")).map(
    (tooltip) => tooltip.textContent,
  );

  expect(tooltipTexts).toContain(text);
}

describe("DataTable", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows tooltips for any overflowing primitive text cell", async () => {
    const restoreOverflow = mockElementOverflow(true);
    const longText = "This is a long audit summary that should remain readable in the tooltip without being clamped.";

    try {
      render(
        <ConfigProvider locale={zhCN}>
          <DataTable
            columns={[
              { key: "id", label: "ID", minWidth: 120, maxWidth: 180, width: 150 },
              { key: "summary", label: "Summary", minWidth: 240, maxWidth: 360, width: 300 },
            ]}
            rows={[{ id: "row-1", summary: longText }]}
          />
        </ConfigProvider>,
      );

      fireEvent.mouseEnter(screen.getByText("row-1"));

      await waitFor(() => {
        expectTooltipContent("row-1");
      });

      const visibleCellText = screen.getByText(longText);
      expect(visibleCellText).not.toHaveAttribute("title");

      fireEvent.mouseEnter(visibleCellText);

      await waitFor(() => {
        expect(screen.getAllByText(longText).length).toBeGreaterThan(1);
      });

      await waitFor(() => {
        expectTooltipContent(longText);
      });
    } finally {
      restoreOverflow();
    }
  });

  it("does not show a tooltip for large-text columns when the text still fits", () => {
    const restoreOverflow = mockElementOverflow(false);
    const text = "Short summary";

    try {
      render(
        <ConfigProvider locale={zhCN}>
          <DataTable
            columns={[{ key: "summary", label: "Summary", minWidth: 240, maxWidth: 360, width: 300 }]}
            rows={[{ id: "row-1", summary: text }]}
          />
        </ConfigProvider>,
      );

      fireEvent.mouseEnter(screen.getByText(text));

      expect(document.querySelector(".table-cell-tooltip")).toBeNull();
    } finally {
      restoreOverflow();
    }
  });

  it("does not show a tooltip for short columns when the text still fits", () => {
    const restoreOverflow = mockElementOverflow(false);

    try {
      render(
        <ConfigProvider locale={zhCN}>
          <DataTable
            columns={[{ key: "status", label: "Status" }]}
            rows={[{ id: "row-1", status: "completed" }]}
          />
        </ConfigProvider>,
      );

      fireEvent.mouseEnter(screen.getByText("completed"));

      expect(document.querySelector(".table-cell-tooltip")).toBeNull();
    } finally {
      restoreOverflow();
    }
  });

  it("applies column min, max, and target widths to keep long summary columns from squeezing others", () => {
    const { container } = render(
      <ConfigProvider locale={zhCN}>
        <DataTable
          columns={[
            { key: "id", label: "ID", minWidth: 120, maxWidth: 180, width: 150 },
            { key: "summary", label: "Summary", minWidth: 260, maxWidth: 360, width: 320 },
          ]}
          rows={[{
            id: "row-1",
            summary: "This summary is intentionally long enough to prove it does not own the whole table width.",
          }]}
        />
      </ConfigProvider>,
    );

    const [idColumn, summaryColumn] = Array.from(container.querySelectorAll("col"));
    const table = container.querySelector("table");

    expect(idColumn).toHaveStyle({ maxWidth: "180px", minWidth: "120px", width: "150px" });
    expect(summaryColumn).toHaveStyle({ maxWidth: "360px", minWidth: "260px", width: "320px" });
    expect(table).toHaveStyle({ minWidth: "470px" });
  });

  it("uses compact defaults for enum columns and wider defaults for content columns", () => {
    const { container } = render(
      <ConfigProvider locale={zhCN}>
        <DataTable
          columns={[
            { key: "status", label: "Status" },
            { key: "source", label: "Source" },
            { key: "report", label: "Report" },
            { key: "summary", label: "Summary" },
          ]}
          rows={[{
            id: "row-1",
            status: "completed",
            source: "cron",
            report: "/home/node/.openclaw/lynx/check-runs/2026-04-29.report.md",
            summary: "A longer summary that should get more room than enum columns.",
          }]}
        />
      </ConfigProvider>,
    );

    const [statusColumn, sourceColumn, reportColumn, summaryColumn] = Array.from(
      container.querySelectorAll("col"),
    );

    expect(statusColumn).toHaveStyle({ maxWidth: "128px", minWidth: "96px", width: "112px" });
    expect(sourceColumn).toHaveStyle({ maxWidth: "140px", minWidth: "96px", width: "118px" });
    expect(reportColumn).toHaveStyle({ maxWidth: "460px", minWidth: "260px", width: "360px" });
    expect(summaryColumn).toHaveStyle({ maxWidth: "460px", minWidth: "280px", width: "360px" });
  });

  it("keeps the default detail action column wide enough for compact action buttons", () => {
    const { container } = render(
      <ConfigProvider locale={zhCN}>
        <DataTable
          columns={[
            { key: "summary", label: "Summary" },
            { key: "detail", label: "详情" },
          ]}
          rows={[
            {
              id: "row-1",
              summary: "A compact row",
              detail: <button className="btn btn--compact" type="button">查看详情</button>,
            },
          ]}
        />
      </ConfigProvider>,
    );

    const [, detailColumn] = Array.from(container.querySelectorAll("col"));

    expect(detailColumn).toHaveStyle({ maxWidth: "160px", minWidth: "120px", width: "132px" });
  });

  it("pins operation columns to the right edge of the scrollable table", () => {
    const { container } = render(
      <ConfigProvider locale={zhCN}>
        <DataTable
          columns={[
            { key: "summary", label: "Summary" },
            { key: "detail", label: "Detail" },
          ]}
          rows={[
            {
              id: "row-1",
              summary: "A row with horizontal overflow",
              detail: <button className="btn btn--compact" type="button">View detail</button>,
            },
          ]}
        />
      </ConfigProvider>,
    );

    const headerCells = Array.from(container.querySelectorAll("th"));
    const dataCells = Array.from(container.querySelectorAll("td"));
    const detailHeader = headerCells[1];
    const detailCell = dataCells[1];

    expect(detailHeader).toHaveClass("data-table__sticky-cell");
    expect(detailHeader).toHaveClass("data-table__sticky-cell--right");
    expect(detailHeader).toHaveStyle({ right: "0px" });
    expect(detailCell).toHaveClass("data-table__sticky-cell");
    expect(detailCell).toHaveClass("data-table__sticky-cell--right");
    expect(detailCell).toHaveStyle({ right: "0px" });
  });
});
