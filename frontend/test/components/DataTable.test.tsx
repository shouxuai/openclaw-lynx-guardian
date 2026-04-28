import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { afterEach, describe, expect, it } from "vitest";

import { DataTable } from "../../src/components/tables/DataTable";

describe("DataTable", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows full primitive cell text in the black tooltip without a duplicate native title", async () => {
    const longText = "This is a long audit summary that should remain readable in the tooltip without being clamped.";

    render(
      <ConfigProvider locale={zhCN}>
        <DataTable
          columns={[{ key: "summary", label: "Summary", minWidth: 240, maxWidth: 360, width: 300 }]}
          rows={[{ id: "row-1", summary: longText }]}
        />
      </ConfigProvider>,
    );

    const visibleCellText = screen.getByText(longText);
    expect(visibleCellText).not.toHaveAttribute("title");

    fireEvent.mouseEnter(visibleCellText);

    await waitFor(() => {
      expect(screen.getAllByText(longText).length).toBeGreaterThan(1);
    });

    await waitFor(() => {
      expect(document.querySelector(".table-cell-tooltip")?.textContent).toBe(longText);
    });
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

    expect(idColumn).toHaveStyle({ maxWidth: "180px", minWidth: "120px", width: "150px" });
    expect(summaryColumn).toHaveStyle({ maxWidth: "360px", minWidth: "260px", width: "320px" });
  });
});
