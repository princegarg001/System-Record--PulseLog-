import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// PgBouncer-aware connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://nevup:secret@localhost:5432/nevup',
  max: 20,                    // Pool 20 connections
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,   // 10s query timeout
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected pool error');
});

pool.on('connect', () => {
  logger.debug('New pool connection established');
});

export { pool };

// Helper to get a client for transaction use
export async function getClient() {
  const client = await pool.connect();
  return client;
}

// Health check helper
export async function checkDbHealth(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

// Pool stats for Prometheus metrics
export function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

// Graceful shutdown
export async function closePool() {
  await pool.end();
  logger.info('Database pool closed');
}
