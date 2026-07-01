import 'reflect-metadata';
import 'dotenv/config';
import { buildDrizzle, createPool } from './client';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to seed.');
  const ssl = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';

  const pool = createPool({ connectionString, max: 1, ssl });
  try {
    buildDrizzle(pool);
    console.error('[seed] seeding database...');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
