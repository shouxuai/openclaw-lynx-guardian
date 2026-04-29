import { startTransition, useEffect, useMemo, useState } from "react";
import type { CursorPage } from "@lynx/local-console-shared";

import type { TablePaginationProps } from "../components/tables/TablePagination";
import { DEFAULT_TABLE_PAGE_SIZE, DEFAULT_TABLE_PAGE_SIZE_OPTIONS } from "../components/tables/TablePagination";

export interface CursorListQuery {
  cursor?: string;
  limit?: number;
}

interface UseCursorListResourceOptions<Item, Query extends CursorListQuery> {
  fallbackPage?: (query: Query, pageIndex: number, pageSize: number) => CursorPage<Item>;
  initialPageSize?: number;
  loadPage: (query: Query) => Promise<CursorPage<Item>>;
  onPageBoundaryChange?: () => void;
  pageSizeOptions?: number[];
  query: Omit<Query, "cursor" | "limit">;
  refreshKey?: number | string;
}

interface UseCursorListResourceResult<Item> {
  error: string | null;
  items: Item[];
  loading: boolean;
  paginationProps: TablePaginationProps;
  retry: () => void;
  resetPaging: () => void;
}

export function paginateMockItems<Item>(
  items: Item[],
  pageIndex: number,
  pageSize: number,
): CursorPage<Item> {
  const startIndex = pageIndex * pageSize;
  const pageItems = items.slice(startIndex, startIndex + pageSize);
  const hasNextPage = startIndex + pageSize < items.length;

  return {
    items: pageItems,
    nextCursor: hasNextPage ? `mock-page-${pageIndex + 2}` : undefined,
  };
}

export function useCursorListResource<Item, Query extends CursorListQuery>({
  fallbackPage,
  initialPageSize = DEFAULT_TABLE_PAGE_SIZE,
  loadPage,
  onPageBoundaryChange,
  pageSizeOptions = DEFAULT_TABLE_PAGE_SIZE_OPTIONS,
  query,
  refreshKey = 0,
}: UseCursorListResourceOptions<Item, Query>): UseCursorListResourceResult<Item> {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [retryKey, setRetryKey] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | undefined>();

  const currentCursor = pageCursors[pageIndex];
  const queryKey = JSON.stringify(query);

  function resetPaging(): void {
    onPageBoundaryChange?.();
    setPageCursors([undefined]);
    setPageIndex(0);
    setNextCursor(undefined);
  }

  function handleNextPage(): void {
    if (!nextCursor) {
      return;
    }

    onPageBoundaryChange?.();
    setPageCursors((current) => {
      const next = current.slice(0, pageIndex + 1);
      next[pageIndex + 1] = nextCursor;
      return next;
    });
    setPageIndex((current) => current + 1);
  }

  function handlePreviousPage(): void {
    onPageBoundaryChange?.();
    setPageIndex((current) => Math.max(0, current - 1));
  }

  function handlePageChange(nextPageIndex: number): void {
    if (nextPageIndex === pageIndex) {
      return;
    }

    if (nextPageIndex === pageCursors.length && nextCursor) {
      handleNextPage();
      return;
    }

    if (nextPageIndex >= 0 && nextPageIndex < pageCursors.length) {
      onPageBoundaryChange?.();
      setPageIndex(nextPageIndex);
    }
  }

  function handlePageSizeChange(nextPageSize: number): void {
    setPageSize(nextPageSize);
    resetPaging();
  }

  function retry(): void {
    setRetryKey((current) => current + 1);
  }

  useEffect(() => {
    let active = true;
    const requestQuery = {
      ...query,
      limit: pageSize,
      cursor: currentCursor,
    } as Query;

    async function loadItems() {
      startTransition(() => {
        setError(null);
        setLoading(true);
      });

      try {
        const response = await loadPage(requestQuery);
        if (!active) {
          return;
        }

        startTransition(() => {
          setItems(response.items);
          setNextCursor(response.nextCursor);
          setError(null);
          setLoading(false);
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        const fallback = fallbackPage?.(requestQuery, pageIndex, pageSize);
        const message = loadError instanceof Error ? loadError.message : "请求失败";
        startTransition(() => {
          setItems((current) => fallback?.items ?? current);
          if (fallback) {
            setNextCursor(fallback.nextCursor);
          }
          setError(fallback ? null : message);
          setLoading(false);
        });
      }
    }

    void loadItems();

    return () => {
      active = false;
    };
  }, [currentCursor, pageIndex, pageSize, queryKey, refreshKey, retryKey]);

  const paginationProps = useMemo<TablePaginationProps>(() => ({
    hasNextPage: Boolean(nextCursor),
    itemCount: items.length,
    loading,
    pageCount: pageCursors.length,
    pageIndex,
    pageSize,
    pageSizeOptions,
    onNextPage: handleNextPage,
    onPageChange: handlePageChange,
    onPageSizeChange: handlePageSizeChange,
    onPreviousPage: handlePreviousPage,
  }), [items.length, loading, nextCursor, pageCursors.length, pageIndex, pageSize, pageSizeOptions]);

  return {
    error,
    items,
    loading,
    paginationProps,
    retry,
    resetPaging,
  };
}
