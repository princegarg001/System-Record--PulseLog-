import { updatePlanAdherence } from './metrics/planAdherence.js';
import { checkRevengeFlag } from './metrics/revengeFlag.js';
import { updateTiltIndex } from './metrics/tiltIndex.js';
import { updateWinLossByEmotion } from './metrics/winByEmotion.js';
import { checkOvertrading } from './metrics/overtrading.js';
import { logger } from '../utils/logger.js';

export interface TradeEvent {
  tradeId: string;
  userId: string;
  sessionId: string;
  asset: string;
  assetClass: string;
  direction: string;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  entryAt: string;
  exitAt: string | null;
  status: string;
  planAdherence: number | null;
  emotionalState: string | null;
  entryRationale: string | null;
  pnl: number | null;
}

/**
 * Metrics Pipeline Orchestrator
 * 
 * Execution order per SKILL.md:
 * 
 * PARALLEL (independent state):
 *   - M1: Plan Adherence Score
 *   - M4: Win/Loss by Emotion
 *   - M5: Overtrading Detector (Redis, fully non-blocking)
 * 
 * SEQUENTIAL (depend on prior trade data):
 *   - M2: Revenge Trade Flag
 *   - M3: Session Tilt Index
 * 
 * Per SKILL.md pitfall #4:
 * M2 and M3 must run AFTER M1/M4/M5 — they depend on prior trade state
 */
export async function runPipeline(trade: TradeEvent, traceId: string): Promise<void> {
  const startTime = Date.now();

  logger.info({ tradeId: trade.tradeId, traceId }, 'Pipeline: Starting metric computation');

  try {
    // PHASE 1: Parallel metrics (independent state)
    await Promise.all([
      updatePlanAdherence(trade.userId, trade.planAdherence),
      updateWinLossByEmotion(trade.userId, trade.emotionalState, trade.pnl),
      checkOvertrading({
        tradeId: trade.tradeId,
        userId: trade.userId,
        entryAt: trade.entryAt,
      }),
    ]);

    // PHASE 2: Sequential metrics (depend on prior trade data)
    await checkRevengeFlag({
      tradeId: trade.tradeId,
      userId: trade.userId,
      sessionId: trade.sessionId,
      entryAt: trade.entryAt,
      emotionalState: trade.emotionalState,
    });

    await updateTiltIndex(trade.sessionId);

    // Mark trade as processed
    const { pool } = await import('../db/pool.js');
    await pool.query(
      'UPDATE trades SET processed_at = NOW() WHERE trade_id = $1',
      [trade.tradeId]
    );

    const duration = Date.now() - startTime;
    logger.info({
      tradeId: trade.tradeId,
      traceId,
      durationMs: duration,
    }, 'Pipeline: All metrics computed successfully');

  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error({
      err,
      tradeId: trade.tradeId,
      traceId,
      durationMs: duration,
    }, 'Pipeline: Metric computation failed');
    throw err;
  }
}
