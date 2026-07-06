/**
 * Dependency-injection tokens shared across the kernel.
 * Always inject infrastructure through these tokens — never import a singleton ad hoc
 */
export const DRIZZLE = Symbol('DRIZZLE');
export const PG_POOL = Symbol('PG_POOL');
export const REDIS = Symbol('REDIS');
export const SQS_CLIENT = Symbol('SQS_CLIENT');
export const S3_CLIENT = Symbol('S3_CLIENT');

/** Header carrying the client-supplied request correlation id. */
export const CORRELATION_ID_HEADER = 'x-request-id';

/** Header required on money-moving POSTs */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * Scalixity runs a 6-day work week — Sunday (0) is the only weekly off.
 * Every working-day computation (leave, attendance) must use this, so a
 * future policy change (or per-location weeks) happens in one place.
 */
export const WEEKLY_OFF_DAYS: ReadonlySet<number> = new Set([0]);
