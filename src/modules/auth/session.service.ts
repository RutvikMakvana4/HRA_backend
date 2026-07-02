import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Database } from '../../db/client';
import { authSessions, type AuthSession } from '../../db/schema';
import { DRIZZLE, REDIS } from '../../common/constants';

/** Redis key for the liveness flag of a session. Its existence == session is valid. */
export function sessionKey(sid: string): string {
  return `session:${sid}`;
}

export interface OpenSessionInput {
  sid: string;
  userId: string;
  refreshTokenHash: string;
  ttlSeconds: number;
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Session store backing refresh-token rotation. Each session is a DB row (`auth_sessions`, the id
 * is the `sid`) plus a Redis `session:<sid>` liveness flag the access-token guard checks. Deleting
 * the flag revokes access instantly; the DB row is the durable, auditable record.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Persist a new session and light its Redis liveness flag. */
  async open(input: OpenSessionInput): Promise<void> {
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    await this.db.insert(authSessions).values({
      id: input.sid,
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      expiresAt,
    });
    await this.redis.set(sessionKey(input.sid), input.userId, 'EX', input.ttlSeconds);
  }

  find(sid: string): Promise<AuthSession | undefined> {
    return this.db.query.authSessions.findFirst({ where: eq(authSessions.id, sid) });
  }

  /** Revoke one session (DB + Redis). `replacedBy` links the successor on rotation. */
  async revoke(sid: string, replacedBy?: string): Promise<void> {
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date(), replacedBySessionId: replacedBy ?? null })
      .where(and(eq(authSessions.id, sid), isNull(authSessions.revokedAt)));
    await this.redis.del(sessionKey(sid));
  }

  /** Revoke every live session for an account (used on refresh-token reuse / disable / pw change). */
  async revokeAllForUser(userId: string): Promise<void> {
    const rows = await this.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
    if (rows.length === 0) return;
    await this.db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
    await Promise.all(rows.map((r) => this.redis.del(sessionKey(r.id))));
  }
}
