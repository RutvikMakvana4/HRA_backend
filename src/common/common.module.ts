import { Global, Module } from '@nestjs/common';
import { AUDIT_SERVICE } from './audit/audit.interface';
import { AuditServiceImpl } from './audit/audit.service';

/**
 * The kernel (CLAUDE.md §3): shared building blocks every module reuses. Global so guards,
 * the ledger, the unit-of-work helper, and the outbox/audit services are injectable anywhere.
 *
 * Holds only injectable building blocks usable by BOTH the API and the standalone worker. The
 * HTTP-only global enhancers (exception filter, audit interceptor) are registered in AppModule, so
 * the worker (a non-HTTP application context) never tries to instantiate them.
 *
 * Depends on the global DbModule / RedisModule / SqsModule (imported once in AppModule) for the
 * DRIZZLE / REDIS / SQS providers.
 */
@Global()
@Module({
  providers: [{ provide: AUDIT_SERVICE, useClass: AuditServiceImpl }],
  exports: [AUDIT_SERVICE],
})
export class CommonModule {}
