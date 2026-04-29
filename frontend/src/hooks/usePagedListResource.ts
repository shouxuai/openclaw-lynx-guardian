import { startTransition, useEffect, useMemo, useState } from "react";
import type { PageResponse } from "@lynx/local-console-shared";

import type { TablePaginationProps } from "../components/tables/TablePagination";
import { DEFAULT_TABLE_PAGE_SIZE, DEFAULT_TABLE_PAGE_SIZE_OPTIONS } from "../components/tables/TablePagination";

export interface PagedListQuery {
  pageNum?: number;
  pageSize?: number;
}

interface UsePagedListResourceOptions<Item, Query extends PagedListQuery> {
  fallbackPage?: (query: Query, pageIndex: number, pageSize: number) => PageResponse<Item>;
  initialPageSize?: number;
  loadPage: (query: Query) => Promise<PageResponse<Item>>;
  onPageBoundaryChange?: () => void;
  pageSizeOptions?: number[];
  query: Omit<Query, "pageNum" | "pageSize">;
  refreshKey?: number | string;
}

interface UsePagedListResourceResult<Item> {
  error: string | null;
  items: Item[];
  loading: boolean;
  paginationProps: TablePaginationProps;
  resetPaging: () => void;
  total: number;
  totalPages: number;
}

export function paginateMockPage<Item>(
  items: Item[],
  pageIndex: number,
  pageSize: number,
): PageResponse<Item> {
  const startIndex = pageIndex * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  const totalPages = items.length === 0 ? 0 : Math.ceil(items.length / pageSize);

  return {
    items: pageItems,
    total: items.length,
    pageNum: pageIndex + 1,
    pageSize,
    totalPages,
  };
}

function normalizePageNumber(pageNum: number | undefined): number {
  return Number.isFinite(pageNum) && pageNum !== undefined ? Math.max(1, Math.trunc(pageNum)) : 1;
}

function normalizeTotalPages(totalPages: number | undefined, total: number, pageSize: number): number {
  if (Number.isFinite(totalPages) && totalPages !== undefined) {
    return Math.max(0, Math.trunc(totalPages));
  }
  return total === 0 ? 0 : Math.ceil(total / pageSize);
}

export function usePagedListResource<Item, Query extends PagedListQuery>({
  fallbackPage,
  initialPageSize = DEFAULT_TABLE_PAGE_SIZE,
  loadPage,
  onPageBoundaryChange,
  pageSizeOptions = DEFAULT_TABLE_PAGE_SIZE_OPTIONS,
  query,
  refreshKey = 0,
}: UsePagedListResourceOptions<Item, Query>): UsePagedListResourceResult<Item> {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const queryKey = JSON.stringify(query);

  function resetPaging(): void {
    onPageBoundaryChange?.();
    setPageIndex(0);
  }

  function handlePageChange(nextPageIndex: number): void {
    if (nextPageIndex === pageIndex) {
      return;
    }
    if (nextPageIndex < 0) {
      return;
    }
    if (totalPages > 0 && nextPageIndex >= totalPages) {
      return;
    }

    onPageBoundaryChange?.();
    setPageIndex(nextPageIndex);
  }

  function handlePageSizeChange(nextPageSize: number): void {
    setPageSize(nextPageSize);
    resetPaging();
  }

  useEffect(() => {
    let active = true;
    const requestQuery = {
      ...query,
      pageNum: pageIndex + 1,
      pageSize,
    } as Query;

    async function loadItems() {
      startTransition(() => {
        setLoading(true);
      });

      try {
        const response = await loadPage(requestQuery);
        if (!active) {
          return;
        }

        const nextPageNum = normalizePageNumber(response.pageNum);
        const nextPageSize = response.pageSize > 0 ? response.pageSize : pageSize;
        const nextTotal = Math.max(0, Math.trunc(response.total ?? response.items.length));
        const nextTotalPages = normalizeTotalPages(response.totalPages, nextTotal, nextPageSize);

        startTransition(() => {
          setItems(response.items);
          setTotal(nextTotal);
          setTotalPages(nextTotalPages);
          setError(null);
          setLoading(false);
          if (nextPageNum - 1 !== pageIndex) {
            setPageIndex(nextPageNum - 1);
          }
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        const fallback = fallbackPage?.(requestQuery, pageIndex, pageSize);
        const fallbackTotal = fallback ? Math.max(0, Math.trunc(fallback.total)) : 0;
        const fallbackTotalPages = fallback
          ? normalizeTotalPages(fallback.totalPages, fallbackTotal, fallback.pageSize || pageSize)
          : 0;
        const message = loadError instanceof Error ? loadError.message : "请求失败";
        startTransition(() => {
          setItems(fallback?.items ?? []);
          setTotal(fallbackTotal);
          setTotalPages(fallbackTotalPages);
          setError(fallback ? null : message);
          setLoading(false);
        });
      }
    }

    void loadItems();

    return () => {
      active = false;
    };
  }, [pageIndex, pageSize, queryKey, refreshKey]);

  const paginationProps = useMemo<TablePaginationProps>(() => ({
    hasNextPage: totalPages === 0 ? false : pageIndex + 1 < totalPages,
    itemCount: items.length,
    loading,
    pageCount: totalPages,
    pageIndex,
    pageSize,
    pageSizeOptions,
    totalItems: total,
    totalPages,
    onNextPage: () => handlePageChange(pageIndex + 1),
    onPageChange: handlePageChange,
    onPageSizeChange: handlePageSizeChange,
    onPreviousPage: () => handlePageChange(pageIndex - 1),
  }), [items.length, loading, pageIndex, pageSize, pageSizeOptions, total, totalPages]);

  return {
    error,
    items,
    loading,
    paginationProps,
    resetPaging,
    total,
    totalPages,
  };
}
