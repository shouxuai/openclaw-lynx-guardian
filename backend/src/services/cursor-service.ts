import type { CursorPage } from "../../../shared/src/query-dto.js";
import { decodeCursor, encodeCursor } from "../../../shared/src/cursor.js";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

export interface DescendingCursor {
  sortValue: number;
  id: string;
}

export function resolveListLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(value)));
}

export function encodeDescendingCursor(sortValue: number, id: string): string {
  return encodeCursor({
    sortValue,
    id,
  });
}

export function decodeDescendingCursor(cursor: string | undefined): DescendingCursor | undefined {
  if (!cursor) {
    return undefined;
  }

  try {
    const parsed = decodeCursor<{ sortValue?: number; id?: string }>(cursor);
    if (
      parsed
      && typeof parsed.sortValue === "number"
      && Number.isFinite(parsed.sortValue)
      && typeof parsed.id === "string"
      && parsed.id.length > 0
    ) {
      return {
        sortValue: Math.trunc(parsed.sortValue),
        id: parsed.id,
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function buildCursorPage<T, U>(
  rows: T[],
  limit: number,
  mapRow: (row: T) => U,
  getCursor: (row: T) => DescendingCursor,
): CursorPage<U> {
  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map(mapRow),
    nextCursor: rows.length > limit && lastRow
      ? encodeDescendingCursor(getCursor(lastRow).sortValue, getCursor(lastRow).id)
      : undefined,
  };
}
