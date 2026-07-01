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
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { CORRELATION_ID_HEADER } from './common/constants';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

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

    // Always-on
    HealthModule,
  ],
  providers: [
    // HTTP-only global enhancers (kept out of CommonModule so the worker doesn't load them):
    // the error envelope filter, and the audit interceptor for mutating /v1/admin requests (§6/§11).
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
