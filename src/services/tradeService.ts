import { pool } from '../db/pool.js';
import { setRlsUserId } from '../db/rls.js';
import { publishTradeEvent } from '../queue/producer.js';
import { logger } from '../utils/logger.js';

export interface TradeInput {
  tradeId: string;
  userId: string;
  sessionId: string;
  asset: string;
  assetClass: string;
  direction: string;
  entryPrice: number;
  exitPrice?: number | null;
  quantity: number;
  entryAt: string;
  exitAt?: string | null;
  status: string;
  planAdherence?: number | null;
  emotionalState?: string | null;
  entryRationale?: string | null;
}

export interface TradeResult {
  created: boolean;
  trade: Record<string, unknown>;
}

/**
 * Idempotent trade insertion.
 * - New trade → INSERT ... ON CONFLICT DO NOTHING → 201 Created
 * - Duplicate tradeId → returns existing → 200 OK
 * - Never returns 409/500 for duplicates (per SKILL.md pitfall #6)
 * - profit_loss is GENERATED ALWAYS AS — never set manually (pitfall #1)
 * - Kafka publish is fire-and-forget (pitfall #3)
 */
export async function createTrade(
  input: TradeInput,
  traceId: string
): Promise<TradeResult> {
  const client = await pool.connect();

  try {
    // Set RLS context — transaction-local (pitfall #2)
    await setRlsUserId(client, input.userId);

    // Ensure session exists (upsert)
    await client.query(
      `INSERT INTO sessions (session_id, user_id, started_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO NOTHING`,
      [input.sessionId, input.userId, input.entryAt]
    );

    // Idempotent trade insert — ON CONFLICT DO NOTHING
    // Note: DO NOT include profit_loss — it's GENERATED ALWAYS AS
    const insertResult = await client.query(
      `INSERT INTO trades (
        trade_id, user_id, session_id, asset, asset_class, direction,
        entry_price, exit_price, quantity, entry_at, exit_at, status,
        plan_adherence, emotional_state, entry_rationale
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (trade_id) DO NOTHING
      RETURNING *`,
      [
        input.tradeId,
        input.userId,
        input.sessionId,
        input.asset,
        input.assetClass,
        input.direction,
        input.entryPrice,
        input.exitPrice ?? null,
        input.quantity,
        input.entryAt,
        input.exitAt ?? null,
        input.status,
        input.planAdherence ?? null,
        input.emotionalState ?? null,
        input.entryRationale ?? null,
      ]
    );

    // If RETURNING returned a row, it was newly inserted
    if (insertResult.rows.length > 0) {
      const trade = formatTradeRow(insertResult.rows[0]!);

      // Fire-and-forget Kafka publish for closed trades
      if (input.status === 'closed') {
        publishTradeEvent(trade, traceId);
      }

      logger.info({ tradeId: input.tradeId, traceId, status: 'created' }, 'Trade created');
      return { created: true, trade };
    }

    // Duplicate — fetch existing trade
    const existingResult = await client.query(
      'SELECT * FROM trades WHERE trade_id = $1',
      [input.tradeId]
    );

    const existingTrade = formatTradeRow(existingResult.rows[0]!);
    logger.info({ tradeId: input.tradeId, traceId, status: 'existing' }, 'Duplicate trade (idempotent)');
    return { created: false, trade: existingTrade };

  } finally {
    client.release();
  }
}

/**
 * Get a single trade by ID
 */
export async function getTradeById(
  tradeId: string,
  userId: string
): Promise<Record<string, unknown> | null> {
  const client = await pool.connect();
  try {
    await setRlsUserId(client, userId);
    const result = await client.query(
      'SELECT * FROM trades WHERE trade_id = $1',
      [tradeId]
    );
    if (result.rows.length === 0) return null;
    return formatTradeRow(result.rows[0]!);
  } finally {
    client.release();
  }
}

/**
 * Get paginated trades for a user
 */
export async function getUserTrades(
  userId: string,
  options: { limit?: number; offset?: number; from?: string; to?: string }
): Promise<{ trades: Record<string, unknown>[]; total: number }> {
  const client = await pool.connect();
  try {
    await setRlsUserId(client, userId);

    const limit = options.limit || 50;
    const offset = options.offset || 0;
    let whereClause = 'WHERE user_id = $1';
    const params: unknown[] = [userId];

    if (options.from) {
      params.push(options.from);
      whereClause += ` AND entry_at >= $${params.length}`;
    }
    if (options.to) {
      params.push(options.to);
      whereClause += ` AND entry_at <= $${params.length}`;
    }

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM trades ${whereClause}`,
      params
    );

    const result = await client.query(
      `SELECT * FROM trades ${whereClause} ORDER BY entry_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    return {
      trades: result.rows.map(formatTradeRow),
      total: countResult.rows[0]?.total ?? 0,
    };
  } finally {
    client.release();
  }
}

/**
 * Format a database trade row to API response format (camelCase)
 */
function formatTradeRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    tradeId: row.trade_id,
    userId: row.user_id,
    sessionId: row.session_id,
    asset: row.asset,
    assetClass: row.asset_class,
    direction: row.direction,
    entryPrice: Number(row.entry_price),
    exitPrice: row.exit_price !== null ? Number(row.exit_price) : null,
    quantity: Number(row.quantity),
    entryAt: row.entry_at,
    exitAt: row.exit_at,
    status: row.status,
    planAdherence: row.plan_adherence,
    emotionalState: row.emotional_state,
    entryRationale: row.entry_rationale,
    pnl: row.profit_loss !== null ? Number(row.profit_loss) : null,
    outcome: row.profit_loss !== null
      ? (Number(row.profit_loss) >= 0 ? 'win' : 'loss')
      : null,
    revengeFlag: row.revenge_flag,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
