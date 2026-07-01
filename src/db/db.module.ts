import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfigService } from '../common/config/app-config.service';
import { DRIZZLE, PG_POOL } from '../common/constants';
import { buildDrizzle, createPool, type Database } from './client';

/**
 * Global database module. Builds one pg pool from validated config and a Drizzle client over
 * it, exposed via the `PG_POOL` and `DRIZZLE` tokens (CLAUDE.md §4 — inject, never import the
 * singleton ad hoc). Closes the pool on shutdown.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Pool =>
        createPool({
          connectionString: config.get('DATABASE_URL'),
          max: config.get('DATABASE_POOL_MAX'),
          ssl: config.get('DATABASE_SSL'),
        }),
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database => buildDrizzle(pool),
    },
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
