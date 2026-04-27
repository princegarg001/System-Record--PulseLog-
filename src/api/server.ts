import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import compress from '@fastify/compress';
import { tradeRoutes } from './routes/trades.js';
import { metricsRoutes } from './routes/metrics.js';
import { sessionRoutes } from './routes/sessions.js';
import { healthRoutes, httpRequestsTotal, httpRequestDuration } from './routes/health.js';
import { requestLoggerHook, responseLoggerHook } from '../middleware/requestLogger.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export async function buildServer() {
  const app = Fastify({
    logger: false, // We use our own Pino logger
    trustProxy: true,
    requestTimeout: 30000,
    bodyLimit: 1048576, // 1MB
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Response compression
  await app.register(compress);

  // Request lifecycle hooks
  app.addHook('onRequest', requestLoggerHook);
  app.addHook('onResponse', responseLoggerHook);

  // Prometheus metrics collection hook
  app.addHook('onResponse', (request, reply, done) => {
    const path = request.routeOptions?.url || request.url;
    httpRequestsTotal.inc({
      method: request.method,
      path,
      status: reply.statusCode.toString(),
    });

    const startTime = (request as unknown as Record<string, unknown>).startTime as bigint | undefined;
    if (startTime) {
      const duration = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      httpRequestDuration.observe({ method: request.method, path }, duration);
    }

    done();
  });

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Register routes
  await app.register(healthRoutes);    // /health, /metrics (no auth)
  await app.register(tradeRoutes);     // /trades (auth required)
  await app.register(metricsRoutes);   // /users/:userId/metrics (auth required)
  await app.register(sessionRoutes);   // /sessions/:sessionId (auth required)

  logger.info('Server routes registered');

  return app;
}
