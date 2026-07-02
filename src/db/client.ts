import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';
import * as relations from './relations';

/** The combined schema + relations object handed to drizzle. */
const fullSchema = { ...schema, ...relations };

/** Strongly-typed Drizzle database, aware of every table and relation. */
export type Database = NodePgDatabase<typeof fullSchema>;

export interface CreatePoolOptions {
  connectionString: string;
  max?: number;
  ssl?: boolean;
}

/** Build the pg connection {@link Pool}. The owning provider closes it on shutdown. */
export function createPool(options: CreatePoolOptions): Pool {
  const poolConfig: PoolConfig = {
    connectionString: options.connectionString,
    max: options.max ?? 10,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
    // Hosted Postgres drops idle connections; keepAlive + a short idle timeout let the pool retire
    // stale clients and open fresh ones instead of handing out a dead one mid-poll.
    keepAlive: true,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };
  const pool = new Pool(poolConfig);
  // CRITICAL: a Pool with no 'error' listener THROWS (uncaught) when the backend terminates an idle
  // client — which breaks long-running processes (the ingestion worker) after the DB drops an idle
  // connection. Log and discard the dead client; node-postgres opens a new one on the next query.
  pool.on('error', (err: Error) => {
    console.error('[db] idle client error (discarded):', err.message);
  });
  return pool;
}

/**
 * Build the Drizzle client over an existing pool. This is the single data layer
 * (CLAUDE.md §2) and is exposed app-wide via the `DRIZZLE` token — never imported as an ad
 * hoc singleton.
 */
export function buildDrizzle(pool: Pool): Database {
  return drizzle(pool, { schema: fullSchema });
}
