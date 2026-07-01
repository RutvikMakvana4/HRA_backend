/**
 * Admin / operator domain schema: admin_users, roles, permissions, role_permissions,
 * admin_user_roles, audit_log, plus operator config (config_settings) and support
 * (support_tickets, ticket_messages).
 *
 * audit_log is the immutable record of every consequential action (CLAUDE.md §6/§11). Polymorphic
 * id columns (actor_id, target_id, author_id) carry no hard FK.
 */
import { index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { bigIdentityPk, createdAt } from './_conventions';
import { actorType } from './enums';

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigIdentityPk(),
    actorType: actorType('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => ({
    actorTimeIdx: index('ix_audit_actor_time').on(t.actorId, t.createdAt),
    targetIdx: index('ix_audit_target').on(t.targetType, t.targetId),
    // Audit-search filters by action over a time range.
    actionTimeIdx: index('ix_audit_action_time').on(t.action, t.createdAt),
  }),
);

export type AuditLog = typeof auditLog.$inferSelect;
