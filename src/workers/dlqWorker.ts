import 'dotenv/config';
import { createConsumer } from '../queue/consumer.js';
import { logger } from '../utils/logger.js';

/**
 * Dead-Letter Queue Worker
 * Processes failed trade events for investigation/retry.
 */
async function startDlqWorker() {
  logger.info('DLQ Worker starting...');

  await createConsumer({
    groupId: 'nevup-dlq-worker',
    topic: 'trade.dlq',
    handler: async ({ message }) => {
      if (!message.value) return;

      const payload = JSON.parse(message.value.toString());
      logger.warn({
        originalPayload: payload.originalPayload ? JSON.parse(payload.originalPayload) : null,
        error: payload.error,
        failedAt: payload.failedAt,
      }, 'DLQ: Processing failed trade event');

      // In production: retry logic, alerting, manual review queue
      // For hackathon scope: just log it
    },
  });

  logger.info('DLQ Worker running');
}

startDlqWorker().catch((err) => {
  logger.fatal({ err }, 'DLQ Worker failed to start');
  process.exit(1);
});
