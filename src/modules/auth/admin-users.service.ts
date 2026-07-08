import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { employees, userAccounts, type UserAccount } from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode, pgErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { EmployeesService } from '../employees/employees.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { isSuperAdmin, Role } from './roles';
import type {
  CreateUserAccountDto,
  ResetPasswordDto,
  SetRoleDto,
  SetStatusDto,
} from './dto/admin-users.dto';

/** A user account without its password hash — safe to return over the API. */
type SafeAccount = Omit<UserAccount, 'passwordHash'>;

/**
 * RBAC administration (PRD §2 — Super Admin "user role management"). Creates login accounts for
 * employees, assigns/changes roles, enables/disables accounts, and resets passwords. Role and
 * status changes revoke the target's sessions so the new state applies immediately.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly employeesService: EmployeesService,
  ) {}

  async createAccount(dto: CreateUserAccountDto, actor: AuthenticatedUser): Promise<SafeAccount> {
    // HR/Admin onboards regular staff; only a Super Admin can mint admin-level
    // accounts (otherwise an admin could escalate their own privileges).
    this.assertCanTouchRole(actor, dto.role);
    await this.employeesService.ensureExists(dto.employeeId);
    const passwordHash = await this.passwords.hash(dto.password);

    let row: UserAccount | undefined;
    try {
      [row] = await this.db
        .insert(userAccounts)
        .values({
          employeeId: dto.employeeId,
          role: dto.role,
          passwordHash,
          // HR-issued temporary password — force a change on first login.
          mustChangePassword: true,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning();
    } catch (err) {
      if (pgErrorCode(err) === '23505') {
        throw new AppError(ErrorCode.CONFLICT, 'This employee already has an account', HttpStatus.CONFLICT);
      }
      throw err;
    }
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create account');

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'admin.user.create',
      target: `user_account:${row.id}`,
      after: { employeeId: row.employeeId, role: row.role, status: row.status },
    });
    return this.sanitize(row);
  }

  /** All accounts joined with the person's identity. */
  async list(): Promise<Array<SafeAccount & { workEmail: string; displayName: string | null }>> {
    const rows = await this.db
      .select({
        account: userAccounts,
        workEmail: employees.workEmail,
        firstName: employees.firstName,
        lastName: employees.lastName,
        displayName: employees.displayName,
      })
      .from(userAccounts)
      .innerJoin(employees, eq(userAccounts.employeeId, employees.id))
      .orderBy(desc(userAccounts.createdAt));

    return rows.map((r) => ({
      ...this.sanitize(r.account),
      workEmail: r.workEmail,
      displayName: r.displayName ?? `${r.firstName} ${r.lastName}`,
    }));
  }

  async setRole(accountId: string, dto: SetRoleDto, actor: AuthenticatedUser): Promise<SafeAccount> {
    const before = await this.getOrThrow(accountId);
    const row = await this.applyChange(accountId, { role: dto.role }, actor);
    await this.sessions.revokeAllForUser(accountId); // force re-auth so the new role takes effect
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'admin.user.set_role',
      target: `user_account:${accountId}`,
      before: { role: before.role },
      after: { role: row.role },
    });
    return this.sanitize(row);
  }

  async setStatus(
    accountId: string,
    dto: SetStatusDto,
    actor: AuthenticatedUser,
  ): Promise<SafeAccount> {
    const before = await this.getOrThrow(accountId);
    const row = await this.applyChange(accountId, { status: dto.status }, actor);
    if (dto.status === 'disabled') await this.sessions.revokeAllForUser(accountId);
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'admin.user.set_status',
      target: `user_account:${accountId}`,
      before: { status: before.status },
      after: { status: row.status },
    });
    return this.sanitize(row);
  }

  async resetPassword(
    accountId: string,
    dto: ResetPasswordDto,
    actor: AuthenticatedUser,
  ): Promise<{ success: true }> {
    const target = await this.getOrThrow(accountId);
    // An admin must not be able to take over admin/super-admin accounts.
    this.assertCanTouchRole(actor, target.role);
    const passwordHash = await this.passwords.hash(dto.newPassword);
    // Reset issues a temporary password, so force a change on next login.
    await this.applyChange(accountId, { passwordHash, mustChangePassword: true }, actor);
    await this.sessions.revokeAllForUser(accountId);
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'admin.user.reset_password',
      target: `user_account:${accountId}`,
    });
    return { success: true };
  }

  // ── internals ──

  /** Non-super-admins may only manage employee/manager accounts. */
  private assertCanTouchRole(actor: AuthenticatedUser, role: Role): void {
    if (isSuperAdmin(actor)) return;
    if (role === Role.ADMIN || role === Role.SUPER_ADMIN) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only a Super Admin can manage admin-level accounts',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async applyChange(
    accountId: string,
    patch: Partial<Pick<UserAccount, 'role' | 'status' | 'passwordHash' | 'mustChangePassword'>>,
    actor: AuthenticatedUser,
  ): Promise<UserAccount> {
    const [row] = await this.db
      .update(userAccounts)
      .set({ ...patch, updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(userAccounts.id, accountId))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update account');
    return row;
  }

  private async getOrThrow(accountId: string): Promise<UserAccount> {
    const row = await this.db.query.userAccounts.findFirst({
      where: eq(userAccounts.id, accountId),
    });
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Account not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private sanitize(account: UserAccount): SafeAccount {
    const { passwordHash: _omit, ...safe } = account;
    return safe;
  }
}
