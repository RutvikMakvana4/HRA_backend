import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AppConfigModule } from './common/config/config.module';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { DbModule } from './db/db.module';
import { RedisModule } from './redis/redis.module';
import { SqsModule } from './sqs/sqs.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { StorageModule } from './modules/storage/storage.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { LeaveModule } from './modules/leave/leave.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { TimesheetsModule } from './modules/timesheets/timesheets.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { EssModule } from './modules/ess/ess.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { BodyCaseMiddleware } from './common/middleware/body-case.middleware';
import { CORRELATION_ID_HEADER } from './common/constants';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { ResponseCaseInterceptor } from './common/interceptors/response-case.interceptor';

/**
 * Root application module (API entrypoint). Wires:
 *  - global infrastructure: config (zod-validated), DB (Drizzle), Redis, SQS;
 *  - structured pino logging with a per-request correlation id;
 *  - the kernel (CommonModule); and every feature module.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        // Reuse the correlation id set by CorrelationIdMiddleware so logs, requests, and
        genReqId: (req: IncomingMessage, res: ServerResponse): string => {
          const existing = req.headers[CORRELATION_ID_HEADER];
          const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
          res.setHeader(CORRELATION_ID_HEADER, id);
          return id;
        },
        customProps: (req: IncomingMessage) => ({
          correlationId: req.headers[CORRELATION_ID_HEADER],
        }),
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.password'],
      },
    }),

    // Infrastructure (global)
    DbModule,
    RedisModule,
    SqsModule,

    // Kernel
    CommonModule,
    AuthModule,
    StorageModule,

    // Always-on
    HealthModule,

    // Module 1 — Employee Core + Documents
    EmployeesModule,
    DepartmentsModule,
    DocumentsModule,

    // Module 2/3/4 — Leave, Attendance, Employee Self-Service
    LeaveModule,
    AttendanceModule,
    EssModule,

    // Module 5 — Onboarding / Offboarding
    OnboardingModule,

    // Module 7 — Timesheets + Project Allocation (foundation for Module 6 project tagging)
    TimesheetsModule,

    // Module 6 — Expenses & Reimbursement
    ExpensesModule,
  ],
  providers: [
    // HTTP-only global enhancers (kept out of CommonModule so the worker doesn't load them):
    // the error envelope filter, and the audit interceptor for mutating /v1/admin requests (§6/§11).
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Response case interceptor is registered FIRST so it is outermost: its snake_case mapping runs
    // last, after the audit interceptor has recorded the (camelCase) post-state.
    { provide: APP_INTERCEPTOR, useClass: ResponseCaseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
    // Rewrite snake_case JSON request bodies to camelCase before validation/handlers.
    consumer.apply(BodyCaseMiddleware).forRoutes('*');
  }
}
