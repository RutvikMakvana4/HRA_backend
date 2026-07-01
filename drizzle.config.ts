import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://hra:hra@localhost:5432/hra',
  },
  strict: true,
  verbose: true,
});
