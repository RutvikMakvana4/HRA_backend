import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  attendanceRecords,
  auditLog,
  employees,
  holidays,
  leaveRequests,
  leaveTypes,
  notifications,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove, topRole } from '../auth/roles';
import { EmployeesService } from '../employees/employees.service';
import { LeaveService } from '../leave/leave.service';

const UPCOMING_HOLIDAYS_LIMIT = 5;

@Injectable()
export class EssService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly employeesService: EmployeesService,
    private readonly leaveService: LeaveService,
  ) {}

  /** `GET /me` → the caller's profile, primary role, and whether they manage anyone. */
  async me(actor: AuthenticatedUser) {
    const employee = await this.employeesService.findByIdForViewer(actor.id, actor);
    const isManager = await this.hasReports(actor.id);
    return { id: actor.id, employee, role: topRole(actor), is_manager: isManager };
  }

  /** `GET /me/dashboard` → today's attendance, balances, pending requests, upcoming holidays. */
  async dashboard(actor: AuthenticatedUser) {
    const today = new Date().toISOString().slice(0, 10);
    const [employee] = await this.db
      .select({ workLocation: employees.workLocation })
      .from(employees)
      .where(eq(employees.id, actor.id))
      .limit(1);

    const [todayAttendance] = await this.db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.employeeId, actor.id), eq(attendanceRecords.date, today)))
      .limit(1);

    const leaveBalances = await this.leaveService.listBalances(actor.id, actor);

    const pendingRequests = await this.db
      .select({
        id: leaveRequests.id,
        leaveTypeId: leaveRequests.leaveTypeId,
        leaveTypeName: leaveTypes.name,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        daysCount: leaveRequests.daysCount,
        status: leaveRequests.status,
        createdAt: leaveRequests.createdAt,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(eq(leaveRequests.employeeId, actor.id), eq(leaveRequests.status, 'pending')))
      .orderBy(desc(leaveRequests.createdAt));

    const locations: ('india' | 'uk')[] = employee?.workLocation === 'uk' ? ['uk'] : ['india'];
    const upcomingHolidays = await this.db
      .select()
      .from(holidays)
      .where(and(gte(holidays.date, today), inArray(holidays.location, locations)))
      .orderBy(holidays.date)
      .limit(UPCOMING_HOLIDAYS_LIMIT);

    const [approvals] = await this.db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.approverId, actor.id), eq(leaveRequests.status, 'pending')));

    return {
      today_attendance: todayAttendance ?? null,
      leave_balances: leaveBalances,
      pending_requests: pendingRequests,
      upcoming_holidays: upcomingHolidays,
      team_pending_approvals: approvals?.count ?? 0,
    };
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  listNotifications(actor: AuthenticatedUser) {
    return this.db
      .select({
        id: notifications.id,
        title: notifications.title,
        body: notifications.body,
        href: notifications.href,
        read: notifications.read,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.employeeId, actor.id))
      .orderBy(desc(notifications.createdAt));
  }

  async markNotificationRead(id: string, actor: AuthenticatedUser) {
    const [row] = await this.db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, id), eq(notifications.employeeId, actor.id)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Notification not found', HttpStatus.NOT_FOUND);
    return { id: row.id, read: row.read };
  }

  // ── Audit log ──────────────────────────────────────────────────────────────

  /** `GET /audit-log` → HR/Admin only. Shaped to the frontend's audit table columns. */
  async auditLog(actor: AuthenticatedUser) {
    if (!isAdminOrAbove(actor)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view the audit log', HttpStatus.FORBIDDEN);
    }
    const rows = await this.db
      .select({
        id: auditLog.id,
        actorId: auditLog.actorId,
        actorName: sql<
          string | null
        >`coalesce(${employees.displayName}, ${employees.firstName} || ' ' || ${employees.lastName})`,
        action: auditLog.action,
        entity: auditLog.targetType,
        entityLabel: auditLog.targetId,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(employees, eq(employees.id, auditLog.actorId))
      .orderBy(desc(auditLog.createdAt))
      .limit(200);
    return rows.map((r) => ({
      ...r,
      actorName: r.actorName ?? 'System',
      summary: `${r.action}${r.entity ? ` on ${r.entity}` : ''}`,
    }));
  }

  private async hasReports(managerId: string): Promise<boolean> {
    const filters: SQL[] = [eq(employees.managerId, managerId)];
    const [row] = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(and(...filters))
      .limit(1);
    return Boolean(row);
  }
}
