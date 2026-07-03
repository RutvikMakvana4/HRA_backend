import 'dotenv/config'; // load .env so `pnpm db:backup` works without exporting vars
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Scheduled backup runner (`pnpm db:backup`). Runs a per-database `pg_dump` in the custom
 * (`-Fc`) format to ./backups, so we are never solely dependent on Neon and rehearse the exact
 * command used for the final cutover to the self-hosted server.
 *
 * Uses the DIRECT/unpooled URL (DIRECT_URL) when set — dumps should bypass the pooler — and falls
 * back to DATABASE_URL locally. Requires pg_dump 17+ on PATH (matching the server major version).
 */
function main(): void {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DIRECT_URL or DATABASE_URL is required to run a backup.');
  }

  const outDir = join(process.cwd(), 'backups');
  mkdirSync(outDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const outFile = join(outDir, `hra_${date}.dump`);

  console.error(`[backup] dumping to ${outFile}`);
  const result = spawnSync('pg_dump', [connectionString, '-Fc', '-f', outFile], {
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(`pg_dump failed to start (is it installed and on PATH?): ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`pg_dump exited with code ${result.status ?? 'unknown'}`);
  }
  console.error('[backup] backup completed successfully');
}

try {
  main();
} catch (err: unknown) {
  console.error('[backup] failed:', err);
  process.exit(1);
}
