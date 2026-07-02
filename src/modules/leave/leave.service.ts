import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  employees,
  holidays,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  type Holiday,
  type LeaveType,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove } from '../auth/roles';
import { EmployeesService } from '../employees/employees.service';
import type {
  ApplyLeaveDto,
  CreateHolidayDto,
  CreateLeaveTypeDto,
  ListHolidaysDto,
} from './dto/leave.dto';

const OPEN_STATUSES = ['pending', 'approved'] as const;

type LeaveDecision = 'approve' | 'reject' | 'cancel';

@Injectable()
export class LeaveService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly employeesService: EmployeesService,
  ) {}

  // ── Leave types ──────────────────────────────────────────────────────────

  listLeaveTypes(): Promise<LeaveType[]> {
    return this.db.select().from(leaveTypes).orderBy(asc(leaveTypes.name));
  }

  async createLeaveType(dto: CreateLeaveTypeDto, actor: AuthenticatedUser): Promise<LeaveType> {
    const [row] = await this.mapWrite(() =>
      this.db.insert(leaveTypes).values(dto).returning(),
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create leave type');
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'leave_type.create',
      target: `leave_type:${row.id}`,
      after: { ...row },
    });
    return row;
  }

  // ── Leave requests ─────────────────────────────────────────────────────────

  /** Role-scoped list. `me` = own; `team` = requests the caller approves; `all` = HR/Admin only. */
  async listRequests(scope: 'me' | 'team' | 'all', actor: AuthenticatedUser) {
    const filters = [] as ReturnType<typeof eq>[];
    if (scope === 'me') {
      filters.push(eq(leaveRequests.employeeId, actor.id));
    } else if (scope === 'team') {
      filters.push(eq(leaveRequests.approverId, actor.id));
    } else {
      if (!isAdminOrAbove(actor)) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view all leave requests', HttpStatus.FORBIDDEN);
      }
    }
    const rows = await this.db
      .select({
        id: leaveRequests.id,
        employeeId: leaveRequests.employeeId,
        employeeName: this.nameExpr(),
        leaveTypeId: leaveRequests.leaveTypeId,
        leaveTypeName: leaveTypes.name,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        isHalfDay: leaveRequests.isHalfDay,
        halfDayPeriod: leaveRequests.halfDayPeriod,
        daysCount: leaveRequests.daysCount,
        reason: leaveRequests.reason,
        status: leaveRequests.status,
        approverId: leaveRequests.approverId,
        decidedAt: leaveRequests.decidedAt,
        decisionNote: leaveRequests.decisionNote,
        createdAt: leaveRequests.createdAt,
      })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(leaveRequests.createdAt));
    return rows;
  }

  /** Apply for leave. Computes working days, checks overlaps + balance, and books `pending`. */
  async apply(dto: ApplyLeaveDto, actor: AuthenticatedUser) {
    const employee = await this.getEmployee(actor.id);
    const type = await this.getLeaveType(dto.leaveTypeId);

    if (dto.isHalfDay && !type.allowHalfDay) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `${type.name} does not allow half-day leave`);
    }

    const daysCount = dto.isHalfDay
      ? 1
      : await this.workingDays(dto.startDate, dto.endDate, employee.workLocation);
    if (daysCount <= 0) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Selected range has no working days');
    }
    if (type.maxConsecutiveDays != null && daysCount > type.maxConsecutiveDays) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        `${type.name} allows at most ${type.maxConsecutiveDays} consecutive days`,
      );
    }

    await this.assertNoOverlap(actor.id, dto.startDate, dto.endDate);

    const year = Number(dto.startDate.slice(0, 4));
    if (type.isPaid) {
      const available = await this.availableBalance(actor.id, type.id, year);
      if (daysCount > available) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `Insufficient ${type.name} balance: requested ${daysCount}, available ${available}`,
          HttpStatus.CONFLICT,
        );
      }
    }

    const autoApprove = !type.requiresApproval;
    const [row] = await this.db
      .insert(leaveRequests)
      .values({
        employeeId: actor.id,
        leaveTypeId: type.id,
        startDate: dto.startDate,
        endDate: dto.endDate,
        isHalfDay: dto.isHalfDay,
        halfDayPeriod: dto.halfDayPeriod ?? null,
        daysCount,
        reason: dto.reason,
        status: autoApprove ? 'approved' : 'pending',
        approverId: employee.managerId ?? null,
        decidedAt: autoApprove ? new Date() : null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create leave request');

    await this.adjustBalance(
      actor.id,
      type.id,
      year,
      autoApprove ? { used: daysCount } : { pending: daysCount },
    );
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'leave_request.apply',
      target: `leave_request:${row.id}`,
      after: { ...row },
    });
    return row;
  }

  /** Approve / reject / cancel a request, moving balances and enforcing who may decide. */
  async decide(id: string, action: LeaveDecision, note: string | undefined, actor: AuthenticatedUser) {
    const before = await this.getRequestRow(id);
    const year = Number(before.startDate.slice(0, 4));

    if (action === 'cancel') {
      const isOwner = actor.id === before.employeeId;
      if (!isOwner && !isAdminOrAbove(actor)) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to cancel this request', HttpStatus.FORBIDDEN);
      }
      if (before.status === 'cancelled' || before.status === 'rejected') {
        throw new AppError(ErrorCode.CONFLICT, `Request is already ${before.status}`, HttpStatus.CONFLICT);
      }
      if (before.status === 'pending') {
        await this.adjustBalance(before.employeeId, before.leaveTypeId, year, { pending: -before.daysCount });
      } else if (before.status === 'approved') {
        if (!isAdminOrAbove(actor)) {
          throw new AppError(ErrorCode.FORBIDDEN, 'Only HR can cancel an approved leave', HttpStatus.FORBIDDEN);
        }
        await this.adjustBalance(before.employeeId, before.leaveTypeId, year, { used: -before.daysCount });
      }
      return this.finalize(before, 'cancelled', note, actor, 'leave_request.cancel');
    }

    // approve / reject require manager-of-the-requester or HR.
    const canDecide = isAdminOrAbove(actor) || (await this.employeesService.isManagerOf(actor.id, before.employeeId));
    if (!canDecide) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to decide this request', HttpStatus.FORBIDDEN);
    }
    if (before.status !== 'pending') {
      throw new AppError(ErrorCode.CONFLICT, `Request is already ${before.status}`, HttpStatus.CONFLICT);
    }
    if (action === 'approve') {
      await this.adjustBalance(before.employeeId, before.leaveTypeId, year, {
        pending: -before.daysCount,
        used: before.daysCount,
      });
      return this.finalize(before, 'approved', note, actor, 'leave_request.approve');
    }
    // reject
    await this.adjustBalance(before.employeeId, before.leaveTypeId, year, { pending: -before.daysCount });
    return this.finalize(before, 'rejected', note, actor, 'leave_request.reject');
  }

  // ── Balances ────────────────────────────────────────────────────────────────

  /** Balances for an employee (defaults to the caller). Enforces self / manager / HR access. */
  async listBalances(employeeId: string | undefined, actor: AuthenticatedUser) {
    const targetId = employeeId ?? actor.id;
    if (
      targetId !== actor.id &&
      !isAdminOrAbove(actor) &&
      !(await this.employeesService.isManagerOf(actor.id, targetId))
    ) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view these balances', HttpStatus.FORBIDDEN);
    }
    const rows = await this.db
      .select({
        id: leaveBalances.id,
        employeeId: leaveBalances.employeeId,
        leaveTypeId: leaveBalances.leaveTypeId,
        leaveTypeName: leaveTypes.name,
        year: leaveBalances.year,
        accrued: leaveBalances.accrued,
        used: leaveBalances.used,
        pending: leaveBalances.pending,
        carriedForward: leaveBalances.carriedForward,
      })
      .from(leaveBalances)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
      .where(eq(leaveBalances.employeeId, targetId))
      .orderBy(asc(leaveTypes.name));
    return rows.map((r) => ({
      ...r,
      available: r.accrued + r.carriedForward - r.used - r.pending,
    }));
  }

  // ── Holidays ──────────────────────────────────────────────────────────────

  listHolidays(query: ListHolidaysDto): Promise<Holiday[]> {
    const filters = [] as ReturnType<typeof eq>[];
    if (query.location) filters.push(eq(holidays.location, query.location));
    if (query.year) filters.push(eq(holidays.year, query.year));
    return this.db
      .select()
      .from(holidays)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(holidays.date));
  }

  async createHoliday(dto: CreateHolidayDto, actor: AuthenticatedUser): Promise<Holiday> {
    const year = dto.year ?? Number(dto.date.slice(0, 4));
    const [row] = await this.mapWrite(() =>
      this.db.insert(holidays).values({ ...dto, year }).returning(),
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create holiday');
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'holiday.create',
      target: `holiday:${row.id}`,
      after: { ...row },
    });
    return row;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async finalize(
    before: typeof leaveRequests.$inferSelect,
    status: 'approved' | 'rejected' | 'cancelled',
    note: string | undefined,
    actor: AuthenticatedUser,
    action: string,
  ) {
    const [row] = await this.db
      .update(leaveRequests)
      .set({
        status,
        approverId: status === 'cancelled' ? before.approverId : actor.id,
        decisionNote: note,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(leaveRequests.id, before.id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update leave request');
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action,
      target: `leave_request:${before.id}`,
      before: { status: before.status },
      after: { status: row.status },
    });
    return row;
  }

  /** Upsert the balance row and increment the given counters (can be negative). */
  private async adjustBalance(
    employeeId: string,
    leaveTypeId: string,
    year: number,
    delta: { pending?: number; used?: number },
  ): Promise<void> {
    await this.db
      .insert(leaveBalances)
      .values({
        employeeId,
        leaveTypeId,
        year,
        pending: Math.max(0, delta.pending ?? 0),
        used: Math.max(0, delta.used ?? 0),
      })
      .onConflictDoUpdate({
        target: [leaveBalances.employeeId, leaveBalances.leaveTypeId, leaveBalances.year],
        set: {
          pending: sql`greatest(0, ${leaveBalances.pending} + ${delta.pending ?? 0})`,
          used: sql`greatest(0, ${leaveBalances.used} + ${delta.used ?? 0})`,
          updatedAt: new Date(),
        },
      });
  }

  private async availableBalance(employeeId: string, leaveTypeId: string, year: number): Promise<number> {
    const [row] = await this.db
      .select({
        accrued: leaveBalances.accrued,
        used: leaveBalances.used,
        pending: leaveBalances.pending,
        carriedForward: leaveBalances.carriedForward,
      })
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.employeeId, employeeId),
          eq(leaveBalances.leaveTypeId, leaveTypeId),
          eq(leaveBalances.year, year),
        ),
      )
      .limit(1);
    if (!row) return 0;
    return row.accrued + row.carriedForward - row.used - row.pending;
  }

  private async assertNoOverlap(employeeId: string, startDate: string, endDate: string): Promise<void> {
    const [clash] = await this.db
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, employeeId),
          inArray(leaveRequests.status, [...OPEN_STATUSES]),
          lte(leaveRequests.startDate, endDate),
          gte(leaveRequests.endDate, startDate),
        ),
      )
      .limit(1);
    if (clash) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'You already have a pending or approved leave overlapping these dates',
        HttpStatus.CONFLICT,
      );
    }
  }

  /** Working days in [start, end] inclusive, excluding weekends and the location's holidays. */
  private async workingDays(start: string, end: string, location: string): Promise<number> {
    const holidaySet = new Set<string>();
    if (location === 'india' || location === 'uk') {
      const rows = await this.db
        .select({ date: holidays.date })
        .from(holidays)
        .where(and(eq(holidays.location, location), gte(holidays.date, start), lte(holidays.date, end)));
      for (const r of rows) holidaySet.add(r.date);
    }
    let count = 0;
    for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.getUTCDay();
      if (day === 0 || day === 6) continue;
      const iso = d.toISOString().slice(0, 10);
      if (holidaySet.has(iso)) continue;
      count++;
    }
    return count;
  }

  private async getEmployee(id: string) {
    const [row] = await this.db
      .select({ id: employees.id, workLocation: employees.workLocation, managerId: employees.managerId })
      .from(employees)
      .where(eq(employees.id, id))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Employee not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getLeaveType(id: string): Promise<LeaveType> {
    const [row] = await this.db.select().from(leaveTypes).where(eq(leaveTypes.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Leave type not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getRequestRow(id: string) {
    const [row] = await this.db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Leave request not found', HttpStatus.NOT_FOUND);
    return row;
  }

  /** SQL for an employee's display name (`display_name` falling back to first + last). */
  private nameExpr() {
    return sql<string>`coalesce(${employees.displayName}, ${employees.firstName} || ' ' || ${employees.lastName})`;
  }

  private async mapWrite<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
        throw new AppError(ErrorCode.CONFLICT, 'A record with that unique key already exists', HttpStatus.CONFLICT);
      }
      throw err;
    }
  }
}
