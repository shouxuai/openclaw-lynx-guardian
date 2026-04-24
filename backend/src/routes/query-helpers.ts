export function readStringQuery(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

export function readStringArrayQuery(value: unknown): string[] | undefined {
  const rawValues = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const values = rawValues
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return values.length > 0 ? values : undefined;
}

export function readNumberQuery(value: unknown): number | undefined {
  const raw = readStringQuery(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readBooleanQuery(value: unknown): boolean | undefined {
  const raw = readStringQuery(value)?.toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  return undefined;
}
