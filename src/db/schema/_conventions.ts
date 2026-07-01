import { bigint, customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Shared column helpers enforcing CLAUDE.md §5.1 schema conventions. Reuse these in every
 * table definition so the rules are applied uniformly.
 *
 *  - Money is `bigint` in minor units — NEVER `numeric`/`real`/`double` (Golden Rule 1).
 *  - Timestamps are `withTimezone`.
 *  - Index every column used in WHERE / JOIN / ORDER BY (declare indexes in the table body).
 */

/** A money column: bigint minor units. Pair with a currency reference for scale. */
export const money = (name: string) => bigint(name, { mode: 'bigint' });

/**
 * Case-insensitive text. Requires the `citext` extension (the first migration enables it).
 * Used for login identifiers (emails) so uniqueness is case-insensitive.
 */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** A `uuid` primary key defaulting to `gen_random_uuid()` (Postgres-native on PG13+). */
export const uuidPk = () => uuid('id').primaryKey().defaultRandom();

/** A `bigint` identity primary key for high-volume tables (ledger entries, audit, history). */
export const bigIdentityPk = () =>
  bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity();

/** A FK column referencing a `bigint` identity PK (e.g. ledger_transactions.id). */
export const bigintRef = (name: string) => bigint(name, { mode: 'bigint' });

/** `created_at` — timezone-aware, defaults to now. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

/** `updated_at` — timezone-aware, defaults to now (bump in app logic / triggers on write). */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

/** Standard audit timestamps spread into a table definition. */
export const timestamps = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
};
