import { Pagination } from "antd";

import { formatInteger } from "../../utils/format";

export const DEFAULT_TABLE_PAGE_SIZE = 20;
export const DEFAULT_TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export interface TablePaginationProps {
  ariaLabel?: string;
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
  ariaLabel = "列表分页",
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
  const estimatedTotal = hasNextPage
    ? (pageCount + 1) * pageSize
    : (pageIndex * pageSize) + itemCount;

  return (
    <div className="table-pagination" aria-label={ariaLabel}>
      <p className="table-pagination__summary">
        第 {formatInteger(pageIndex + 1)} 页，显示 {formatInteger(itemCount)} 条结果
      </p>

      <Pagination
        aria-label={ariaLabel}
        className="table-pagination__antd"
        current={pageIndex + 1}
        disabled={loading}
        pageSize={pageSize}
        pageSizeOptions={pageSizeOptions.map(String)}
        showSizeChanger
        total={estimatedTotal}
        onChange={(nextPage, nextPageSize) => {
          const zeroBasedPage = nextPage - 1;
          if (nextPageSize !== pageSize) {
            onPageSizeChange(nextPageSize);
            return;
          }
          onPageChange(zeroBasedPage);
        }}
      />
    </div>
  );
}
