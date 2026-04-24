import { readFile } from "fs/promises";
import { normalize, resolve, sep } from "path";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

interface StaticServiceOptions {
  rootDir: string;
  routePrefix?: string;
}

function normalizeRoutePrefix(value: string): string {
  const prefixed = value.startsWith("/") ? value : `/${value}`;
  return prefixed.replace(/\/+$/, "");
}

function hasFileExtension(value: string): boolean {
  return /\.[A-Za-z0-9]+$/.test(value);
}

function isPathInsideRoot(rootDir: string, candidatePath: string): boolean {
  if (candidatePath === rootDir) {
    return true;
  }

  const rootPrefix = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
  return candidatePath.startsWith(rootPrefix);
}

function resolveContentType(fullPath: string): string {
  const extension = fullPath.slice(fullPath.lastIndexOf("."));
  return MIME_TYPES[extension.toLowerCase()] ?? "application/octet-stream";
}

async function sendFile(reply: FastifyReply, fullPath: string, cacheControl: string) {
  const file = await readFile(fullPath);
  return reply
    .header("Cache-Control", cacheControl)
    .type(resolveContentType(fullPath))
    .send(file);
}

async function staticHandler(
  request: FastifyRequest<{ Params: { "*": string } }>,
  reply: FastifyReply,
  rootDir: string,
) {
  const requestedPath = request.params["*"] ?? "";
  let decodedPath = requestedPath;

  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    return reply.code(400).type("text/plain; charset=utf-8").send("Bad Request");
  }

  const normalizedRoot = normalize(resolve(rootDir));
  const relativePath = decodedPath.replace(/^\/+/, "");

  if (!relativePath || !hasFileExtension(relativePath)) {
    return sendFile(reply, resolve(normalizedRoot, "index.html"), "no-store");
  }

  const requestedFilePath = normalize(resolve(normalizedRoot, relativePath));
  if (!isPathInsideRoot(normalizedRoot, requestedFilePath)) {
    return reply.code(403).type("text/plain; charset=utf-8").send("Forbidden");
  }

  try {
    return await sendFile(reply, requestedFilePath, "public, max-age=3600");
  } catch {
    return reply.code(404).type("text/plain; charset=utf-8").send("Not Found");
  }
}

export function registerStaticWebviewRoutes(
  app: FastifyInstance,
  options: StaticServiceOptions,
): void {
  const routePrefix = normalizeRoutePrefix(options.routePrefix ?? "/webview");
  const handle = (request: FastifyRequest<{ Params: { "*": string } }>, reply: FastifyReply) =>
    staticHandler(request, reply, options.rootDir);

  app.get(routePrefix, async (_request, reply) => sendFile(
    reply,
    resolve(options.rootDir, "index.html"),
    "no-store",
  ));
  app.get(`${routePrefix}/*`, handle);
}
