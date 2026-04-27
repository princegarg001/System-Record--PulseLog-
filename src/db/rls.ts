import type pg from 'pg';

/**
 * Set app.current_user_id for PostgreSQL Row-Level Security.
 * MUST be called on every DB connection/transaction used by a request.
 * Uses `true` as third arg = transaction-local (not session-wide).
 * This prevents RLS state leaking across pooled connections.
 */
export async function setRlsUserId(client: pg.PoolClient, userId: string): Promise<void> {
  await client.query(
    "SELECT set_config('app.current_user_id', $1, true)",
    [userId]
  );
}

/**
 * Execute a query with RLS context set.
 * Acquires a client, sets RLS, runs the query, then releases.
 */
export async function queryWithRls(
  pool: pg.Pool,
  userId: string,
  queryText: string,
  values?: unknown[]
) {
  const client = await pool.connect();
  try {
    await setRlsUserId(client, userId);
    const result = await client.query(queryText, values);
    return result;
  } finally {
    client.release();
  }
}
