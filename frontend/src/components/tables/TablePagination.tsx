import { formatInteger } from "../../utils/format";

export interface TablePaginationProps {
  hasNextPage: boolean;
  itemCount: number;
  loading?: boolean;
  pageCount: number;
  pageIndex: number;
  pageSize: number;
  pageSizeOptions: number[];
  onNextPage: () => void;
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onPreviousPage: () => void;
}

export function TablePagination({
  hasNextPage,
  itemCount,
  loading = false,
  pageCount,
  pageIndex,
  pageSize,
  pageSizeOptions,
  onNextPage,
  onPageChange,
  onPageSizeChange,
  onPreviousPage,
}: TablePaginationProps) {
  const selectablePageCount = pageCount + (hasNextPage ? 1 : 0);
  const pageOptions = Array.from({ length: selectablePageCount }, (_, index) => index);

  return (
    <div className="table-pagination" aria-label="审计日志分页">
      <p className="table-pagination__summary">
        第 {formatInteger(pageIndex + 1)} 页，显示 {formatInteger(itemCount)} 条结果
      </p>

      <div className="table-pagination__controls">
        <label className="table-pagination__field">
          <span>当前页</span>
          <select
            aria-label="当前页"
            disabled={loading}
            value={String(pageIndex)}
            onChange={(event) => onPageChange(Number(event.target.value))}
          >
            {pageOptions.map((optionPageIndex) => (
              <option key={optionPageIndex} value={optionPageIndex}>
                第 {formatInteger(optionPageIndex + 1)} 页
              </option>
            ))}
          </select>
        </label>

        <label className="table-pagination__field">
          <span>每页行数</span>
          <select
            aria-label="每页行数"
            disabled={loading}
            value={String(pageSize)}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>{formatInteger(option)} 行</option>
            ))}
          </select>
        </label>

        <div className="table-pagination__buttons">
          <button
            className="btn btn--compact"
            disabled={pageIndex === 0 || loading}
            type="button"
            onClick={onPreviousPage}
          >
            上一页
          </button>
          <button
            className="btn btn--compact btn--primary"
            disabled={!hasNextPage || loading}
            type="button"
            onClick={onNextPage}
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
