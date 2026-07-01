/**
 * Postgres enum types (Enums sheet of the DB Schema doc). Defined once here and reused across
 * domain table files to avoid duplication and circular imports. Re-exported via ./index so
 * drizzle-kit emits `CREATE TYPE` for each.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

export const actorType = pgEnum('actor_type', ['admin', 'user', 'system']);
