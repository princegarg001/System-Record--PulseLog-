import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';
import { getTraceId } from '../utils/tracing.js';

/**
 * Structured request logger middleware.
 * Sets traceId on request and logs every request with required fields:
 * - traceId, userId, latency, statusCode, method, path
 */
export function requestLoggerHook(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: () => void
): void {
  // Set traceId from header or generate
  const headerTraceId = request.headers['x-trace-id'];
  request.traceId = getTraceId(
    Array.isArray(headerTraceId) ? headerTraceId[0] : headerTraceId
  );

  // Record start time
  (request as unknown as Record<string, unknown>).startTime = process.hrtime.bigint();

  done();
}

export function responseLoggerHook(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void
): void {
  const startTime = (request as unknown as Record<string, unknown>).startTime as bigint | undefined;
  const latency = startTime
    ? Number(process.hrtime.bigint() - startTime) / 1_000_000  // Convert ns to ms
    : 0;

  logger.info({
    traceId: request.traceId,
    userId: request.userId || 'anonymous',
    latency: Math.round(latency * 100) / 100,
    statusCode: reply.statusCode,
    method: request.method,
    path: request.url,
  });

  done();
}
