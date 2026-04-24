import type { ReactNode } from "react";

export interface DataTableColumn {
  key: string;
  label: string;
}

export interface DataTableRow {
  id: string;
  [key: string]: ReactNode;
}

export interface DataTableProps {
  columns: DataTableColumn[];
  rows: DataTableRow[];
}

export function DataTable({ columns, rows }: DataTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.key}>{row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
