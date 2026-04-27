import type { FastifyInstance } from 'fastify';
import { checkDbHealth, getPoolStats } from '../../db/pool.js';
import { checkRedisHealth } from '../../cache/redis.js';
import promClient from 'prom-client';

// Prometheus metrics setup
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

// Custom metrics per SKILL.md
export const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [register],
});

export const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'path'],
  buckets: [5, 10, 25, 50, 100, 150, 250, 500, 1000],
  registers: [register],
});

export const tradesIngestedTotal = new promClient.Counter({
  name: 'trades_ingested_total',
  help: 'Total trades ingested',
  labelNames: ['status'],
  registers: [register],
});

export const metricComputationDuration = new promClient.Histogram({
  name: 'metric_computation_duration_ms',
  help: 'Metric computation duration in milliseconds',
  labelNames: ['metric_name'],
  buckets: [1, 5, 10, 25, 50, 100, 250],
  registers: [register],
});

export const dbPoolConnections = new promClient.Gauge({
  name: 'db_pool_connections',
  help: 'Database pool connection count',
  labelNames: ['state'],
  registers: [register],
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /health — Liveness check (no auth required)
   * Returns DB connection state and queue lag.
   */
  app.get('/health', async (_request, reply) => {
    const dbHealthy = await checkDbHealth();
    const redisHealthy = await checkRedisHealth();
    const poolStats = getPoolStats();

    // Check Kafka producer connectivity
    let kafkaHealthy = false;
    try {
      const { getProducer } = await import('../../queue/producer.js');
      kafkaHealthy = getProducer() !== null;
    } catch {
      kafkaHealthy = false;
    }

    // Update pool metrics
    dbPoolConnections.set({ state: 'idle' }, poolStats.idleCount);
    dbPoolConnections.set({ state: 'active' }, poolStats.totalCount - poolStats.idleCount);

    const isHealthy = dbHealthy && redisHealthy;

    const response = {
      status: isHealthy ? 'ok' as const : 'degraded' as const,
      dbConnection: dbHealthy ? 'connected' as const : 'disconnected' as const,
      redisConnection: redisHealthy ? 'connected' as const : 'disconnected' as const,
      kafkaConnection: kafkaHealthy ? 'connected' as const : 'disconnected' as const,
      queueLag: 0,
      poolStats,
      timestamp: new Date().toISOString(),
    };

    return reply.status(isHealthy ? 200 : 503).send(response);
  });

  /**
   * GET /metrics — Prometheus scrape endpoint (no auth required)
   */
  app.get('/metrics', async (_request, reply) => {
    const metrics = await register.metrics();
    reply.header('Content-Type', register.contentType).send(metrics);
  });
}
