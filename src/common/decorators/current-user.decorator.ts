import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** The authenticated principal attached to the request by {@link AuthGuard}. */
export interface AuthenticatedUser {
  id: string;
  roles: string[];
  /** Resolved permission codes (operators); empty for players. */
  permissions: string[];
  /** Operator scope restriction; null = unrestricted (and for players). */
  scope: null;
  /** Session id (matches the Redis `session:<sid>` flag); used to revoke on logout. */
  sid: string;
  /** Whether this is a player or an operator principal. */
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
