/**
 * Auth / RBAC schema (PRD Phase 1 Foundation).
 *
 *  - `user_accounts` — login credentials + primary role, 1:1 with an employee. Employees ARE the
 *    users; this table holds only what the person record must not (password hash, role, status).
 *  - `auth_sessions`  — one row per issued refresh token (rotating). The row id IS the session id
 *    (`sid`) carried in the access token and mirrored to a Redis `session:<sid>` flag for instant
 *    revocation. Refresh tokens are stored hashed, never in plaintext.
 */
import { boolean, index, inet, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_conventions';
import { accountStatus, userRole } from './enums';
import { employees } from './employees';

export const userAccounts = pgTable(
  'user_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .unique()
      .references(() => employees.id, { onDelete: 'cascade' }),
    role: userRole('role').notNull().default('employee'),
    passwordHash: text('password_hash').notNull(),
    status: accountStatus('status').notNull().default('active'),
    /**
     * Capability codes granted to this account, independent of its role — see
     * `src/modules/auth/permissions.ts`. Carried in the access token, so a change here revokes
     * the account's sessions (AdminUsersService.setPermissions) rather than waiting for a refresh.
     */
    permissions: text('permissions').array().notNull().default([]),
    /** True while the password is an HR-issued temporary one — forces a change on first login. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => ({
    roleIdx: index('ix_user_accounts_role').on(t.role),
  }),
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    /** The session id (`sid`). */
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    /** SHA-256 of the refresh token secret. */
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /** Set on rotation — points at the session that superseded this one (reuse detection). */
    replacedBySessionId: uuid('replaced_by_session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('ix_auth_sessions_user').on(t.userId),
  }),
);

export type UserAccount = typeof userAccounts.$inferSelect;
export type NewUserAccount = typeof userAccounts.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
