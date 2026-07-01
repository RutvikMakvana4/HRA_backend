import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { IDEMPOTENCY_KEY_HEADER } from '../constants';
import { AppError, ErrorCode } from '../errors/app-error';
import { HttpStatus } from '@nestjs/common';

/**
 * Idempotency interceptor — STUB (Phase 1).
 *
 * Contract once implemented (CLAUDE.md §6 / §10): money-moving POSTs MUST carry an
 * `Idempotency-Key` header. The interceptor will look the key up in a persistent store
 * (inside the ledger transaction), return the prior result if the key already completed, and
 * otherwise record it so a retried request changes state exactly once.
 *
 * For now it only enforces the header on mutating requests so callers adopt it early; the
 * dedup store is wired when the wallet/ledger module ships.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  /** HTTP methods that may move money/state and therefore require a key. */
  private static readonly MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();

    if (IdempotencyInterceptor.MUTATING.has(req.method)) {
      const key = req.headers[IDEMPOTENCY_KEY_HEADER];
      if (!key) {
        throw new AppError(
          ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
          `Missing required "${IDEMPOTENCY_KEY_HEADER}" header`,
          HttpStatus.BAD_REQUEST,
        );
      }
      // TODO(phase-2): look up / persist the key in the ledger transaction.
    }

    return next.handle();
  }
}
