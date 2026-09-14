import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from './schema.js';
import env from '../constants/env.js';
import { logger } from '../libs/logger.js';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: env.DB_POOL_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DB_POOL_CONNECTION_TIMEOUT_MS,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected DB pool error');
});

const db = drizzle(pool, { schema, casing: 'snake_case' });

export async function runMigrations() {
  try {
    const migrationDb = drizzle(pool, { casing: undefined });
    await migrate(migrationDb, { migrationsFolder: './migrations' });
    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.fatal({ err: error }, 'Database migration failed');
    process.exit(1); // fail-fast: orchestrator me-restart container
  }
}

export async function closePool() {
  await pool.end();
}

export { pool };
export default db;
