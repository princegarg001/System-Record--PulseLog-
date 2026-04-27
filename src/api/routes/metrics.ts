import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUserMetrics } from '../../services/metricsService.js';
import { authMiddleware } from '../../middleware/auth.js';
import { enforceTenancy } from '../../middleware/tenancy.js';
import { validateMetricsQuery, formatValidationErrors } from '../../utils/validate.js';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /users/:userId/metrics — Behavioral metrics timeseries
   * Query params: from, to, granularity (hourly|daily|rolling30d)
   */
  app.get<{
    Params: { userId: string };
    Querystring: { from: string; to: string; granularity: string };
  }>(
    '/users/:userId/metrics',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      // Enforce tenancy
      const tenancyResult = enforceTenancy(request, reply);
      if (tenancyResult) return tenancyResult;

      const { userId } = request.params;
      const { from, to, granularity } = request.query;

      // Validate query params
      const valid = validateMetricsQuery({ from, to, granularity });
      if (!valid) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          traceId: request.traceId,
          details: formatValidationErrors(validateMetricsQuery.errors),
          message: 'Invalid query parameters.',
        });
      }

      const metrics = await getUserMetrics({
        userId,
        from,
        to,
        granularity: granularity as 'hourly' | 'daily' | 'rolling30d',
      });

      return reply.status(200).send(metrics);
    }
  );

  /**
   * GET /users/:userId/profile — Behavioral profile (placeholder)
   */
  app.get<{ Params: { userId: string } }>(
    '/users/:userId/profile',
    { preHandler: [authMiddleware] },
    async (request, reply) => {
      const tenancyResult = enforceTenancy(request, reply);
      if (tenancyResult) return tenancyResult;

      const { userId } = request.params;

      // Basic profile derived from metrics
      const metrics = await getUserMetrics({
        userId,
        from: '2025-01-01T00:00:00Z',
        to: '2026-12-31T23:59:59Z',
        granularity: 'daily',
      });

      return reply.status(200).send({
        userId,
        generatedAt: new Date().toISOString(),
        dominantPathologies: [],
        strengths: [],
        peakPerformanceWindow: null,
        metrics,
      });
    }
  );
}
