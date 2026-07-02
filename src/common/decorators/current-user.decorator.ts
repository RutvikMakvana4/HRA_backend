import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The authenticated principal attached to the request by the JwtAuthGuard. */
export interface AuthenticatedUser {
  /** The employee id (JWT `sub`). Employee endpoints treat this as the person's id. */
  id: string;
  /** The login-account id (`user_accounts.id`) — used for session/password operations. */
  uid: string;
  /** Primary role(s) held (currently exactly one). */
  roles: string[];
  /** Resolved permission codes (reserved; empty for now). */
  permissions: string[];
  /** Scope restriction; null = unrestricted. */
  scope: null;
  /** Session id (matches the Redis `session:<sid>` flag); used to revoke on logout. */
  sid: string;
  /** Audit actor bucket: 'admin' for admin/super_admin, else 'user'. */
  type: 'user' | 'admin';
}

/**
 * Injects the authenticated user (set by {@link AuthGuard}) into a handler parameter.
 *
 *   handler(@CurrentUser() user: AuthenticatedUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    return request.user;
  },
);
