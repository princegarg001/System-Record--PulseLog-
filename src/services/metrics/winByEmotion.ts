import { pool } from '../../db/pool.js';
import { logger } from '../../utils/logger.js';

/**
 * M4 — Win Rate by Emotion
 * Per-user running win/loss counters keyed by emotionalState.
 * Upsert target: user_metrics.wins_by_emotion / losses_by_emotion (JSONB)
 * 
 * Uses atomic JSONB update pattern per SKILL.md spec.
 */
export async function updateWinLossByEmotion(
  userId: string,
  emotionalState: string | null | undefined,
  profitLoss: number | null | undefined
): Promise<void> {
  if (!emotionalState || profitLoss === null || profitLoss === undefined) return;

  const isWin = profitLoss >= 0;
  const emotion = emotionalState;

  try {
    if (isWin) {
      await pool.query(
        `INSERT INTO user_metrics (user_id, wins_by_emotion, last_updated)
         VALUES ($1, jsonb_build_object($2, 1), NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET wins_by_emotion = jsonb_set(
           COALESCE(user_metrics.wins_by_emotion, '{}'),
           ARRAY[$2],
           (COALESCE(user_metrics.wins_by_emotion->$2, '0')::int + 1)::text::jsonb
         ),
         last_updated = NOW()`,
        [userId, emotion]
      );
    } else {
      await pool.query(
        `INSERT INTO user_metrics (user_id, losses_by_emotion, last_updated)
         VALUES ($1, jsonb_build_object($2, 1), NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET losses_by_emotion = jsonb_set(
           COALESCE(user_metrics.losses_by_emotion, '{}'),
           ARRAY[$2],
           (COALESCE(user_metrics.losses_by_emotion->$2, '0')::int + 1)::text::jsonb
         ),
         last_updated = NOW()`,
        [userId, emotion]
      );
    }

    logger.debug({
      userId,
      emotionalState,
      result: isWin ? 'win' : 'loss',
    }, 'M4: Win/loss by emotion updated');
  } catch (err) {
    logger.error({ err, userId, emotionalState }, 'M4: Failed to update win/loss by emotion');
    throw err;
  }
}
