import { Reflector } from '@nestjs/core';

/** Customise how {@link AuditInterceptor} labels a mutating admin handler. */
export interface AuditMeta {
  /** Action name, e.g. 'admin.user.suspend'. Defaults to `METHOD route`. */
  action?: string;
  /** Target type for the audit `target` (`type:id`), e.g. 'admin_user'. */
  targetType?: string;
  /** Route param holding the target id, e.g. 'userId'. */
  targetParam?: string;
}

/** Label a handler for the audit interceptor. */
export const Audit = Reflector.createDecorator<AuditMeta>();

/**
 * Opt a mutating admin handler OUT of interceptor auditing — use when the service records its own
 * before/after audit row inside the state-changing transaction (AuditService.recordTx).
 */
export const SkipAudit = Reflector.createDecorator<boolean>({ transform: (value) => value ?? true });
