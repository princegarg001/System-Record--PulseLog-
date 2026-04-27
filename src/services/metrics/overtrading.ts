import { redis } from '../../cache/redis.js';
import { publishAlertEvent } from '../../queue/producer.js';
import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

/**
 * M5 — Overtrading Detector (Non-Blocking Sliding Window)
 * If user submits > 10 trades in any 30-minute window → emit alert event.
 * 
 * Per SKILL.md:
 * - MUST NOT block the write path — runs in analytics worker only
 * - Uses Redis sorted set, O(log N)
 * - Threshold is > 10, not >= 10 — flag on the 11th trade (pitfall #8)
 */
export async function checkOvertrading(trade: {
  tradeId: string;
  userId: string;
  entryAt: string;
}): Promise<boolean> {
  const key = `overtrading:${trade.userId}`;
  const now = new Date(trade.entryAt).getTime();
  const windowStart = now - 30 * 60 * 1000; // 30-minute window

  try {
    // Add current trade to sorted set (score = timestamp)
    await redis.zadd(key, now, trade.tradeId);

    // Evict trades outside the window
    await redis.zremrangebyscore(key, 0, windowStart);

    // Set TTL for automatic cleanup
    await redis.expire(key, 3600);

    // Count trades in window
    const count = await redis.zcard(key);

    // Flag on the 11th trade (> 10, not >= 10)
    if (count > 10) {
      // Emit alert event
      publishAlertEvent(
        {
          userId: trade.userId,
          eventType: 'overtrading',
          tradeId: trade.tradeId,
          tradeCount: count,
          windowMinutes: 30,
          timestamp: new Date().toISOString(),
        },
        trade.tradeId
      );

      // Insert event into DB for audit
      await pool.query(
        `INSERT INTO events (user_id, event_type, trade_id, details)
         VALUES ($1, 'overtrading', $2, $3)`,
        [
          trade.userId,
          trade.tradeId,
          JSON.stringify({
            tradeCount: count,
            windowMinutes: 30,
            triggeredAt: new Date().toISOString(),
          }),
        ]
      );

      logger.warn({
        userId: trade.userId,
        tradeId: trade.tradeId,
        tradeCount: count,
      }, 'M5: Overtrading alert triggered');

      return true;
    }

    return false;
  } catch (err) {
    logger.error({ err, tradeId: trade.tradeId }, 'M5: Failed to check overtrading');
    throw err;
  }
}
