import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './common/config/app-config.service';

/**
 * API entrypoint. The global exception filter is provided via APP_FILTER in CommonModule.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  // Route pino through Nest's logger so framework logs are structured too.
  app.useLogger(app.get(Logger));

  // helmet, with CSP relaxed only enough for the Swagger UI assets to load.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          scriptSrc: [`'self'`, `'unsafe-inline'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:'],
        },
      },
    }),
  );

  // URI versioning: /v1/... player, /v1/admin/... admin, /v1/webhooks/...
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'v',
  });

  app.useGlobalPipes(new ZodValidationPipe());

  // OpenAPI / Swagger. zod DTOs feed the schema via nestjs-zod; `cleanupOpenApiDoc` finalises it.
  // UI at /docs, JSON at /docs/json.
  const openApiConfig = new DocumentBuilder()
    .setTitle('HRA Backend API')
    .setDescription(
      "Real-money gaming super app — Pick'em (real-money) + Sportsbook (sweepstakes).",
    )
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document), {
    jsonDocumentUrl: 'docs/json',
    swaggerOptions: { persistAuthorization: true },
  });

  app.enableShutdownHooks();

  const config = app.get(AppConfigService);

  // CORS for the admin dashboard (browser client). Exact-origin allowlist from CORS_ORIGINS;
  // credentials enabled for future cookie-based refresh. Custom headers the client sends must be
  // allowed for the preflight to pass.
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  });

  const port = config.get('PORT');
  await app.listen(port);

  app.get(Logger).log(`API listening on :${port}`, 'Bootstrap');
}

void bootstrap();
