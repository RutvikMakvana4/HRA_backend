import 'reflect-metadata';
import 'dotenv/config'; // load .env so `pnpm db:migrate` works without exporting vars
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { buildDrizzle, createPool } from './client';

/**
 * Standalone migration runner (`pnpm db:migrate`). Forward-only, applied as a GATED step —
 * never by the app at boot in production (CLAUDE.md §5.5). Reads DATABASE_URL / DATABASE_SSL
 * from the env (managed Postgres such as RDS requires TLS).
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }

  const ssl = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';
  const pool = createPool({ connectionString, max: 1, ssl });
  try {
    const db = buildDrizzle(pool);
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    console.error('[migrate] migrations applied successfully');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
