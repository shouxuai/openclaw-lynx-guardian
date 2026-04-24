export const WEBVIEW_BASE_PATH = "/webview";

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
