import { LOCAL_CONSOLE_API_BASE_PATH } from "@lynx/local-console-shared";

type QueryPrimitive = string | number | boolean;
type QueryValue = QueryPrimitive | QueryPrimitive[] | null | undefined;

const API_BASE_PATH = normalizeBasePath(
  import.meta.env.VITE_LYNX_API_BASE_PATH ?? LOCAL_CONSOLE_API_BASE_PATH,
);

function normalizeBasePath(value: string): string {
  if (value === "/") {
    return value;
  }

  return value.replace(/\/+$/, "");
}

function resolveRequestPath(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  if (path.startsWith(API_BASE_PATH)) {
    return path;
  }

  return `${API_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

async function resolveErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim() || "Request failed";
  const contentType = response.headers?.get?.("content-type");

  if (contentType?.includes("application/json") && typeof response.json === "function") {
    try {
      const payload = await response.json() as { message?: string };
      if (typeof payload?.message === "string" && payload.message.trim().length > 0) {
        return payload.message;
      }
    } catch {
      return fallback;
    }
  }

  if (typeof response.text === "function") {
    try {
      const text = await response.text();
      if (text.trim().length > 0) {
        return text.trim();
      }
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export function buildQueryString<T extends object>(query: T): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query as Record<string, QueryValue>)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
      continue;
    }

    params.set(key, String(value));
  }

  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveRequestPath(path), init);
  if (!response.ok) {
    throw new Error(await resolveErrorMessage(response));
  }

  return response.json() as Promise<T>;
}
