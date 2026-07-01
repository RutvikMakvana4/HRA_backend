import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';

interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}

/**
 * Liveness endpoint. Unversioned and unguarded so load balancers / ECS health checks can hit
 * it. Deeper readiness checks (DB/Redis/SQS connectivity) can be added later.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'hra-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
