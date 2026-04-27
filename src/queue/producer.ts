import { Kafka, type Producer, CompressionTypes } from 'kafkajs';
import { logger } from '../utils/logger.js';

const kafka = new Kafka({
  clientId: 'nevup-api',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: {
    initialRetryTime: 300,
    retries: 5,
  },
});

let producer: Producer | null = null;

export async function connectProducer(): Promise<Producer> {
  if (producer) return producer;

  producer = kafka.producer({
    allowAutoTopicCreation: true,
    transactionTimeout: 30000,
  });

  await producer.connect();
  logger.info('Kafka producer connected');
  return producer;
}

export function getProducer(): Producer | null {
  return producer;
}

/**
 * Fire-and-forget publish to Kafka topic.
 * NEVER blocks the write path — errors are logged, not thrown.
 * Per SKILL.md: "Kafka publish must be fire-and-forget — never await it on the write path"
 */
export function publishTradeEvent(trade: Record<string, unknown>, traceId: string): void {
  if (!producer) {
    logger.warn({ traceId }, 'Kafka producer not connected, skipping publish');
    return;
  }

  // Fire-and-forget: catch errors async
  producer.send({
    topic: 'trade.closed',
    compression: CompressionTypes.GZIP,
    messages: [
      {
        key: trade.tradeId as string,
        value: JSON.stringify(trade),
        headers: { traceId },
      },
    ],
  }).catch((err) => {
    logger.error({ err, tradeId: trade.tradeId, traceId }, 'Kafka publish failed (non-blocking)');
  });
}

/**
 * Publish alert event (overtrading, tilt, etc.)
 */
export function publishAlertEvent(alert: Record<string, unknown>, traceId: string): void {
  if (!producer) {
    logger.warn({ traceId }, 'Kafka producer not connected, skipping alert publish');
    return;
  }

  producer.send({
    topic: 'trade.alerts',
    messages: [
      {
        key: alert.userId as string,
        value: JSON.stringify(alert),
        headers: { traceId },
      },
    ],
  }).catch((err) => {
    logger.error({ err, traceId }, 'Kafka alert publish failed (non-blocking)');
  });
}

export async function disconnectProducer(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
    logger.info('Kafka producer disconnected');
  }
}

export { kafka };
