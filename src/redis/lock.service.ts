import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { REDIS } from '../common/constants';

/** A held lock. Pass it back to {@link LockService.release} to release safely. */
export interface Lock {
  key: string;
  /** Fencing token — only the holder of this token may release the lock. */
  token: string;
}

/**
 * Distributed lock helper. EVERY lock has an expiry/lease so a dead worker can't hold it
 * forever (CLAUDE.md §7). Release is fenced by a per-acquire token (Lua compare-and-delete)
 * so a process can never release a lock it no longer owns after its lease expired.
 *
 * Used for single-leader cron ticks (§9) and per-entity serialization in workers (§8).
 */
@Injectable()
export class LockService {
  private readonly logger = new Logger(LockService.name);

  /** Lua: delete the key only if its value matches our fencing token. */
  private static readonly RELEASE_SCRIPT = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Try to acquire `key` for `ttlMs`. Returns the {@link Lock} on success, or `null` if it is
   * already held. Never blocks — callers decide whether to retry.
   */
  async acquire(key: string, ttlMs: number): Promise<Lock | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    if (result !== 'OK') {
      return null;
    }
    return { key, token };
  }

  /** Release a lock, but only if we still hold it (fencing token must match). */
  async release(lock: Lock): Promise<boolean> {
    const deleted = (await this.redis.eval(
      LockService.RELEASE_SCRIPT,
      1,
      lock.key,
      lock.token,
    )) as number;
    return deleted === 1;
  }

  /**
   * Acquire, run `fn`, and always release. Returns `null` (without running `fn`) if the lock
   * could not be acquired.
   */
  async withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
    const lock = await this.acquire(key, ttlMs);
    if (!lock) {
      this.logger.debug(`lock busy: ${key}`);
      return null;
    }
    try {
      return await fn();
    } finally {
      await this.release(lock);
    }
  }
}
