import type { FastifyReply, FastifyRequest } from "fastify";

export function requireIngestAuth(expectedToken: string) {
  return async function ingestAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!expectedToken) {
      await reply.code(503).send({
        ok: false,
        message: "Local console ingest token is not configured.",
      });
      return;
    }

    const authorization = request.headers.authorization ?? "";
    if (authorization !== `Bearer ${expectedToken}`) {
      await reply.code(401).send({
        ok: false,
        message: "Unauthorized",
      });
    }
  };
}
