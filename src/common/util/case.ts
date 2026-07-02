/**
 * Case conversion at the HTTP boundary. The frontend (Next.js ESS) speaks snake_case for every
 * field (`employee_id`, `leave_type_id`, `check_in`, …) while the backend/Drizzle layer speaks
 * camelCase. These helpers bridge the two: responses are snake_cased on the way out and request
 * bodies are camelCased on the way in, so services and DTOs stay idiomatic TypeScript.
 *
 * Only plain objects and arrays are recursed. `Date`, `Buffer`, and other class instances are
 * passed through untouched (a `Date` serialises to an ISO string via its own `toJSON`).
 */

const camelToSnakeKey = (key: string): string =>
  key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/__+/g, '_');

const snakeToCamelKey = (key: string): string =>
  key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** True for `{}`-style objects we should recurse into (not Date/Buffer/etc.). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function transformKeys(value: unknown, mapKey: (k: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => transformKeys(v, mapKey));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[mapKey(k)] = transformKeys(v, mapKey);
    return out;
  }
  // `bigint` columns (audit_log.id, money minor-units) come off Drizzle as JS BigInt, which
  // JSON.stringify cannot serialise. Emit them as strings so precision is preserved end-to-end.
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/** Deep camelCase → snake_case (response bodies). */
export const toSnakeCase = (value: unknown): unknown => transformKeys(value, camelToSnakeKey);

/** Deep snake_case → camelCase (request bodies). */
export const toCamelCase = (value: unknown): unknown => transformKeys(value, snakeToCamelKey);
