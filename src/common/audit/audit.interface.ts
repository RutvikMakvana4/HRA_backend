import type { Tx } from '../uow/unit-of-work';

/** A single audit-log entry (CLAUDE.md §1.6 / §11). */
export interface AuditEntry {
  /** Who performed the action: admin, user, or system. Defaults to system if omitted. */
  actorType?: 'admin' | 'user' | 'system';
  /** Who performed the action (user/admin/system id). Null for system actions. */
  actorId?: string | null;
  /** What happened, e.g. 'wallet.withdraw', 'admin.user.suspend'. */
  action: string;
  /** What was acted upon, as `type:id` (e.g. 'admin_user:123', 'bet:456') or a bare type. */
  target: string;
  /** State before the change (redact secrets/PII). */
  before?: Record<string, unknown>;
  /** State after the change. */
  after?: Record<string, unknown>;
  /** Originating IP, when available. */
  ip?: string;
  /** Originating user-agent, when available. */
  userAgent?: string;
  correlationId?: string;
}

/**
 * AuditService — EVERY money and admin action is audited (Golden Rule 6). When the action is
 * part of a money transaction, the audit row is written with the same `tx` so it commits
 * atomically; standalone admin actions may use `record`.
 */
export interface AuditService {
  /** Write an audit entry within an existing transaction. */
  recordTx(tx: Tx, entry: AuditEntry): Promise<void>;
  /** Write an audit entry in its own transaction. */
  record(entry: AuditEntry): Promise<void>;
}

/** DI token for the {@link AuditService} implementation. */
export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');
