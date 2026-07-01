import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from '../constants';
import type { Database } from '../../db/client';
import { auditLog } from '../../db/schema';
import type { AuditEntry, AuditService } from './audit.interface';
import type { Tx } from '../uow/unit-of-work';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AuditService — appends to `audit_log` (actor, action, target, before/after, ip). Every money
 * and admin action is audited (Golden Rule 6 / §11). Use `recordTx` to commit the audit row in
 * the same transaction as a state change; `record` opens its own.
 */
@Injectable()
export class AuditServiceImpl implements AuditService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async recordTx(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLog).values(this.toRow(entry));
  }

  async record(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLog).values(this.toRow(entry));
  }

  private toRow(entry: AuditEntry) {
    const [targetType, targetId] = this.splitTarget(entry.target);
    return {
      actorType: entry.actorType ?? 'system',
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType,
      targetId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    };
  }

  /** Parse `type:id`; `targetId` is kept only when it is a UUID (the column is `uuid`). */
  private splitTarget(target: string): [string, string | null] {
    const idx = target.indexOf(':');
    if (idx === -1) return [target, null];
    const type = target.slice(0, idx);
    const id = target.slice(idx + 1);
    return [type, UUID_RE.test(id) ? id : null];
  }
}
