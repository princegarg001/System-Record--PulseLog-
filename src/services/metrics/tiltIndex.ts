import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

/**
 * M3 — Session Tilt Index
 * tilt_index = loss-following trades / total trades in session.
 * Range [0, 1]. A "loss-following" trade is one opened after a losing close.
 * 
 * Uses SQL window function (LAG) per SKILL.md spec.
 * Upsert target: session_metrics (tilt_index, total_trades, loss_follows)
 */
export async function updateTiltIndex(sessionId: string): Promise<void> {
  try {
    const result = await pool.query(
      `WITH ordered AS (
        SELECT profit_loss,
          LAG(profit_loss) OVER (ORDER BY exit_at) AS prev_pnl,
          COUNT(*) OVER () AS total_count
        FROM trades WHERE session_id = $1 AND status = 'closed'
      )
      SELECT 
        COUNT(*) FILTER (WHERE prev_pnl < 0) AS loss_follows,
        MAX(total_count) AS total
      FROM ordered`,
      [sessionId]
    );

    const row = result.rows[0];
    if (!row || !row.total || row.total === 0) return;

    const lossFollows = Number(row.loss_follows) || 0;
    const total = Number(row.total);
    const tiltIndex = total > 0 ? Math.round((lossFollows / total) * 10000) / 10000 : 0;

    await pool.query(
      `INSERT INTO session_metrics (session_id, tilt_index, total_trades, loss_follows, last_updated)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (session_id) DO UPDATE
       SET tilt_index = $2, total_trades = $3, loss_follows = $4, last_updated = NOW()`,
      [sessionId, tiltIndex, total, lossFollows]
    );

    logger.debug({
      sessionId,
      tiltIndex,
      totalTrades: total,
      lossFollows,
    }, 'M3: Tilt index updated');
  } catch (err) {
    logger.error({ err, sessionId }, 'M3: Failed to update tilt index');
    throw err;
  }
}
