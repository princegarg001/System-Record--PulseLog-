import 'dotenv/config';
import { createConsumer } from '../queue/consumer.js';
import { runPipeline, type TradeEvent } from '../services/metricsPipeline.js';
import { connectRedis, closeRedis } from '../cache/redis.js';
import { closePool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

const DLQ_TOPIC = 'trade.dlq';

/**
 * Analytics Worker — Kafka consumer for trade.closed events.
 * 
 * Per SKILL.md:
 * - NEVER rethrow — log and send to DLQ
 * - Each message triggers the full metrics pipeline (M1-M5)
 * - Error-isolated: one bad trade cannot crash the worker
 */
async function startWorker() {
  logger.info('Analytics Worker starting...');

  // Connect Redis (needed for M5 overtrading detector)
  await connectRedis();

  const consumer = await createConsumer({
    groupId: 'nevup-analytics-worker',
    topic: 'trade.closed',
    handler: async ({ message, partition }) => {
      const traceId = message.headers?.traceId?.toString() ?? 'unknown';

      if (!message.value) {
        logger.warn({ traceId, partition }, 'Empty message received, skipping');
        return;
      }

      let trade: TradeEvent;
      try {
        trade = JSON.parse(message.value.toString()) as TradeEvent;
      } catch (parseErr) {
        logger.error({ parseErr, traceId }, 'Failed to parse trade message');
        await publishToDLQ(message.value.toString(), 'JSON parse error');
        return;
      }

      try {
        await runPipeline(trade, traceId);
      } catch (err) {
        // NEVER rethrow — log and send to DLQ
        logger.error(
          { err, tradeId: trade.tradeId, traceId },
          'Metric computation failed, sending to DLQ'
        );
        await publishToDLQ(message.value.toString(), err instanceof Error ? err.message : 'Unknown error');
      }
    },
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Analytics Worker shutting down...');
    await consumer.disconnect();
    await closeRedis();
    await closePool();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('Analytics Worker running — consuming trade.closed events');
}

async function publishToDLQ(payload: string, error: string): Promise<void> {
  try {
    const { getProducer } = await import('../queue/producer.js');
    const producer = getProducer();
    if (producer) {
      await producer.send({
        topic: DLQ_TOPIC,
        messages: [
          {
            value: JSON.stringify({
              originalPayload: payload,
              error,
              failedAt: new Date().toISOString(),
            }),
          },
        ],
      });
    }
  } catch (dlqErr) {
    logger.error({ dlqErr }, 'Failed to publish to DLQ');
  }
}

startWorker().catch((err) => {
  logger.fatal({ err }, 'Analytics Worker failed to start');
  process.exit(1);
});
