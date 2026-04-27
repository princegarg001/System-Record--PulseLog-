import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

/**
 * M1 — Plan Adherence Score
 * Rolling average of planAdherence (1–5) across the user's last 10 closed trades.
 * Upsert target: user_metrics.plan_adherence_score
 */
export async function updatePlanAdherence(
  userId: string,
  planAdherence: number | null | undefined
): Promise<void> {
  if (planAdherence === null || planAdherence === undefined) return;

  try {
    const result = await pool.query(
      `WITH last_10 AS (
        SELECT plan_adherence FROM trades
        WHERE user_id = $1 AND plan_adherence IS NOT NULL AND status = 'closed'
        ORDER BY exit_at DESC LIMIT 10
      )
      SELECT ROUND(AVG(plan_adherence)::numeric, 2) AS score FROM last_10`,
      [userId]
    );

    const score = result.rows[0]?.score;
    if (score === null || score === undefined) return;

    await pool.query(
      `INSERT INTO user_metrics (user_id, plan_adherence_score, last_updated)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET plan_adherence_score = $2, last_updated = NOW()`,
      [userId, parseFloat(score)]
    );

    logger.debug({ userId, score: parseFloat(score) }, 'M1: Plan adherence updated');
  } catch (err) {
    logger.error({ err, userId }, 'M1: Failed to update plan adherence');
    throw err;
  }
}
