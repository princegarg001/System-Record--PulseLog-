import type { FastifyRequest, FastifyReply } from 'fastify';
import * as jose from 'jose';
import { logger } from '../utils/logger.js';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || '97791d4db2aa5f689c3cc39356ce35762f0a73aa70923039d8ef72a2840a1b02'
);

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    traceId: string;
    jwtPayload: jose.JWTPayload;
  }
}

/**
 * JWT Authentication middleware.
 * - Verifies HS256 signature
 * - Extracts `sub` (userId) from payload
 * - Sets userId on request for downstream use
 * - Returns 401 for missing/invalid/expired tokens
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      traceId: request.traceId,
      message: 'Missing Authorization header.',
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      traceId: request.traceId,
      message: 'Malformed Authorization header. Expected: Bearer <token>',
    });
  }

  const token = parts[1];

  try {
    const { payload } = await jose.jwtVerify(token, JWT_SECRET, {
      algorithms: ['HS256'],
      clockTolerance: 0,  // 0 seconds tolerance — use UTC strictly
    });

    if (!payload.sub) {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        traceId: request.traceId,
        message: 'Token missing required sub claim.',
      });
    }

    // Validate role claim
    if (payload.role !== 'trader') {
      return reply.status(401).send({
        error: 'UNAUTHORIZED',
        traceId: request.traceId,
        message: 'Invalid role in token.',
      });
    }

    request.userId = payload.sub;
    request.jwtPayload = payload;

  } catch (err) {
    const isExpired = err instanceof jose.errors.JWTExpired;
    const message = isExpired
      ? 'Token has expired.'
      : 'Invalid or malformed token.';

    logger.warn({ err, traceId: request.traceId }, 'JWT verification failed');

    return reply.status(401).send({
      error: 'UNAUTHORIZED',
      traceId: request.traceId,
      message,
    });
  }
}
