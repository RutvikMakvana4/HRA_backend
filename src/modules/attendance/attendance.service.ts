import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  attendanceRecords,
  attendanceRegularizations,
  employees,
  type AttendanceRecord,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove } from '../auth/roles';
import { EmployeesService } from '../employees/employees.service';
import type {
  CheckInDto,
  CheckOutDto,
  DecideRegularizationDto,
  ListAttendanceDto,
  RegularizeDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';

/** Columns a regularization is allowed to change when approved. */
const REGULARIZABLE = new Set(['checkIn', 'checkOut', 'workMode', 'status', 'notes']);

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly employeesService: EmployeesService,
  ) {}

  // ── Records ────────────────────────────────────────────────────────────────

  /** Role-scoped, date-filtered attendance. `team` = the caller's direct reports; `all` = HR. */
  async list(query: ListAttendanceDto, actor: AuthenticatedUser) {
    const filters: SQL[] = [];
    if (query.scope === 'me') {
      filters.push(eq(attendanceRecords.employeeId, actor.id));
    } else if (query.scope === 'team') {
      const reportIds = await this.directReportIds(actor.id);
      filters.push(inArray(attendanceRecords.employeeId, [actor.id, ...reportIds]));
    } else if (!isAdminOrAbove(actor)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view all attendance', HttpStatus.FORBIDDEN);
    }
    if (query.from) filters.push(gte(attendanceRecords.date, query.from));
    if (query.to) filters.push(lte(attendanceRecords.date, query.to));

    const rows = await this.db
      .select({
        id: attendanceRecords.id,
        employeeId: attendanceRecords.employeeId,
        employeeName: this.nameExpr(),
        date: attendanceRecords.date,
        checkIn: attendanceRecords.checkIn,
        checkOut: attendanceRecords.checkOut,
        workMode: attendanceRecords.workMode,
        status: attendanceRecords.status,
        totalMinutes: attendanceRecords.totalMinutes,
        notes: attendanceRecords.notes,
        source: attendanceRecords.source,
      })
      .from(attendanceRecords)
      .innerJoin(employees, eq(employees.id, attendanceRecords.employeeId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(attendanceRecords.date));
    return rows.map((r) => this.withHours(r));
  }

  async checkIn(dto: CheckInDto, actor: AuthenticatedUser) {
    const today = this.today();
    const existing = await this.findRecord(actor.id, today);
    if (existing?.checkIn) {
      throw new AppError(ErrorCode.CONFLICT, 'Already checked in today', HttpStatus.CONFLICT);
    }
    const now = new Date();
    const [row] = await this.db
      .insert(attendanceRecords)
      .values({
        employeeId: actor.id,
        date: today,
        checkIn: now,
        workMode: dto.workMode,
        status: 'present',
        notes: dto.notes,
        source: 'self',
      })
      .onConflictDoUpdate({
        target: [attendanceRecords.employeeId, attendanceRecords.date],
        set: { checkIn: now, workMode: dto.workMode, status: 'present', notes: dto.notes, updatedAt: now },
      })
      .returning();
    return this.withHours(row!);
  }

  async checkOut(dto: CheckOutDto, actor: AuthenticatedUser) {
    const today = this.today();
    const record = await this.findRecord(actor.id, today);
    if (!record?.checkIn) {
      throw new AppError(ErrorCode.CONFLICT, 'You have not checked in today', HttpStatus.CONFLICT);
    }
    if (record.checkOut) {
      throw new AppError(ErrorCode.CONFLICT, 'Already checked out today', HttpStatus.CONFLICT);
    }
    const now = new Date();
    const totalMinutes = Math.max(0, Math.round((now.getTime() - record.checkIn.getTime()) / 60000));
    const [row] = await this.db
      .update(attendanceRecords)
      .set({ checkOut: now, totalMinutes, notes: dto.notes ?? record.notes, updatedAt: now })
      .where(eq(attendanceRecords.id, record.id))
      .returning();
    return this.withHours(row!);
  }

  /** HR manual edit (audited). Recomputes worked minutes when both timestamps are present. */
  async updateByHr(id: string, dto: UpdateAttendanceDto, actor: AuthenticatedUser) {
    const before = await this.getRecord(id);
    const patch: Partial<AttendanceRecord> = {};
    if (dto.checkIn !== undefined) patch.checkIn = dto.checkIn ? new Date(dto.checkIn) : null;
    if (dto.checkOut !== undefined) patch.checkOut = dto.checkOut ? new Date(dto.checkOut) : null;
    if (dto.workMode !== undefined) patch.workMode = dto.workMode;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.notes !== undefined) patch.notes = dto.notes;

    const checkIn = patch.checkIn ?? before.checkIn;
    const checkOut = patch.checkOut ?? before.checkOut;
    patch.totalMinutes =
      checkIn && checkOut ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000)) : null;

    const [row] = await this.db
      .update(attendanceRecords)
      .set({ ...patch, source: 'hr_edit', updatedAt: new Date() })
      .where(eq(attendanceRecords.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update attendance');
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'attendance.hr_edit',
      target: `attendance:${id}`,
      before: { ...before },
      after: { ...row },
    });
    return this.withHours(row);
  }

  // ── Regularizations ──────────────────────────────────────────────────────────

  async listRegularizations(actor: AuthenticatedUser) {
    const filters: SQL[] = [];
    if (!isAdminOrAbove(actor)) {
      // Managers/employees see requests they raised or that they approve.
      filters.push(
        sql`(${attendanceRegularizations.employeeId} = ${actor.id} or ${attendanceRegularizations.approverId} = ${actor.id})`,
      );
    }
    const rows = await this.db
      .select({
        id: attendanceRegularizations.id,
        attendanceRecordId: attendanceRegularizations.attendanceRecordId,
        employeeId: attendanceRegularizations.employeeId,
        employeeName: this.nameExpr(),
        date: attendanceRecords.date,
        requestedChange: attendanceRegularizations.requestedChange,
        reason: attendanceRegularizations.reason,
        status: attendanceRegularizations.status,
        approverId: attendanceRegularizations.approverId,
        createdAt: attendanceRegularizations.createdAt,
      })
      .from(attendanceRegularizations)
      .innerJoin(employees, eq(employees.id, attendanceRegularizations.employeeId))
      .innerJoin(attendanceRecords, eq(attendanceRecords.id, attendanceRegularizations.attendanceRecordId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(attendanceRegularizations.createdAt));
    return rows;
  }

  async regularize(dto: RegularizeDto, actor: AuthenticatedUser) {
    const record = dto.attendanceRecordId
      ? await this.getRecord(dto.attendanceRecordId)
      : await this.ensureRecordForDate(actor.id, dto.date!);
    if (record.employeeId !== actor.id) {
      throw new AppError(ErrorCode.FORBIDDEN, 'You can only regularize your own attendance', HttpStatus.FORBIDDEN);
    }
    const employee = await this.employeeManager(actor.id);
    const [row] = await this.db
      .insert(attendanceRegularizations)
      .values({
        attendanceRecordId: record.id,
        employeeId: actor.id,
        requestedChange: dto.requestedChange,
        reason: dto.reason,
        status: 'pending',
        approverId: employee.managerId ?? null,
      })
      .returning();
    return row;
  }

  async decideRegularization(id: string, dto: DecideRegularizationDto, actor: AuthenticatedUser) {
    const before = await this.getRegularization(id);
    const canDecide =
      isAdminOrAbove(actor) || (await this.employeesService.isManagerOf(actor.id, before.employeeId));
    if (!canDecide) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to decide this request', HttpStatus.FORBIDDEN);
    }
    if (before.status !== 'pending') {
      throw new AppError(ErrorCode.CONFLICT, `Request is already ${before.status}`, HttpStatus.CONFLICT);
    }

    if (dto.decision === 'approve') {
      await this.applyRegularization(before.attendanceRecordId, before.requestedChange);
    }
    const [row] = await this.db
      .update(attendanceRegularizations)
      .set({
        status: dto.decision === 'approve' ? 'approved' : 'rejected',
        approverId: actor.id,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(attendanceRegularizations.id, id))
      .returning();
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: `attendance.regularization.${dto.decision}`,
      target: `attendance_regularization:${id}`,
      after: { status: row?.status },
    });
    return row;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async applyRegularization(recordId: string, change: unknown): Promise<void> {
    if (!change || typeof change !== 'object') return;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(change as Record<string, unknown>)) {
      if (!REGULARIZABLE.has(k)) continue;
      patch[k] = (k === 'checkIn' || k === 'checkOut') && typeof v === 'string' ? new Date(v) : v;
    }
    if (Object.keys(patch).length === 0) return;

    // Recompute worked minutes from the resulting timestamps, mirroring
    // updateByHr — otherwise a correction that fills both times leaves hours null.
    const before = await this.getRecord(recordId);
    const checkIn = (patch.checkIn as Date | undefined) ?? before.checkIn;
    const checkOut = (patch.checkOut as Date | undefined) ?? before.checkOut;
    patch.totalMinutes =
      checkIn && checkOut ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60000)) : null;

    await this.db
      .update(attendanceRecords)
      .set({ ...patch, source: 'hr_edit', updatedAt: new Date() })
      .where(eq(attendanceRecords.id, recordId));
  }

  private async ensureRecordForDate(employeeId: string, date: string): Promise<AttendanceRecord> {
    const existing = await this.findRecord(employeeId, date);
    if (existing) return existing;
    const [row] = await this.db
      .insert(attendanceRecords)
      .values({ employeeId, date, status: 'absent', source: 'self' })
      .onConflictDoNothing({ target: [attendanceRecords.employeeId, attendanceRecords.date] })
      .returning();
    return row ?? (await this.findRecord(employeeId, date))!;
  }

  private async findRecord(employeeId: string, date: string): Promise<AttendanceRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.employeeId, employeeId), eq(attendanceRecords.date, date)))
      .limit(1);
    return row;
  }

  private async getRecord(id: string): Promise<AttendanceRecord> {
    const [row] = await this.db.select().from(attendanceRecords).where(eq(attendanceRecords.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Attendance record not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getRegularization(id: string) {
    const [row] = await this.db
      .select()
      .from(attendanceRegularizations)
      .where(eq(attendanceRegularizations.id, id))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Regularization not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async employeeManager(id: string) {
    const [row] = await this.db
      .select({ managerId: employees.managerId })
      .from(employees)
      .where(eq(employees.id, id))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Employee not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async directReportIds(managerId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.managerId, managerId));
    return rows.map((r) => r.id);
  }

  /** Attach `totalHours` (frontend field) derived from stored minutes; hide raw minutes. */
  private withHours<T extends { totalMinutes: number | null }>(row: T) {
    const { totalMinutes, ...rest } = row;
    return { ...rest, totalHours: totalMinutes == null ? null : Math.round((totalMinutes / 60) * 10) / 10 };
  }

  private nameExpr() {
    return sql<string>`coalesce(${employees.displayName}, ${employees.firstName} || ' ' || ${employees.lastName})`;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
