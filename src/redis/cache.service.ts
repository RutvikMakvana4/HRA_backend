import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../common/config/app-config.service';
import { REDIS } from '../common/constants';

/**
 * Cache helper. EVERY key has a TTL, is namespaced, and is VERSIONED (CLAUDE.md §7): bumping
 * `CACHE_VERSION` instantly invalidates every cached key so a bad cache can be flushed without
 * a manual sweep. Redis is never the source of truth — treat misses as normal.
 */
@Injectable()
export class CacheService {
  private readonly version: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: AppConfigService,
  ) {
    this.version = config.get('CACHE_VERSION');
  }

  /** Build a versioned, namespaced key: `cache:<version>:<namespace>:<id>`. */
  key(namespace: string, id: string): string {
    return `cache:${this.version}:${namespace}:${id}`;
  }

  async get<T>(namespace: string, id: string): Promise<T | null> {
    const raw = await this.redis.get(this.key(namespace, id));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  /** Set a value with a MANDATORY ttl (seconds). */
  async set<T>(namespace: string, id: string, value: T, ttlSeconds: number): Promise<void> {
    await this.redis.set(this.key(namespace, id), JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(namespace: string, id: string): Promise<void> {
    await this.redis.del(this.key(namespace, id));
  }

  /**
   * Read-through cache: return the cached value or compute it via `loader`, store it with
   * `ttlSeconds`, and return it.
   */
  async getOrSet<T>(
    namespace: string,
    id: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = await this.get<T>(namespace, id);
    if (cached !== null) {
      return cached;
    }
    const value = await loader();
    await this.set(namespace, id, value, ttlSeconds);
    return value;
  }
}
