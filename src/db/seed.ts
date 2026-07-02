import 'reflect-metadata';
import 'dotenv/config';
import * as argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { buildDrizzle, createPool } from './client';
import { employees, userAccounts } from './schema';

/**
 * Idempotent bootstrap seed. Creates a first Super Admin (employee + login account) so the system
 * can be administered. Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD, with dev
 * defaults. Safe to re-run: it skips if that work email already exists.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to seed.');
  const ssl = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';

  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@scalixity.com';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const pool = createPool({ connectionString, max: 1, ssl });
  try {
    const db = buildDrizzle(pool);

    const existing = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.workEmail, email))
      .limit(1);
    if (existing[0]) {
      console.error(`[seed] admin ${email} already exists — nothing to do.`);
      return;
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    await db.transaction(async (tx) => {
      const [employee] = await tx
        .insert(employees)
        .values({
          employeeCode: 'SCX-0001',
          firstName: 'Admin',
          lastName: '',
          displayName: 'Admin',
          workEmail: email,
          employmentType: 'full_time',
          status: 'active',
          dateOfJoining: new Date().toISOString().slice(0, 10),
          workLocation: 'india',
        })
        .returning();
      if (!employee) throw new Error('failed to insert seed employee');

      await tx.insert(userAccounts).values({
        employeeId: employee.id,
        role: 'admin',
        passwordHash,
      });
    });

    const counts = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(userAccounts);
    console.error(`[seed] created admin ${email} (accounts now: ${counts[0]?.count ?? 0}).`);
    console.error('[seed] IMPORTANT: change this password after first login.');
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
