import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Coarse role gate. Reads `@Roles(...)` metadata and requires the authenticated user to hold at
 * least one of the listed roles. Runs AFTER {@link JwtAuthGuard} (which sets `req.user`).
 *
 * Fine-grained "self | manager-of | HR" checks that depend on the target record are enforced in
 * the services, not here.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Not authenticated');

    const allowed = required.some((role) => user.roles.includes(role));
    if (!allowed) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
