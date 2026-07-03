import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    // Prefer DIRECT_URL: drizzle-kit runs schema DDL, which must skip the Neon/pgbouncer pooler.
    // Falls back to DATABASE_URL locally where there is no separate direct connection.
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      'postgres://hra:hra@localhost:5432/hra',
  },
  strict: true,
  verbose: true,
});
