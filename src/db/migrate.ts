import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

/**
 * Database migration runner.
 * Executes SQL files from the migrations/ directory in order.
 */
async function migrate() {
  logger.info('Running database migrations...');

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    logger.info({ file }, 'Executing migration');

    try {
      await pool.query(sql);
      logger.info({ file }, 'Migration completed');
    } catch (err) {
      logger.error({ err, file }, 'Migration failed');
      throw err;
    }
  }

  logger.info('All migrations completed');
  await pool.end();
}

migrate().catch((err) => {
  logger.fatal({ err }, 'Migration runner failed');
  process.exit(1);
});
