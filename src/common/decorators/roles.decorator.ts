import { Reflector } from '@nestjs/core';
import type { Role } from '../../modules/auth/roles';

/**
 * Require the caller to hold at least one of the listed primary roles. Read by {@link RolesGuard}.
 *
 *   @Roles([Role.ADMIN, Role.SUPER_ADMIN])
 *   @Post()
 *   create() { ... }
 *
 * Absence of the decorator means "any authenticated user" (the JwtAuthGuard still applies).
 */
export const Roles = Reflector.createDecorator<Role[]>();
