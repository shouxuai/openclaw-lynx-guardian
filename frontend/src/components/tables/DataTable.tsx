import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "antd";

const DEFAULT_COLUMN_WIDTH = 176;
const DEFAULT_COLUMN_MIN_WIDTH = 120;
const DEFAULT_COLUMN_MAX_WIDTH = 360;

const COLUMN_SIZE_BY_KEY: Record<string, Partial<DataTableColumnSize>> = {
  action: { maxWidth: 140, minWidth: 104, width: 116 },
  approvalId: { maxWidth: 220, minWidth: 170, width: 190 },
  category: { maxWidth: 150, minWidth: 110, width: 126 },
  decision: { maxWidth: 150, minWidth: 112, width: 128 },
  detail: { maxWidth: 120, minWidth: 92, width: 104 },
  event: { maxWidth: 260, minWidth: 190, width: 220 },
  excerpt: { maxWidth: 380, minWidth: 240, width: 300 },
  recommendation: { maxWidth: 360, minWidth: 220, width: 280 },
  requester: { maxWidth: 220, minWidth: 160, width: 180 },
  risk: { maxWidth: 150, minWidth: 112, width: 128 },
  scope: { maxWidth: 190, minWidth: 140, width: 160 },
  status: { maxWidth: 150, minWidth: 112, width: 128 },
  summary: { maxWidth: 380, minWidth: 240, width: 300 },
  time: { maxWidth: 180, minWidth: 140, width: 156 },
};

type DataTableColumnSize = {
  maxWidth: number;
  minWidth: number;
  width: number;
};

export interface DataTableColumn {
  key: string;
  label: string;
  maxWidth?: number;
  minWidth?: number;
  width?: number;
}

export interface DataTableRow {
  id: string;
  [key: string]: ReactNode;
}

export interface DataTableProps {
  columns: DataTableColumn[];
  rows: DataTableRow[];
}

function isPrimitiveCell(value: ReactNode): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function renderCellContent(value: ReactNode): ReactNode {
  if (!isPrimitiveCell(value)) {
    return value;
  }

  const text = String(value);

  return (
    <Tooltip
      classNames={{ root: "table-cell-tooltip" }}
      mouseEnterDelay={0}
      title={<span className="table-cell-tooltip__content">{text}</span>}
    >
      <span className="table-cell-ellipsis">
        {text}
      </span>
    </Tooltip>
  );
}

function resolveColumnSize(column: DataTableColumn): DataTableColumnSize {
  const keyedSize = COLUMN_SIZE_BY_KEY[column.key] ?? {};

  return {
    maxWidth: column.maxWidth ?? keyedSize.maxWidth ?? DEFAULT_COLUMN_MAX_WIDTH,
    minWidth: column.minWidth ?? keyedSize.minWidth ?? DEFAULT_COLUMN_MIN_WIDTH,
    width: column.width ?? keyedSize.width ?? DEFAULT_COLUMN_WIDTH,
  };
}

function buildColumnStyle(column: DataTableColumn): CSSProperties {
  const size = resolveColumnSize(column);

  return {
    maxWidth: size.maxWidth,
    minWidth: size.minWidth,
    width: size.width,
  };
}

function resolveTableMinWidth(columns: DataTableColumn[]): number {
  return columns.reduce((total, column) => total + resolveColumnSize(column).minWidth, 0);
}

export function DataTable({ columns, rows }: DataTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table" style={{ minWidth: resolveTableMinWidth(columns) }}>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={buildColumnStyle(column)} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={buildColumnStyle(column)}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.key} style={buildColumnStyle(column)}>{renderCellContent(row[column.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
