import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';
import { AUDIT_SERVICE, type AuditService } from '../audit/audit.interface';
import { Audit, type AuditMeta, SkipAudit } from '../decorators/audit.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator.ts';

const REDACT = new Set([
  'password',
  'passwordHash',
  'token',
  'tempToken',
  'accessToken',
  'refreshToken',
  'code',
  'secret',
  'mfaSecret',
  'recoveryCodes',
  'providerToken',
]);

/**
 * AuditInterceptor (§6/§11). Guarantees that EVERY mutating admin request is appended to
 * `audit_log` — actor, action, target, ip, and the post-state (response) + the request body. A
 * service that needs an atomic before/after snapshot writes it via `AuditService.recordTx` inside
 * the state-changing transaction and opts the handler out with `@SkipAudit()` (no duplicate row).
 * Auditing here is best-effort — the action already committed — so a failure is logged, not raised.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private static readonly MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

    const isAdmin = req.path.startsWith('/v1/admin');
    const isMutating = AuditInterceptor.MUTATING.has(req.method);
    const skip = this.reflector.getAllAndOverride(SkipAudit, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isAdmin || !isMutating || skip) {
      return next.handle();
    }

    const meta = this.reflector.getAllAndOverride(Audit, [
      context.getHandler(),
      context.getClass(),
    ]);
    return next.handle().pipe(
      tap((body) => {
        void this.write(req, meta, body);
      }),
    );
  }

  private async write(
    req: Request & { user?: AuthenticatedUser },
    meta: AuditMeta | undefined,
    responseBody: unknown,
  ): Promise<void> {
    try {
      const routePath = (req.route as { path?: string } | undefined)?.path ?? req.path;
      const action = meta?.action ?? `${req.method} ${routePath}`;
      const target =
        meta?.targetType && meta.targetParam
          ? `${meta.targetType}:${String(req.params[meta.targetParam] ?? '')}`
          : routePath;

      await this.audit.record({
        actorType: req.user?.type === 'user' ? 'user' : 'admin',
        actorId: req.user?.id ?? null,
        action,
        target,
        // Request body = the intended change; response = the post-state.
        before: this.redact(req.body),
        after: this.redact(responseBody),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } catch (err) {
      this.logger.error({ err, path: req.path }, 'Failed to write audit log');
    }
  }

  /** Shallow-redact sensitive fields so secrets never land in audit_log. */
  private redact(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.has(k) ? '[redacted]' : v;
    }
    return out;
  }
}
