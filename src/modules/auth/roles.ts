import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * Primary roles (PRD §2) — exactly one per account. Capability ranking:
 *   employee (self) < manager (self + direct/indirect reports)
 *   < admin (org-wide) < super_admin (admin + role management, system settings, audit log).
 *
 * The role travels in the access-token `roles` claim. Manager's *team* scope is still resolved
 * from the org chart (relationship checks in services); the role gates team-wide screens.
 */
export const Role = {
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

/** Order used for "at least" comparisons. Higher = more capability. */
const RANK: Record<Role, number> = {
  [Role.EMPLOYEE]: 0,
  [Role.MANAGER]: 1,
  [Role.ADMIN]: 2,
  [Role.SUPER_ADMIN]: 3,
};

/** The highest-ranked role the principal holds (defaults to employee). */
export function topRole(user: Pick<AuthenticatedUser, 'roles'>): Role {
  let best: Role = Role.EMPLOYEE;
  for (const r of user.roles) {
    if (r in RANK && RANK[r as Role] > RANK[best]) best = r as Role;
  }
  return best;
}

/** Org-wide capability (the PRD's "HR / Admin"). Admin or Super Admin. */
export function isAdminOrAbove(user: Pick<AuthenticatedUser, 'roles'>): boolean {
  return RANK[topRole(user)] >= RANK[Role.ADMIN];
}

/** Holds the Manager role or higher (team-wide screens). */
export function isManagerOrAbove(user: Pick<AuthenticatedUser, 'roles'>): boolean {
  return RANK[topRole(user)] >= RANK[Role.MANAGER];
}

export function isSuperAdmin(user: Pick<AuthenticatedUser, 'roles'>): boolean {
  return user.roles.includes(Role.SUPER_ADMIN);
}

/** Audit actor bucket for a role: admins are 'admin', everyone else 'user'. */
export function actorTypeForRole(role: Role): 'admin' | 'user' {
  return RANK[role] >= RANK[Role.ADMIN] ? 'admin' : 'user';
}
