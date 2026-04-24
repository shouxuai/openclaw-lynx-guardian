import { startTransition, useEffect, useState } from "react";

import type { CursorPage } from "@lynx/local-console-shared";

interface UseListDetailResourceOptions<ListItem, DetailItem> {
  loadList: () => Promise<CursorPage<ListItem>>;
  loadDetail: (id: string) => Promise<DetailItem>;
  getItemId: (item: ListItem) => string;
}

interface UseListDetailResourceResult<ListItem, DetailItem> {
  items: ListItem[];
  detail: DetailItem | null;
  loading: boolean;
  error: string | null;
}

export function useListDetailResource<ListItem, DetailItem>(
  options: UseListDetailResourceOptions<ListItem, DetailItem>,
): UseListDetailResourceResult<ListItem, DetailItem> {
  const [items, setItems] = useState<ListItem[]>([]);
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      startTransition(() => {
        setLoading(true);
        setError(null);
      });

      try {
        const page = await options.loadList();
        const nextItems = page.items;
        const nextDetail = nextItems.length > 0
          ? await options.loadDetail(options.getItemId(nextItems[0]))
          : null;

        if (!active) {
          return;
        }

        startTransition(() => {
          setItems(nextItems);
          setDetail(nextDetail);
          setLoading(false);
          setError(null);
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        const message = loadError instanceof Error ? loadError.message : "请求失败";
        startTransition(() => {
          setItems([]);
          setDetail(null);
          setLoading(false);
          setError(message);
        });
      }
    }

    void load();

    return () => {
      active = false;
    };
    // This view only needs the initial server snapshot; route remounts trigger reloads.
  }, []);

  return {
    items,
    detail,
    loading,
    error,
  };
}
