import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

/**
 * M2 — Revenge Trade Flag
 * Flags a trade as revenge if it opens within 90s of a losing close
 * AND emotionalState is 'anxious' or 'fearful'.
 * 
 * Per SKILL.md:
 * 1. If emotionalState not in ['anxious', 'fearful'] → early return
 * 2. Fetch last closed trade in same sessionId before entry_at
 * 3. Calculate gapSeconds = (entry_at - last.exit_at) / 1000
 * 4. If last.profit_loss < 0 AND gapSeconds <= 90 → set revenge_flag = TRUE + insert event
 */
export async function checkRevengeFlag(trade: {
  tradeId: string;
  userId: string;
  sessionId: string;
  entryAt: string;
  emotionalState?: string | null;
}): Promise<boolean> {
  // Step 1: Early return if emotion is not anxious or fearful
  if (!trade.emotionalState || !['anxious', 'fearful'].includes(trade.emotionalState)) {
    return false;
  }

  try {
    // Step 2: Fetch last closed trade in same session before this trade's entry
    const prevResult = await pool.query(
      `SELECT trade_id, exit_at, profit_loss FROM trades
       WHERE session_id = $1 AND status = 'closed' AND exit_at < $2
       ORDER BY exit_at DESC LIMIT 1`,
      [trade.sessionId, trade.entryAt]
    );

    if (prevResult.rows.length === 0) return false;

    const prevTrade = prevResult.rows[0]!;
    const prevExitAt = new Date(prevTrade.exit_at as string).getTime();
    const currentEntryAt = new Date(trade.entryAt).getTime();

    // Step 3: Calculate gap in seconds
    const gapSeconds = (currentEntryAt - prevExitAt) / 1000;

    // Step 4: Check conditions
    const prevPnl = Number(prevTrade.profit_loss);
    if (prevPnl < 0 && gapSeconds <= 90) {
      // Set revenge_flag = TRUE
      await pool.query(
        'UPDATE trades SET revenge_flag = TRUE WHERE trade_id = $1',
        [trade.tradeId]
      );

      // Insert event for audit
      await pool.query(
        `INSERT INTO events (user_id, event_type, trade_id, details)
         VALUES ($1, 'revenge_trade', $2, $3)`,
        [
          trade.userId,
          trade.tradeId,
          JSON.stringify({
            prevTradeId: prevTrade.trade_id,
            gapSeconds: Math.round(gapSeconds),
            prevPnl,
            emotionalState: trade.emotionalState,
          }),
        ]
      );

      logger.info({
        tradeId: trade.tradeId,
        userId: trade.userId,
        gapSeconds: Math.round(gapSeconds),
        prevPnl,
      }, 'M2: Revenge trade flagged');

      return true;
    }

    return false;
  } catch (err) {
    logger.error({ err, tradeId: trade.tradeId }, 'M2: Failed to check revenge flag');
    throw err;
  }
}
