import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

interface SeedTrade {
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
  revengeFlag: boolean;
}

interface SeedSession {
  sessionId: string;
  userId: string;
  date: string;
  notes: string;
  trades: SeedTrade[];
}

interface SeedTrader {
  userId: string;
  name: string;
  sessions: SeedSession[];
}

interface SeedData {
  traders: SeedTrader[];
}

async function seed() {
  logger.info('Starting seed data import...');

  // Find seed data file
  const seedPaths = [
    path.resolve(process.cwd(), '..', 'nevup_seed_dataset.json'),
    path.resolve(process.cwd(), 'nevup_seed_dataset.json'),
  ];

  let seedPath: string | null = null;
  for (const p of seedPaths) {
    if (fs.existsSync(p)) {
      seedPath = p;
      break;
    }
  }

  if (!seedPath) {
    logger.error('Seed data file not found. Tried: ' + seedPaths.join(', '));
    process.exit(1);
  }

  const rawData = fs.readFileSync(seedPath, 'utf-8');
  const data: SeedData = JSON.parse(rawData);

  let sessionCount = 0;
  let tradeCount = 0;

  for (const trader of data.traders) {
    // Insert user (ON CONFLICT for idempotency)
    await pool.query(
      `INSERT INTO users (user_id, name) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
      [trader.userId, trader.name]
    );

    // Initialize user_metrics
    await pool.query(
      `INSERT INTO user_metrics (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [trader.userId]
    );

    for (const session of trader.sessions) {
      // Insert session
      await pool.query(
        `INSERT INTO sessions (session_id, user_id, started_at, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (session_id) DO NOTHING`,
        [session.sessionId, session.userId, session.date, session.notes || null]
      );
      sessionCount++;

      for (const trade of session.trades) {
        // Insert trade — DO NOT include profit_loss (GENERATED ALWAYS AS)
        await pool.query(
          `INSERT INTO trades (
            trade_id, user_id, session_id, asset, asset_class, direction,
            entry_price, exit_price, quantity, entry_at, exit_at, status,
            plan_adherence, emotional_state, entry_rationale, revenge_flag
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          ON CONFLICT (trade_id) DO NOTHING`,
          [
            trade.tradeId,
            trade.userId,
            trade.sessionId,
            trade.asset,
            trade.assetClass,
            trade.direction,
            trade.entryPrice,
            trade.exitPrice,
            trade.quantity,
            trade.entryAt,
            trade.exitAt,
            trade.status,
            trade.planAdherence,
            trade.emotionalState,
            trade.entryRationale,
            trade.revengeFlag,
          ]
        );
        tradeCount++;
      }
    }

    logger.info({ userId: trader.userId, name: trader.name }, 'Trader seeded');
  }

  logger.info({
    tradersSeeded: data.traders.length,
    sessionsSeeded: sessionCount,
    tradesSeeded: tradeCount,
  }, 'Seed data import complete');

  await pool.end();
}

seed().catch((err) => {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
});
