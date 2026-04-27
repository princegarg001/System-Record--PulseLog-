import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../utils/logger.js';

/**
 * Global error handler.
 * Returns standardized error responses with traceId per spec.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const traceId = request.traceId || 'unknown';

  // Validation errors from Fastify schema
  if (error.validation) {
    reply.status(400).send({
      error: 'VALIDATION_ERROR',
      traceId,
      details: error.validation.map((v) => ({
        field: v.instancePath?.replace('/', '') || v.params?.['missingProperty'] || 'unknown',
        msg: v.message || 'Invalid value',
      })),
      message: 'Request validation failed.',
    });
    return;
  }

  // Known HTTP status code errors
  if (error.statusCode && error.statusCode < 500) {
    reply.status(error.statusCode).send({
      error: error.code || 'CLIENT_ERROR',
      traceId,
      message: error.message,
    });
    return;
  }

  // Internal server errors
  logger.error({
    err: error,
    traceId,
    method: request.method,
    path: request.url,
    userId: request.userId,
  }, 'Internal server error');

  reply.status(500).send({
    error: 'INTERNAL_ERROR',
    traceId,
    message: 'An unexpected error occurred.',
  });
}
