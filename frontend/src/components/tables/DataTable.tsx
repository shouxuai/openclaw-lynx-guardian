import { useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "antd";

const DEFAULT_COLUMN_WIDTH = 168;
const DEFAULT_COLUMN_MIN_WIDTH = 112;
const DEFAULT_COLUMN_MAX_WIDTH = 320;

const COLUMN_SIZE_BY_KEY: Record<string, Partial<DataTableColumnSize>> = {
  action: { maxWidth: 128, minWidth: 96, width: 108 },
  approvalId: { maxWidth: 220, minWidth: 170, width: 190 },
  approval: { maxWidth: 140, minWidth: 100, width: 116 },
  approver: { maxWidth: 200, minWidth: 150, width: 170 },
  arbiter: { maxWidth: 180, minWidth: 140, width: 160 },
  baseline: { maxWidth: 240, minWidth: 170, width: 200 },
  block: { maxWidth: 128, minWidth: 96, width: 112 },
  category: { maxWidth: 132, minWidth: 96, width: 112 },
  chain: { maxWidth: 240, minWidth: 170, width: 200 },
  controlPlane: { maxWidth: 360, minWidth: 240, width: 300 },
  created: { maxWidth: 190, minWidth: 150, width: 170 },
  current: { maxWidth: 240, minWidth: 170, width: 200 },
  decision: { maxWidth: 260, minWidth: 180, width: 220 },
  degraded: { maxWidth: 260, minWidth: 190, width: 230 },
  detail: { maxWidth: 160, minWidth: 120, width: 132 },
  delivery: { maxWidth: 150, minWidth: 110, width: 128 },
  duration: { maxWidth: 112, minWidth: 88, width: 96 },
  enforcement: { maxWidth: 160, minWidth: 128, width: 144 },
  event: { maxWidth: 260, minWidth: 190, width: 220 },
  events: { maxWidth: 112, minWidth: 88, width: 96 },
  evidence: { maxWidth: 420, minWidth: 260, width: 340 },
  excerpt: { maxWidth: 460, minWidth: 280, width: 360 },
  expires: { maxWidth: 190, minWidth: 150, width: 170 },
  findings: { maxWidth: 260, minWidth: 190, width: 230 },
  grant: { maxWidth: 230, minWidth: 170, width: 200 },
  grantScope: { maxWidth: 320, minWidth: 220, width: 260 },
  id: { maxWidth: 220, minWidth: 150, width: 180 },
  identity: { maxWidth: 300, minWidth: 210, width: 260 },
  io: { maxWidth: 160, minWidth: 118, width: 136 },
  lastSeen: { maxWidth: 210, minWidth: 160, width: 180 },
  model: { maxWidth: 220, minWidth: 160, width: 190 },
  modules: { maxWidth: 260, minWidth: 190, width: 220 },
  path: { maxWidth: 460, minWidth: 260, width: 360 },
  policy: { maxWidth: 160, minWidth: 128, width: 144 },
  profile: { maxWidth: 140, minWidth: 96, width: 116 },
  recommendation: { maxWidth: 420, minWidth: 260, width: 340 },
  report: { maxWidth: 460, minWidth: 260, width: 360 },
  request: { maxWidth: 220, minWidth: 150, width: 180 },
  requester: { maxWidth: 220, minWidth: 160, width: 180 },
  revoked: { maxWidth: 260, minWidth: 190, width: 230 },
  revokedReason: { maxWidth: 260, minWidth: 190, width: 230 },
  risk: { maxWidth: 128, minWidth: 96, width: 112 },
  rules: { maxWidth: 300, minWidth: 210, width: 260 },
  scope: { maxWidth: 320, minWidth: 220, width: 260 },
  score: { maxWidth: 320, minWidth: 230, width: 280 },
  sensitive: { maxWidth: 300, minWidth: 210, width: 260 },
  session: { maxWidth: 240, minWidth: 170, width: 200 },
  signals: { maxWidth: 300, minWidth: 210, width: 260 },
  skill: { maxWidth: 240, minWidth: 170, width: 200 },
  source: { maxWidth: 140, minWidth: 96, width: 118 },
  stage: { maxWidth: 140, minWidth: 100, width: 116 },
  status: { maxWidth: 128, minWidth: 96, width: 112 },
  summary: { maxWidth: 460, minWidth: 280, width: 360 },
  taint: { maxWidth: 240, minWidth: 170, width: 210 },
  taskState: { maxWidth: 180, minWidth: 140, width: 160 },
  time: { maxWidth: 180, minWidth: 140, width: 156 },
  tool: { maxWidth: 220, minWidth: 160, width: 190 },
  tools: { maxWidth: 220, minWidth: 160, width: 190 },
  total: { maxWidth: 120, minWidth: 92, width: 104 },
  trust: { maxWidth: 160, minWidth: 120, width: 140 },
  type: { maxWidth: 140, minWidth: 100, width: 120 },
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
  overflowTooltip?: boolean;
  sticky?: "right" | false;
  width?: number;
}

export interface DataTableRow {
  id: string;
  [key: string]: ReactNode;
}

export interface DataTableProps {
  columns: DataTableColumn[];
  loading?: boolean;
  loadingLabel?: string;
  onRowClick?: (row: DataTableRow) => void;
  rows: DataTableRow[];
  selectedRowId?: string;
}

function isPrimitiveCell(value: ReactNode): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function isElementOverflowing(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
}

function shouldShowOverflowTooltip(column: DataTableColumn): boolean {
  return column.overflowTooltip ?? true;
}

function CellText({ text }: { text: string }) {
  return <span className="table-cell-ellipsis">{text}</span>;
}

function OverflowTooltipCellText({ text }: { text: string }) {
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);

  function handleOpenCheck(): void {
    const element = textRef.current;
    setOpen(Boolean(element && isElementOverflowing(element)));
  }

  return (
    <Tooltip
      classNames={{ root: "table-cell-tooltip" }}
      mouseEnterDelay={0}
      open={open}
      title={<span className="table-cell-tooltip__content">{text}</span>}
    >
      <span
        className="table-cell-ellipsis"
        onBlur={() => {
          setOpen(false);
        }}
        onFocus={handleOpenCheck}
        onMouseEnter={handleOpenCheck}
        onMouseLeave={() => {
          setOpen(false);
        }}
        ref={textRef}
      >
        {text}
      </span>
    </Tooltip>
  );
}

function renderCellContent(column: DataTableColumn, value: ReactNode): ReactNode {
  if (!isPrimitiveCell(value)) {
    return value;
  }

  const text = String(value);

  return shouldShowOverflowTooltip(column)
    ? <OverflowTooltipCellText text={text} />
    : <CellText text={text} />;
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

function isStickyRightColumn(column: DataTableColumn): boolean {
  return column.sticky === "right" || (
    column.sticky !== false && (column.key === "action" || column.key === "detail")
  );
}

function resolveStickyRightOffset(columns: DataTableColumn[], columnIndex: number): number {
  return columns
    .slice(columnIndex + 1)
    .filter(isStickyRightColumn)
    .reduce((total, column) => total + resolveColumnSize(column).width, 0);
}

function buildColumnCellStyle(
  columns: DataTableColumn[],
  column: DataTableColumn,
  columnIndex: number,
): CSSProperties {
  const style = buildColumnStyle(column);
  if (isStickyRightColumn(column)) {
    style.right = resolveStickyRightOffset(columns, columnIndex);
  }
  return style;
}

function buildColumnCellClassName(column: DataTableColumn): string | undefined {
  if (!isStickyRightColumn(column)) {
    return undefined;
  }
  return "data-table__sticky-cell data-table__sticky-cell--right";
}

function resolveTableMinWidth(columns: DataTableColumn[]): number {
  return columns.reduce((total, column) => total + resolveColumnSize(column).width, 0);
}

function buildRowClassName(clickable: boolean, selected: boolean): string | undefined {
  const classes = [
    clickable ? "data-table__row--clickable" : undefined,
    selected ? "data-table__row--selected" : undefined,
  ].filter(Boolean);

  return classes.length > 0 ? classes.join(" ") : undefined;
}

export function DataTable({
  columns,
  loading = false,
  loadingLabel = "正在加载列表数据",
  onRowClick,
  rows,
  selectedRowId,
}: DataTableProps) {
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
            {columns.map((column, columnIndex) => (
              <th
                className={buildColumnCellClassName(column)}
                key={column.key}
                style={buildColumnCellStyle(columns, column, columnIndex)}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr className="data-table__loading-row">
              <td className="data-table__loading-cell" colSpan={columns.length}>
                <span className="data-table__loading-status" role="status">{loadingLabel}</span>
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr
              aria-selected={selectedRowId ? row.id === selectedRowId : undefined}
              className={buildRowClassName(Boolean(onRowClick), row.id === selectedRowId)}
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onRowClick(row);
                }
              } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              {columns.map((column, columnIndex) => (
                <td
                  className={buildColumnCellClassName(column)}
                  key={column.key}
                  style={buildColumnCellStyle(columns, column, columnIndex)}
                >
                  {renderCellContent(column, row[column.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
