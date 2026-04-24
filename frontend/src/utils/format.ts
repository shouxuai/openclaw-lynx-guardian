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

export function formatDuration(durationMs: number | undefined): string {
  if (!durationMs) {
    return "待处理";
  }

  if (durationMs < 1000) {
    return `${durationMs} 毫秒`;
  }

  return `${(durationMs / 1000).toFixed(1)} 秒`;
}
