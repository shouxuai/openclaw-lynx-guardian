export const WEBVIEW_BASE_PATH = "/webview";

export const ROUTE_PATHS = {
  dashboard: "/",
  qaRecords: "/qa-records",
  events: "/events",
  rawEvents: "/raw-events",
  decisions: "/decisions",
  toolCalls: "/tool-calls",
  approvals: "/approvals",
  policies: "/policies",
  chains: "/chains",
  grants: "/grants",
  lynxChecks: "/lynx-checks",
  skills: "/skills",
  sessions: "/sessions",
  tokens: "/tokens",
} as const;

export function isWebviewPath(pathname: string): boolean {
  return pathname === WEBVIEW_BASE_PATH || pathname.startsWith(`${WEBVIEW_BASE_PATH}/`);
}

export function toWebviewPath(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

  if (isWebviewPath(normalizedPath)) {
    return normalizedPath;
  }

  return normalizedPath === "/"
    ? `${WEBVIEW_BASE_PATH}/`
    : `${WEBVIEW_BASE_PATH}${normalizedPath}`;
}

export function normalizeWebviewLocation({
  hash,
  pathname,
  search,
}: Pick<Location, "hash" | "pathname" | "search">): string | null {
  if (isWebviewPath(pathname)) {
    return null;
  }

  return `${toWebviewPath(pathname)}${search}${hash}`;
}
