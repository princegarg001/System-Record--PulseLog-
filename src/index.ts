import 'dotenv/config';
import { buildServer } from './api/server.js';
import { connectProducer, disconnectProducer } from './queue/producer.js';
import { connectRedis, closeRedis } from './cache/redis.js';
import { closePool } from './db/pool.js';
import { logger } from './utils/logger.js';

const PORT = parseInt(process.env.PORT || '4010', 10);
const HOST = '0.0.0.0';

async function main() {
  logger.info('NevUp Backend starting...');

  // Connect to infrastructure
  try {
    await connectRedis();
    logger.info('Redis connected');
  } catch (err) {
    logger.warn({ err }, 'Redis connection failed — M5 overtrading detector will be unavailable');
  }

  try {
    await connectProducer();
    logger.info('Kafka producer connected');
  } catch (err) {
    logger.warn({ err }, 'Kafka connection failed — trade events will not be published');
  }

  // Build and start Fastify server
  const app = await buildServer();

  try {
    await app.listen({ port: PORT, host: HOST });
    logger.info({ port: PORT, host: HOST }, `NevUp Backend listening on http://${HOST}:${PORT}`);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');
    await app.close();
    await disconnectProducer();
    await closeRedis();
    await closePool();
    logger.info('Server shut down gracefully');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Unhandled rejection safety
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
