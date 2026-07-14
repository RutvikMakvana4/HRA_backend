/**
 * Permission codes — the single source of truth.
 *
 * A permission is a capability granted to an *account*, independently of its role. Roles answer
 * "how senior is this person"; permissions answer "may they do this specific thing".
 *
 * `finance` is the only code today. A second one costs one line here — the column is a text[] and
 * the DTO validates against PERMISSION_CODES, so nothing else has to change.
 */
export const Permission = {
  FINANCE: 'finance',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/** Every valid code. The grant DTO validates against this, so an unknown code is a 400. */
export const PERMISSION_CODES = Object.values(Permission) as [Permission, ...Permission[]];
