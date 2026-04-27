import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Cross-tenant enforcement middleware.
 * Ensures JWT sub (userId) matches the requested resource's userId.
 * 
 * Per SKILL.md: "Any mismatch must return HTTP 403 — never 404."
 * Per jwt_format.md: exact message "Cross-tenant access denied."
 */
export function enforceTenancy(
  request: FastifyRequest,
  reply: FastifyReply
): FastifyReply | undefined {
  // Extract userId from path params or body
  const params = request.params as Record<string, string>;
  const body = request.body as Record<string, unknown> | undefined;

  const requestedUserId = params.userId ?? params.id ?? body?.userId;

  if (requestedUserId && typeof requestedUserId === 'string') {
    if (requestedUserId !== request.userId) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        traceId: request.traceId,
        message: 'Cross-tenant access denied.',
      });
    }
  }

  return undefined;
}
