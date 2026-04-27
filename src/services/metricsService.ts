import { pool } from '../db/pool.js';
import { setRlsUserId } from '../db/rls.js';
import { logger } from '../utils/logger.js';

export interface MetricsQuery {
  userId: string;
  from: string;
  to: string;
  granularity: 'hourly' | 'daily' | 'rolling30d';
}

export interface BehavioralMetrics {
  userId: string;
  granularity: string;
  from: string;
  to: string;
  planAdherenceScore: number | null;
  sessionTiltIndex: number | null;
  winRateByEmotionalState: Record<string, { wins: number; losses: number; winRate: number }>;
  revengeTrades: number;
  overtradingEvents: number;
  timeseries: Array<{
    bucket: string;
    tradeCount: number;
    winRate: number;
    pnl: number;
    avgPlanAdherence: number;
  }>;
}

/**
 * Get behavioral metrics for a user within a date range.
 */
export async function getUserMetrics(query: MetricsQuery): Promise<BehavioralMetrics> {
  const client = await pool.connect();

  try {
    await setRlsUserId(client, query.userId);

    // 1. Plan adherence score (latest from user_metrics)
    const adherenceResult = await client.query(
      'SELECT plan_adherence_score FROM user_metrics WHERE user_id = $1',
      [query.userId]
    );
    const planAdherenceScore = adherenceResult.rows[0]?.plan_adherence_score ?? null;

    // 2. Session tilt index (average across sessions in period)
    const tiltResult = await client.query(
      `SELECT AVG(sm.tilt_index) as avg_tilt
       FROM session_metrics sm
       JOIN sessions s ON s.session_id = sm.session_id
       WHERE s.user_id = $1 AND s.started_at >= $2 AND s.started_at <= $3`,
      [query.userId, query.from, query.to]
    );
    const sessionTiltIndex = tiltResult.rows[0]?.avg_tilt
      ? Math.round(parseFloat(tiltResult.rows[0].avg_tilt) * 10000) / 10000
      : null;

    // 3. Win rate by emotional state
    const emotionResult = await client.query(
      'SELECT wins_by_emotion, losses_by_emotion FROM user_metrics WHERE user_id = $1',
      [query.userId]
    );
    const winsMap = emotionResult.rows[0]?.wins_by_emotion || {};
    const lossesMap = emotionResult.rows[0]?.losses_by_emotion || {};

    const emotions = new Set([...Object.keys(winsMap), ...Object.keys(lossesMap)]);
    const winRateByEmotionalState: Record<string, { wins: number; losses: number; winRate: number }> = {};

    for (const emotion of emotions) {
      const wins = parseInt(winsMap[emotion] ?? '0', 10);
      const losses = parseInt(lossesMap[emotion] ?? '0', 10);
      const total = wins + losses;
      winRateByEmotionalState[emotion] = {
        wins,
        losses,
        winRate: total > 0 ? Math.round((wins / total) * 100) / 100 : 0,
      };
    }

    // 4. Revenge trade count in period
    const revengeResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM trades
       WHERE user_id = $1 AND revenge_flag = TRUE
       AND entry_at >= $2 AND entry_at <= $3`,
      [query.userId, query.from, query.to]
    );
    const revengeTrades = revengeResult.rows[0]?.count ?? 0;

    // 5. Overtrading events in period
    const overtradingResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM events
       WHERE user_id = $1 AND event_type = 'overtrading'
       AND created_at >= $2 AND created_at <= $3`,
      [query.userId, query.from, query.to]
    );
    const overtradingEvents = overtradingResult.rows[0]?.count ?? 0;

    // 6. Timeseries buckets
    const bucketExpr = getBucketExpression(query.granularity);
    const timeseriesResult = await client.query(
      `SELECT
        ${bucketExpr} AS bucket,
        COUNT(*)::int AS trade_count,
        ROUND(
          COUNT(*) FILTER (WHERE profit_loss >= 0)::numeric /
          NULLIF(COUNT(*), 0), 2
        ) AS win_rate,
        ROUND(COALESCE(SUM(profit_loss), 0)::numeric, 2) AS pnl,
        ROUND(AVG(plan_adherence)::numeric, 2) AS avg_plan_adherence
       FROM trades
       WHERE user_id = $1 AND status = 'closed'
       AND entry_at >= $2 AND entry_at <= $3
       GROUP BY bucket
       ORDER BY bucket`,
      [query.userId, query.from, query.to]
    );

    const timeseries = timeseriesResult.rows.map((row) => ({
      bucket: row.bucket,
      tradeCount: row.trade_count,
      winRate: parseFloat(row.win_rate ?? '0'),
      pnl: parseFloat(row.pnl ?? '0'),
      avgPlanAdherence: parseFloat(row.avg_plan_adherence ?? '0'),
    }));

    return {
      userId: query.userId,
      granularity: query.granularity,
      from: query.from,
      to: query.to,
      planAdherenceScore,
      sessionTiltIndex,
      winRateByEmotionalState,
      revengeTrades,
      overtradingEvents,
      timeseries,
    };
  } catch (err) {
    logger.error({ err, userId: query.userId }, 'Failed to get user metrics');
    throw err;
  } finally {
    client.release();
  }
}

function getBucketExpression(granularity: string): string {
  switch (granularity) {
    case 'hourly':
      return "date_trunc('hour', entry_at)::text";
    case 'daily':
      return "date_trunc('day', entry_at)::text";
    case 'rolling30d':
      return "date_trunc('month', entry_at)::text";
    default:
      return "date_trunc('day', entry_at)::text";
  }
}
