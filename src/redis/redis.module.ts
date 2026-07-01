import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../common/config/app-config.service';
import { REDIS } from '../common/constants';
import { CacheService } from './cache.service';
import { LockService } from './lock.service';

/**
 * Global Redis module. Provides a single ioredis connection via the `REDIS` token plus the
 * {@link LockService} and {@link CacheService} helpers.
 *
 * Redis is for cache / locks / rate-limiting / sessions / pub-sub ONLY — never the source of
 * truth for money or anything that must survive a restart (CLAUDE.md §7).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis =>
        new Redis(config.get('REDIS_URL'), {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
        }),
    },
    LockService,
    CacheService,
  ],
  exports: [REDIS, LockService, CacheService],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
