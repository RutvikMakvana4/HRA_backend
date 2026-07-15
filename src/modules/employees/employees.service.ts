import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, getTableColumns, ilike, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client';
import { departments, employees, userAccounts, type Employee } from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode, pgErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove } from '../auth/roles';
import type { CreateEmployeeDto, UpdateEmployeeDto, UpdateMyProfileDto } from './dto/employee.dto';
import type { ListEmployeesQueryDto } from './dto/list-employees.query';

/** Sensitive payroll-hook columns kept out of audit snapshots and non-HR responses. */
const SENSITIVE_FIELDS = ['statutoryIds', 'salaryStructure', 'bankAccount'] as const;

/** Guards runaway loops when walking a (hopefully acyclic) manager chain. */
const MAX_ORG_DEPTH = 100;

export interface OrgChartNode {
  id: string;
  displayName: string;
  workEmail: string;
  designation: string | null;
  /** Reserved for a future avatar; the ESS org-chart view reads this field. */
  avatarUrl: string | null;
  reports: OrgChartNode[];
}

@Injectable()
export class EmployeesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** Create a new employee (HR/Admin). `employeeCode` + `workEmail` become immutable. */
  async create(dto: CreateEmployeeDto, actor: AuthenticatedUser): Promise<Employee> {
    if (dto.managerId) await this.assertManagerExists(dto.managerId);

    // The UI renders displayName everywhere; default it so it is never null.
    const displayName = dto.displayName ?? `${dto.firstName} ${dto.lastName}`.trim();
    // Codes are canonically upper-case, so uniqueness is effectively case-insensitive.
    const employeeCode = dto.employeeCode.toUpperCase();
    const [row] = await this.runMapped(() =>
      this.db
        .insert(employees)
        .values({ ...dto, employeeCode, displayName, createdBy: actor.id, updatedBy: actor.id })
        .returning(),
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create employee');

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'employee.create',
      target: `employee:${row.id}`,
      after: this.redact(row),
    });
    return row;
  }

  /** Whether an employee code is free. Case-insensitive: codes are stored upper-case. */
  async isEmployeeCodeAvailable(code: string): Promise<{ available: boolean }> {
    const normalized = code?.trim().toUpperCase() ?? '';
    if (!normalized) return { available: false };
    const [row] = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.employeeCode, normalized))
      .limit(1);
    return { available: !row };
  }

  /** Filtered, paginated list (HR/Admin). */
  async list(query: ListEmployeesQueryDto): Promise<{
    data: Array<Employee & { departmentName: string | null; managerName: string | null }>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const filters: SQL[] = [];
    if (query.departmentId) filters.push(eq(employees.departmentId, query.departmentId));
    if (query.status) filters.push(eq(employees.status, query.status));
    if (query.employmentType) filters.push(eq(employees.employmentType, query.employmentType));
    if (query.workLocation) filters.push(eq(employees.workLocation, query.workLocation));
    if (query.search) {
      const term = `%${query.search}%`;
      const match = or(
        ilike(employees.firstName, term),
        ilike(employees.lastName, term),
        ilike(employees.displayName, term),
        ilike(employees.employeeCode, term),
        ilike(sql`${employees.workEmail}::text`, term),
      );
      if (match) filters.push(match);
    }
    const where = filters.length ? and(...filters) : undefined;

    const countRows = await this.db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(employees)
      .where(where);
    const total = countRows[0]?.total ?? 0;

    // Joined names ride along so list screens don't need N+1 lookups.
    const managers = alias(employees, 'managers');
    const data = await this.db
      .select({
        ...getTableColumns(employees),
        departmentName: departments.name,
        managerName: sql<string | null>`coalesce(${managers.displayName}, ${managers.firstName} || ' ' || ${managers.lastName})`,
      })
      .from(employees)
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(managers, eq(employees.managerId, managers.id))
      .where(where)
      .orderBy(employees.employeeCode)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return { data, page: query.page, pageSize: query.pageSize, total };
  }

  /**
   * Fetch one employee, enforcing row-level access: self, a manager (direct or indirect) of the
   * target, or HR/Admin. Non-HR callers get sensitive payroll hooks stripped.
   */
  async findByIdForViewer(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const employee = await this.getOrThrow(id);
    const hr = isAdminOrAbove(actor);
    const isSelf = actor.id === id;
    if (!hr && !isSelf && !(await this.isManagerOf(actor.id, id))) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view this employee', HttpStatus.FORBIDDEN);
    }
    const [account] = await this.db
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(eq(userAccounts.employeeId, id))
      .limit(1);
    const decorated = {
      ...(await this.withNames(employee)),
      hasAccount: Boolean(account),
      accountId: account?.id ?? null,
    };
    return hr ? decorated : this.redact(decorated);
  }

  /** Attach display names for the employee's department and manager. */
  private async withNames<T extends Pick<Employee, 'departmentId' | 'managerId'>>(
    row: T,
  ): Promise<T & { departmentName: string | null; managerName: string | null }> {
    const [dept] = row.departmentId
      ? await this.db
          .select({ name: departments.name })
          .from(departments)
          .where(eq(departments.id, row.departmentId))
          .limit(1)
      : [];
    const [manager] = row.managerId
      ? await this.db
          .select({
            name: sql<string>`coalesce(${employees.displayName}, ${employees.firstName} || ' ' || ${employees.lastName})`,
          })
          .from(employees)
          .where(eq(employees.id, row.managerId))
          .limit(1)
      : [];
    return { ...row, departmentName: dept?.name ?? null, managerName: manager?.name ?? null };
  }

  /** HR/Admin partial update. Immutable identity fields are absent from the DTO by construction. */
  async updateByHr(
    id: string,
    dto: UpdateEmployeeDto,
    actor: AuthenticatedUser,
  ): Promise<Employee> {
    const before = await this.getOrThrow(id);
    if (dto.managerId !== undefined && dto.managerId !== null) {
      await this.assertNoCycle(id, dto.managerId);
    }
    // Keep displayName in step with a name change unless the caller set it explicitly.
    const patch: UpdateEmployeeDto & { displayName?: string } = { ...dto };
    if ((dto.firstName || dto.lastName) && !dto.displayName) {
      patch.displayName = `${dto.firstName ?? before.firstName} ${dto.lastName ?? before.lastName}`.trim();
    }
    return this.applyUpdate(id, { ...patch }, before, actor, 'employee.update');
  }

  /** Self-service update of the narrow ESS-editable subset on the caller's own record. */
  async updateMyProfile(
    actor: AuthenticatedUser,
    dto: UpdateMyProfileDto,
  ): Promise<Employee> {
    const before = await this.getOrThrow(actor.id);
    return this.applyUpdate(actor.id, { ...dto }, before, actor, 'employee.self_update');
  }

  /** Soft-exit (PRD §4 — deletes are soft). Sets status → exited and stamps the exit date. */
  async deactivate(id: string, actor: AuthenticatedUser): Promise<Employee> {
    const before = await this.getOrThrow(id);
    if (before.status === 'exited') {
      throw new AppError(ErrorCode.CONFLICT, 'Employee is already exited', HttpStatus.CONFLICT);
    }
    const today = new Date().toISOString().slice(0, 10);
    const [row] = await this.db
      .update(employees)
      .set({ status: 'exited', dateOfExit: today, updatedBy: actor.id, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to deactivate employee');

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'employee.deactivate',
      target: `employee:${id}`,
      before: this.redact(before),
      after: this.redact(row),
    });
    return row;
  }

  /**
   * The employee-id set a scoped read may return, decided by ROLE — the IDOR guard.
   * me   → the caller only.
   * team → the caller's direct reports only (empty for a plain employee).
   * all  → every employee, but only for admin+ (else 403).
   * The `scope` query param never grants access; this re-derives the set from the role.
   */
  async scopeEmployeeIds(scope: 'me' | 'team' | 'all', actor: AuthenticatedUser): Promise<string[]> {
    if (scope === 'me') return [actor.id];
    if (scope === 'all') {
      if (!isAdminOrAbove(actor)) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view org-wide records', HttpStatus.FORBIDDEN);
      }
      const rows = await this.db.select({ id: employees.id }).from(employees);
      return rows.map((r) => r.id);
    }
    const rows = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.managerId, actor.id));
    return rows.map((r) => r.id);
  }

  /** Build the org tree from `manager_id` relationships. Roots are employees with no manager. */
  async orgChart(): Promise<OrgChartNode[]> {
    const rows = await this.db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        displayName: employees.displayName,
        workEmail: employees.workEmail,
        designation: employees.designation,
        managerId: employees.managerId,
      })
      .from(employees)
      .where(sql`${employees.status} <> 'exited'`);

    const nodes = new Map<string, OrgChartNode>();
    for (const r of rows) {
      nodes.set(r.id, {
        id: r.id,
        displayName: r.displayName ?? `${r.firstName} ${r.lastName}`,
        workEmail: r.workEmail,
        designation: r.designation,
        avatarUrl: null,
        reports: [],
      });
    }
    const roots: OrgChartNode[] = [];
    for (const r of rows) {
      const node = nodes.get(r.id);
      if (!node) continue;
      const parent = r.managerId ? nodes.get(r.managerId) : undefined;
      if (parent) parent.reports.push(node);
      else roots.push(node);
    }
    return roots;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async applyUpdate(
    id: string,
    patch: Record<string, unknown>,
    before: Employee,
    actor: AuthenticatedUser,
    action: string,
  ): Promise<Employee> {
    if (Object.keys(patch).length === 0) return before;
    const [row] = await this.runMapped(() =>
      this.db
        .update(employees)
        .set({ ...patch, updatedBy: actor.id, updatedAt: new Date() })
        .where(eq(employees.id, id))
        .returning(),
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update employee');

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action,
      target: `employee:${id}`,
      before: this.redact(before),
      after: this.redact(row),
    });
    return row;
  }

  /** Throw NOT_FOUND unless the employee exists. Used by sibling modules (e.g. documents). */
  async ensureExists(id: string): Promise<void> {
    await this.getOrThrow(id);
  }

  private async getOrThrow(id: string): Promise<Employee> {
    const [row] = await this.db.select().from(employees).where(eq(employees.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Employee not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async assertManagerExists(managerId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.id, managerId))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Manager not found', HttpStatus.NOT_FOUND);
  }

  /** True if `managerId` sits above `employeeId` in the reporting chain. */
  async isManagerOf(managerId: string, employeeId: string): Promise<boolean> {
    return (await this.ancestorIds(employeeId)).has(managerId);
  }

  /** Reject assigning `newManagerId` to `employeeId` if it would create a cycle. */
  private async assertNoCycle(employeeId: string, newManagerId: string): Promise<void> {
    if (newManagerId === employeeId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'An employee cannot be their own manager');
    }
    await this.assertManagerExists(newManagerId);
    // Walking up from the proposed manager must never reach the employee.
    const ancestorsOfManager = await this.ancestorIds(newManagerId);
    if (ancestorsOfManager.has(employeeId)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Manager assignment would create a cycle');
    }
  }

  /** Ids of every manager above `startId` (exclusive of `startId`). */
  private async ancestorIds(startId: string): Promise<Set<string>> {
    const seen = new Set<string>();
    let current: string | null = startId;
    for (let depth = 0; depth < MAX_ORG_DEPTH && current; depth++) {
      const [row] = await this.db
        .select({ managerId: employees.managerId })
        .from(employees)
        .where(eq(employees.id, current))
        .limit(1);
      const next: string | null = row?.managerId ?? null;
      if (!next || seen.has(next)) break;
      seen.add(next);
      current = next;
    }
    return seen;
  }

  private redact(employee: Employee): Record<string, unknown> {
    const clone: Record<string, unknown> = { ...employee };
    for (const key of SENSITIVE_FIELDS) delete clone[key];
    return clone;
  }

  /** Run a write, translating Postgres constraint violations into clean API errors. */
  private async runMapped<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const code = pgErrorCode(err);
      if (code === '23505') {
        throw new AppError(
          ErrorCode.CONFLICT,
          'employee_code or work_email already exists',
          HttpStatus.CONFLICT,
        );
      }
      if (code === '23503') {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'Referenced department or manager does not exist');
      }
      throw err;
    }
  }
}
