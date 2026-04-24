export interface CursorPayload {
  [key: string]: string | number | boolean | null | undefined;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor<T extends CursorPayload = CursorPayload>(
  cursor?: string,
): T | undefined {
  if (!cursor) {
    return undefined;
  }

  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
}
