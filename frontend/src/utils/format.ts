function normalizeTokenValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value);
}

export function formatCompactTokens(value: number): string {
  const safeValue = normalizeTokenValue(value);

  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(1)}M`;
  }

  if (safeValue >= 999_950) {
    return "1.0M";
  }

  if (safeValue >= 1_000) {
    return `${(safeValue / 1_000).toFixed(1)}K`;
  }

  return String(safeValue);
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) {
    return "暂无";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function formatDateOnly(timestamp: number | undefined): string {
  if (!timestamp) {
    return "--";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function formatDuration(durationMs: number | undefined): string {
  if (!durationMs) {
    return "待处理";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}
