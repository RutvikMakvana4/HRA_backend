import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable, machine-readable error codes returned to clients in the error envelope
 * `{ error: { code, message, requestId } }` (CLAUDE.md §4 / §10). Add codes here; never leak
 * internal messages or stack traces to clients.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  ELIGIBILITY_DENIED: 'ELIGIBILITY_DENIED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL: 'INTERNAL',
  KYC_REQUIRED: 'KYC_REQUIRED',
  PLAYTHROUGH_NOT_MET: 'PLAYTHROUGH_NOT_MET',
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Application error carrying a stable {@link ErrorCode}. The global exception filter renders
 * it into the error envelope. Use this (or its subclasses) instead of throwing raw strings.
 */
export class AppError extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ code, message }, status);
  }
}

export class NotImplementedError extends AppError {
  constructor(what: string) {
    super(ErrorCode.NOT_IMPLEMENTED, `${what} is not implemented yet`, HttpStatus.NOT_IMPLEMENTED);
  }
}

/**
 * Extract the Postgres error code (e.g. 23505 unique_violation) from a thrown
 * error. Drizzle wraps the pg error in `cause`, so walk the chain instead of
 * only checking the top-level `code` property.
 */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    if ('code' in current) {
      const code: unknown = (current as { code: unknown }).code;
      if (typeof code === 'string' && /^\d{5}$/.test(code)) return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
