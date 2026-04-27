import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';
import { logger } from '../utils/logger.js';

const kafka = new Kafka({
  clientId: 'nevup-worker',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  retry: {
    initialRetryTime: 300,
    retries: 8,
  },
});

export interface ConsumerConfig {
  groupId: string;
  topic: string;
  handler: (payload: EachMessagePayload) => Promise<void>;
}

export async function createConsumer(config: ConsumerConfig): Promise<Consumer> {
  const consumer = kafka.consumer({
    groupId: config.groupId,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
  });

  await consumer.connect();
  logger.info({ groupId: config.groupId, topic: config.topic }, 'Kafka consumer connected');

  await consumer.subscribe({ topic: config.topic, fromBeginning: true });

  await consumer.run({
    eachMessage: config.handler,
  });

  return consumer;
}

export { kafka as workerKafka };
