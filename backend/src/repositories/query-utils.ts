import type { DescendingCursor } from "../services/cursor-service.js";

export type SqlParameter = string | number;

export function appendRangeFilter(
  filters: string[],
  parameters: SqlParameter[],
  fieldName: string,
  fromMs: number | undefined,
  toMs: number | undefined,
): void {
  if (typeof fromMs === "number" && Number.isFinite(fromMs)) {
    filters.push(`${fieldName} >= ?`);
    parameters.push(Math.trunc(fromMs));
  }
  if (typeof toMs === "number" && Number.isFinite(toMs)) {
    filters.push(`${fieldName} <= ?`);
    parameters.push(Math.trunc(toMs));
  }
}

export function appendEqualsFilter(
  filters: string[],
  parameters: SqlParameter[],
  fieldName: string,
  value: string | undefined,
): void {
  if (!value) {
    return;
  }
  filters.push(`${fieldName} = ?`);
  parameters.push(value);
}

export function appendBooleanFilter(
  filters: string[],
  parameters: SqlParameter[],
  fieldName: string,
  value: boolean | undefined,
): void {
  if (typeof value !== "boolean") {
    return;
  }
  filters.push(`${fieldName} = ?`);
  parameters.push(value ? 1 : 0);
}

export function appendInFilter(
  filters: string[],
  parameters: SqlParameter[],
  fieldName: string,
  values: string[] | undefined,
): void {
  if (!values || values.length === 0) {
    return;
  }
  filters.push(`${fieldName} IN (${values.map(() => "?").join(", ")})`);
  parameters.push(...values);
}

export function appendDescendingCursorFilter(
  filters: string[],
  parameters: SqlParameter[],
  sortFieldName: string,
  idFieldName: string,
  cursor: DescendingCursor | undefined,
): void {
  if (!cursor) {
    return;
  }
  filters.push(`(${sortFieldName} < ? OR (${sortFieldName} = ? AND ${idFieldName} < ?))`);
  parameters.push(cursor.sortValue, cursor.sortValue, cursor.id);
}

export function buildWhereClause(filters: string[]): string {
  return filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
}
