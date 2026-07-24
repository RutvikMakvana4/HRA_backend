import { forwardRef, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  employees,
  holidays,
  leaveRequests,
  notifications,
  projectTasks,
  projects,
  timesheetEntries,
  timesheetWeeks,
  type TimesheetWeek,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove } from '../auth/roles';
import { EmployeesService } from '../employees/employees.service';
import { ProjectsService } from './projects.service';
import type { GetWeekDto, ListWeeksDto, UtilizationReportDto } from './dto/timesheets.dto';
import { isOvertimeDate, splitMinutes } from './overtime.util';

/** Standard working day for capacity (utilization denominator). Minutes. */
const STANDARD_DAY_MINUTES = 8 * 60;
/** Soft warning threshold for a single day's logged effort. Minutes. */
const MAX_DAILY_MINUTES = 12 * 60;

@Injectable()
export class TimesheetsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly employeesService: EmployeesService,
    @Inject(forwardRef(() => ProjectsService)) private readonly projectsService: ProjectsService,
  ) {}

  // ── Week view ────────────────────────────────────────────────────────────────

  /** The week (existing or a virtual draft shell) + entries + non-working-day flags. */
  async getWeek(query: GetWeekDto, actor: AuthenticatedUser) {
    const employeeId = query.employeeId ?? actor.id;
    await this.assertCanViewEmployee(employeeId, actor);
    const weekStart = query.weekStart ? this.mondayOf(query.weekStart) : this.mondayOf(this.today());

    const week = await this.findWeek(employeeId, weekStart);
    const entries = week ? await this.entriesForWeek(week.id) : [];
    const nonWorkingDays = await this.nonWorkingDays(employeeId, weekStart);

    return {
      week: week
        ? { ...week, totalHours: this.toHours(week.totalMinutes) }
        : { id: null, employeeId, weekStartDate: weekStart, status: 'draft', totalMinutes: 0, totalHours: 0 },
      entries,
      nonWorkingDays,
    };
  }

  // ── Entries ──────────────────────────────────────────────────────────────────

  /**
   * The getWeek-shaped payload plus week-level warnings. The v1 grid write path (saveWeek) that
   * called this was retired in the v2 (task-first) migration — `timesheet_entries.task_id` is now
   * NOT NULL, and that path could only ever write a task-less entry. Kept (not `private`, since it
   * has no caller left in this class yet and `noUnusedLocals` would flag a truly-unreachable
   * private member) for the v2 write path (Task 3+) to return the same shape after a save.
   */
  async weekPayload(employeeId: string, weekStart: string, weekId: string) {
    const fresh = await this.getWeekRow(weekId);
    const entries = await this.entriesForWeek(weekId);
    const nonWorkingDays = await this.nonWorkingDays(employeeId, weekStart);

    const warnings: string[] = [];
    const byDay = new Map<string, number>();
    for (const e of entries) byDay.set(e.workDate, (byDay.get(e.workDate) ?? 0) + e.minutes);
    for (const [day, minutes] of byDay) {
      if (minutes > MAX_DAILY_MINUTES) warnings.push(`Logged more than ${MAX_DAILY_MINUTES / 60}h on ${day}`);
      const reason = await this.nonWorkingReason(employeeId, day);
      if (reason) warnings.push(`${day} is a ${reason}`);
    }

    return {
      week: { ...fresh, totalHours: this.toHours(fresh.totalMinutes) },
      entries,
      nonWorkingDays,
      warnings,
    };
  }

  /**
   * The v2 write path — the ONLY place a `timesheet_entries` row is written. Keyed by
   * (week, task, work_date) per the `uq_timesheet_entry_task_day` constraint, so logging twice
   * on the same task/day UPDATES in place (preserving the entry id, so `update_comments`
   * — ON DELETE CASCADE off `entry_id` — survive) rather than inserting a duplicate row.
   * `hours: 0` is allowed deliberately: a morning "committed to this today" with no time yet.
   */
  async upsertTaskEntry(
    taskId: string,
    projectId: string,
    dto: { workDate: string; hours: number; note?: string | null; billable?: boolean },
    actor: AuthenticatedUser,
  ) {
    const week = await this.ensureDraftWeek(actor.id, this.mondayOf(dto.workDate));
    this.assertDraft(week);
    const project = await this.projectsService.getProjectRow(projectId);
    const minutes = Math.round(dto.hours * 60);
    const billable = dto.billable ?? project.defaultBillable;

    // Atomic upsert: a concurrent double-log of the same (week, task, work_date) must not
    // race a select-then-branch into the uq_timesheet_entry_task_day unique constraint.
    // ON CONFLICT DO UPDATE updates the existing row in place (id unchanged), so
    // update_comments — keyed off entry_id — still survive.
    const [row] = await this.db
      .insert(timesheetEntries)
      .values({
        weekId: week.id,
        employeeId: actor.id,
        projectId,
        taskId,
        workDate: dto.workDate,
        minutes,
        billable,
        taskDescription: dto.note ?? null,
        status: 'draft',
      })
      .onConflictDoUpdate({
        target: [timesheetEntries.weekId, timesheetEntries.taskId, timesheetEntries.workDate],
        set: { minutes, billable, taskDescription: dto.note ?? null, updatedAt: new Date() },
      })
      .returning(); // preserve id → comments survive
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to log task work');
    await this.recomputeWeekTotal(week.id);
    return { ...row, hours: this.toHours(row.minutes) };
  }

  async deleteEntry(id: string, actor: AuthenticatedUser) {
    const entry = await this.getEntryRow(id);
    if (entry.employeeId !== actor.id && !isAdminOrAbove(actor)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to delete this entry', HttpStatus.FORBIDDEN);
    }
    const week = await this.getWeekRow(entry.weekId);
    this.assertDraft(week);
    await this.db.delete(timesheetEntries).where(eq(timesheetEntries.id, id));
    await this.recomputeWeekTotal(week.id);
    await this.record(actor, 'timesheet_entry.delete', `timesheet_entry:${id}`, { before: { minutes: entry.minutes } });
    return { id };
  }

  // ── Week transitions ─────────────────────────────────────────────────────────

  async submitWeek(id: string, actor: AuthenticatedUser) {
    const week = await this.getWeekRow(id);
    if (week.employeeId !== actor.id) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Only the owner can submit this week', HttpStatus.FORBIDDEN);
    }
    if (week.status !== 'draft' && week.status !== 'rejected') {
      throw new AppError(ErrorCode.CONFLICT, `Week is already ${week.status}`, HttpStatus.CONFLICT);
    }
    const [{ count } = { count: 0 }] = await this.db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(timesheetEntries)
      .where(eq(timesheetEntries.weekId, id));
    if (!count) throw new AppError(ErrorCode.VALIDATION_FAILED, 'Cannot submit an empty week');

    return this.doSubmit(week, actor);
  }

  /**
   * System-initiated submit for the Sunday-night auto-submit cron — same transition as
   * `submitWeek`'s core (`doSubmit`), but with no owner gate and no empty-week guard: the caller
   * (`ProjectJobsService.autoSubmitWeeks`) already filters to draft weeks with ≥1 entry logged.
   * The audit actor is a synthetic actor for the week's own employee, so the audit trail reads as
   * the employee's own submit rather than an anonymous system action.
   */
  async autoSubmitWeek(id: string) {
    const week = await this.getWeekRow(id);
    if (week.status !== 'draft' && week.status !== 'rejected') {
      throw new AppError(ErrorCode.CONFLICT, `Week is already ${week.status}`, HttpStatus.CONFLICT);
    }
    const actor: AuthenticatedUser = {
      id: week.employeeId,
      uid: week.employeeId,
      roles: [],
      permissions: [],
      scope: null,
      sid: 'system',
      type: 'user',
    };
    return this.doSubmit(week, actor);
  }

  /** Shared submit core: resolve the approver, transition to `submitted`, notify the approver. */
  private async doSubmit(week: TimesheetWeek, actor: AuthenticatedUser) {
    const [employee] = await this.db
      .select({ managerId: employees.managerId })
      .from(employees)
      .where(eq(employees.id, week.employeeId))
      .limit(1);
    const approverId = employee?.managerId ?? null;

    const row = await this.transitionWeek(week, 'submitted', {
      submittedAt: new Date(),
      approverId,
    }, actor, 'timesheet_week.submit');
    if (approverId) {
      await this.notify(approverId, 'Timesheet submitted', 'A timesheet week is awaiting your approval.', '/admin/timesheets');
    }
    return row;
  }

  /**
   * Regular (Mon–Sat) vs overtime (Sunday) hours for one week, plus a per-task breakdown. Readable
   * by the week's owner or anyone who could approve it (reuses `canApprove`, the same gate
   * `decideWeek` uses) — not just the approver, since the owner should see their own split too.
   */
  async weekSummary(id: string, actor: AuthenticatedUser) {
    const week = await this.getWeekRow(id);
    if (week.employeeId !== actor.id && !(await this.canApprove(week, actor))) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view this week summary', HttpStatus.FORBIDDEN);
    }

    const rows = await this.db
      .select({
        taskId: timesheetEntries.taskId,
        taskTitle: projectTasks.title,
        projectName: projects.name,
        workDate: timesheetEntries.workDate,
        minutes: timesheetEntries.minutes,
      })
      .from(timesheetEntries)
      .innerJoin(projectTasks, eq(projectTasks.id, timesheetEntries.taskId))
      .innerJoin(projects, eq(projects.id, timesheetEntries.projectId))
      .where(eq(timesheetEntries.weekId, id));

    const { regular, overtime } = splitMinutes(rows);

    // One row per (task, isOvertime) bucket — a task worked both on a weekday and a Sunday
    // shows up as two rows rather than blurring an overtime flag onto its regular hours.
    const byTask = new Map<
      string,
      { taskId: string; taskTitle: string; projectName: string; minutes: number; isOvertime: boolean }
    >();
    for (const r of rows) {
      const isOvertime = isOvertimeDate(r.workDate);
      const key = `${r.taskId}:${isOvertime}`;
      const existing = byTask.get(key);
      if (existing) {
        existing.minutes += r.minutes;
      } else {
        byTask.set(key, {
          taskId: r.taskId,
          taskTitle: r.taskTitle,
          projectName: r.projectName,
          minutes: r.minutes,
          isOvertime,
        });
      }
    }

    return {
      regularHours: this.toHours(regular),
      overtimeHours: this.toHours(overtime),
      totalHours: this.toHours(regular + overtime),
      byTask: Array.from(byTask.values()).map((t) => ({
        taskId: t.taskId,
        taskTitle: t.taskTitle,
        projectName: t.projectName,
        hours: this.toHours(t.minutes),
        isOvertime: t.isOvertime,
      })),
    };
  }

  approveWeek(id: string, note: string | undefined, actor: AuthenticatedUser) {
    return this.decideWeek(id, 'approved', note, actor);
  }

  rejectWeek(id: string, note: string | undefined, actor: AuthenticatedUser) {
    return this.decideWeek(id, 'rejected', note, actor);
  }

  private async decideWeek(
    id: string,
    decision: 'approved' | 'rejected',
    note: string | undefined,
    actor: AuthenticatedUser,
  ) {
    const week = await this.getWeekRow(id);
    if (week.status !== 'submitted') {
      throw new AppError(ErrorCode.CONFLICT, `Week is ${week.status}, not awaiting approval`, HttpStatus.CONFLICT);
    }
    if (!(await this.canApprove(week, actor))) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to decide this week', HttpStatus.FORBIDDEN);
    }
    const row = await this.transitionWeek(week, decision, {
      approverId: actor.id,
      decidedAt: new Date(),
      decisionNote: note ?? null,
    }, actor, `timesheet_week.${decision === 'approved' ? 'approve' : 'reject'}`);
    await this.notify(
      week.employeeId,
      `Timesheet ${decision}`,
      `Your timesheet week was ${decision}.`,
      '/me/timesheets',
    );
    return row;
  }

  // ── Utilization report ─────────────────────────────────────────────────────────

  /** billable approved hours ÷ available capacity over [from, to], per employee. Computed on read. */
  async utilizationReport(query: UtilizationReportDto, actor: AuthenticatedUser) {
    const employeeIds = await this.employeesService.scopeEmployeeIds(query.scope, actor);
    if (employeeIds.length === 0) return { from: query.from, to: query.to, capacityHours: this.toHours(this.capacityMinutes(query.from, query.to)), employees: [] };

    const rows = await this.db
      .select({
        employeeId: timesheetEntries.employeeId,
        employeeName: this.nameExpr(),
        billableMinutes: sql<number>`cast(coalesce(sum(case when ${timesheetEntries.billable} then ${timesheetEntries.minutes} else 0 end), 0) as int)`,
        totalMinutes: sql<number>`cast(coalesce(sum(${timesheetEntries.minutes}), 0) as int)`,
      })
      .from(timesheetEntries)
      .innerJoin(timesheetWeeks, eq(timesheetWeeks.id, timesheetEntries.weekId))
      .innerJoin(employees, eq(employees.id, timesheetEntries.employeeId))
      .where(
        and(
          inArray(timesheetEntries.employeeId, employeeIds),
          eq(timesheetWeeks.status, 'approved'),
          gte(timesheetEntries.workDate, query.from),
          lte(timesheetEntries.workDate, query.to),
        ),
      )
      .groupBy(timesheetEntries.employeeId, employees.displayName, employees.firstName, employees.lastName);

    const capacityMinutes = this.capacityMinutes(query.from, query.to);
    const capacityHours = this.toHours(capacityMinutes);
    return {
      from: query.from,
      to: query.to,
      capacityHours,
      employees: rows.map((r) => ({
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        billableHours: this.toHours(r.billableMinutes),
        totalHours: this.toHours(r.totalMinutes),
        nonBillableHours: this.toHours(r.totalMinutes - r.billableMinutes),
        utilizationPct: capacityMinutes > 0 ? Math.round((r.billableMinutes / capacityMinutes) * 100) : 0,
      })),
    };
  }

  /** Weeks for the scoped employee set, newest first, with billable_hours per week. */
  async listWeeks(query: ListWeeksDto, actor: AuthenticatedUser) {
    const employeeIds = await this.employeesService.scopeEmployeeIds(query.scope, actor);
    if (employeeIds.length === 0) return [];

    const rows = await this.db
      .select({
        id: timesheetWeeks.id,
        employeeId: timesheetWeeks.employeeId,
        employeeName: this.nameExpr(),
        weekStartDate: timesheetWeeks.weekStartDate,
        status: timesheetWeeks.status,
        totalMinutes: timesheetWeeks.totalMinutes,
        submittedAt: timesheetWeeks.submittedAt,
        approverId: timesheetWeeks.approverId,
        decidedAt: timesheetWeeks.decidedAt,
        decisionNote: timesheetWeeks.decisionNote,
      })
      .from(timesheetWeeks)
      .innerJoin(employees, eq(employees.id, timesheetWeeks.employeeId))
      .where(inArray(timesheetWeeks.employeeId, employeeIds))
      .orderBy(desc(timesheetWeeks.weekStartDate));

    // Billable minutes per week — a grouped aggregate over the week ids, merged in JS.
    const weekIds = rows.map((r) => r.id);
    const billable =
      weekIds.length === 0
        ? []
        : await this.db
            .select({
              weekId: timesheetEntries.weekId,
              billableMinutes: sql<number>`cast(coalesce(sum(case when ${timesheetEntries.billable} then ${timesheetEntries.minutes} else 0 end), 0) as int)`,
            })
            .from(timesheetEntries)
            .where(inArray(timesheetEntries.weekId, weekIds))
            .groupBy(timesheetEntries.weekId);
    const billableByWeek = new Map(billable.map((b) => [b.weekId, b.billableMinutes]));

    // Regular vs overtime minutes per week — ONE grouped query over all listed weeks' entries
    // (grouped by weekId + workDate, i.e. day-level totals), then bucketed Mon-Sat vs Sunday via
    // the shared `splitMinutes` predicate in JS. No per-row query, no correlated subquery.
    const daily =
      weekIds.length === 0
        ? []
        : await this.db
            .select({
              weekId: timesheetEntries.weekId,
              workDate: timesheetEntries.workDate,
              minutes: sql<number>`cast(coalesce(sum(${timesheetEntries.minutes}), 0) as int)`,
            })
            .from(timesheetEntries)
            .where(inArray(timesheetEntries.weekId, weekIds))
            .groupBy(timesheetEntries.weekId, timesheetEntries.workDate);
    const dailyByWeek = new Map<string, { workDate: string; minutes: number }[]>();
    for (const d of daily) {
      const list = dailyByWeek.get(d.weekId);
      if (list) list.push(d);
      else dailyByWeek.set(d.weekId, [d]);
    }

    return rows.map((r) => {
      const { regular, overtime } = splitMinutes(dailyByWeek.get(r.id) ?? []);
      return {
        id: r.id,
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        weekStartDate: r.weekStartDate,
        status: r.status,
        totalHours: this.toHours(r.totalMinutes),
        billableHours: this.toHours(billableByWeek.get(r.id) ?? 0),
        regularHours: this.toHours(regular),
        overtimeHours: this.toHours(overtime),
        submittedAt: r.submittedAt,
        approverId: r.approverId,
        decidedAt: r.decidedAt,
        decisionNote: r.decisionNote,
      };
    });
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private async transitionWeek(
    before: TimesheetWeek,
    status: TimesheetWeek['status'],
    patch: Partial<typeof timesheetWeeks.$inferInsert>,
    actor: AuthenticatedUser,
    action: string,
  ) {
    const [row] = await this.db
      .update(timesheetWeeks)
      .set({ status, updatedAt: new Date(), ...patch })
      .where(eq(timesheetWeeks.id, before.id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update timesheet week');
    // Entries inherit the week's status.
    await this.db.update(timesheetEntries).set({ status, updatedAt: new Date() }).where(eq(timesheetEntries.weekId, before.id));
    await this.record(actor, action, `timesheet_week:${before.id}`, {
      before: { status: before.status },
      after: { status },
    });
    return { ...row, totalHours: this.toHours(row.totalMinutes) };
  }

  /** Approve/reject allowed to: the line manager, any PM of a project in the week, or HR/Delivery. */
  private async canApprove(week: TimesheetWeek, actor: AuthenticatedUser): Promise<boolean> {
    if (isAdminOrAbove(actor)) return true;
    if (await this.employeesService.isManagerOf(actor.id, week.employeeId)) return true;
    const projectRows = await this.db
      .selectDistinct({ projectId: timesheetEntries.projectId })
      .from(timesheetEntries)
      .where(eq(timesheetEntries.weekId, week.id));
    for (const p of projectRows) {
      if (await this.projectsService.canManageProject(p.projectId, actor)) return true;
    }
    return false;
  }

  /**
   * Finds the caller's draft week for `weekStart`, creating it if absent. Both v1 write-path
   * callers (saveWeek, upsertEntry) were retired in the v2 migration; kept (not `private`, for the
   * same `noUnusedLocals` reason as `weekPayload` above) for the v2 write path (Task 3+).
   */
  async ensureDraftWeek(employeeId: string, weekStart: string): Promise<TimesheetWeek> {
    const existing = await this.findWeek(employeeId, weekStart);
    if (existing) return existing;
    const [row] = await this.db
      .insert(timesheetWeeks)
      .values({ employeeId, weekStartDate: weekStart, status: 'draft', totalMinutes: 0 })
      .onConflictDoNothing({ target: [timesheetWeeks.employeeId, timesheetWeeks.weekStartDate] })
      .returning();
    return row ?? (await this.findWeekOrThrow(employeeId, weekStart));
  }

  private async recomputeWeekTotal(weekId: string): Promise<void> {
    const [agg] = await this.db
      .select({ total: sql<number>`cast(coalesce(sum(${timesheetEntries.minutes}), 0) as int)` })
      .from(timesheetEntries)
      .where(eq(timesheetEntries.weekId, weekId));
    await this.db
      .update(timesheetWeeks)
      .set({ totalMinutes: agg?.total ?? 0, updatedAt: new Date() })
      .where(eq(timesheetWeeks.id, weekId));
  }

  private async entriesForWeek(weekId: string) {
    const rows = await this.db
      .select({
        id: timesheetEntries.id,
        weekId: timesheetEntries.weekId,
        projectId: timesheetEntries.projectId,
        projectName: projects.name,
        projectCode: projects.code,
        workDate: timesheetEntries.workDate,
        minutes: timesheetEntries.minutes,
        billable: timesheetEntries.billable,
        taskDescription: timesheetEntries.taskDescription,
        taskId: timesheetEntries.taskId,
        category: timesheetEntries.category,
        status: timesheetEntries.status,
      })
      .from(timesheetEntries)
      .innerJoin(projects, eq(projects.id, timesheetEntries.projectId))
      .where(eq(timesheetEntries.weekId, weekId))
      .orderBy(asc(timesheetEntries.workDate));
    return rows.map((r) => ({ ...r, hours: this.toHours(r.minutes) }));
  }

  /** For each of the week's 7 days, why (if any) it is a non-working day. */
  private async nonWorkingDays(employeeId: string, weekStart: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (let i = 0; i < 7; i++) {
      const day = this.addDays(weekStart, i);
      const reason = await this.nonWorkingReason(employeeId, day);
      if (reason) out[day] = reason;
    }
    return out;
  }

  /** 'weekend' | 'holiday' | 'leave' | null for a single date and employee. */
  private async nonWorkingReason(employeeId: string, date: string): Promise<string | null> {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) return 'weekend';

    const [employee] = await this.db
      .select({ location: employees.workLocation })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    if (employee && (employee.location === 'india' || employee.location === 'uk')) {
      const [holiday] = await this.db
        .select({ id: holidays.id })
        .from(holidays)
        .where(and(eq(holidays.location, employee.location), eq(holidays.date, date)))
        .limit(1);
      if (holiday) return 'holiday';
    }
    const [leave] = await this.db
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, employeeId),
          eq(leaveRequests.status, 'approved'),
          lte(leaveRequests.startDate, date),
          gte(leaveRequests.endDate, date),
        ),
      )
      .limit(1);
    if (leave) return 'leave';
    return null;
  }

  /** Working-day capacity in minutes over [from,to] inclusive (weekdays × standard day). */
  private capacityMinutes(from: string, to: string): number {
    let days = 0;
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) days++;
    }
    return days * STANDARD_DAY_MINUTES;
  }

  private assertDraft(week: TimesheetWeek): void {
    if (week.status !== 'draft' && week.status !== 'rejected') {
      throw new AppError(ErrorCode.CONFLICT, `Week is ${week.status}; reopen or create a new week to edit`, HttpStatus.CONFLICT);
    }
  }

  private async assertCanViewEmployee(employeeId: string, actor: AuthenticatedUser): Promise<void> {
    if (employeeId === actor.id) return;
    if (isAdminOrAbove(actor)) return;
    if (await this.employeesService.isManagerOf(actor.id, employeeId)) return;
    throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view this timesheet', HttpStatus.FORBIDDEN);
  }

  private async findWeek(employeeId: string, weekStart: string): Promise<TimesheetWeek | undefined> {
    const [row] = await this.db
      .select()
      .from(timesheetWeeks)
      .where(and(eq(timesheetWeeks.employeeId, employeeId), eq(timesheetWeeks.weekStartDate, weekStart)))
      .limit(1);
    return row;
  }

  private async findWeekOrThrow(employeeId: string, weekStart: string): Promise<TimesheetWeek> {
    const row = await this.findWeek(employeeId, weekStart);
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to resolve timesheet week');
    return row;
  }

  private async getWeekRow(id: string): Promise<TimesheetWeek> {
    const [row] = await this.db.select().from(timesheetWeeks).where(eq(timesheetWeeks.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Timesheet week not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getEntryRow(id: string) {
    const [row] = await this.db.select().from(timesheetEntries).where(eq(timesheetEntries.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Timesheet entry not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private toHours(minutes: number): number {
    return Math.round((minutes / 60) * 100) / 100;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** The Monday (UTC) of the week containing `isoDate`. */
  private mondayOf(isoDate: string): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  private addDays(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private nameExpr() {
    return sql<
      string | null
    >`coalesce(${employees.displayName}, ${employees.firstName} || ' ' || ${employees.lastName})`;
  }

  private async notify(employeeId: string, title: string, body: string, href: string): Promise<void> {
    await this.db.insert(notifications).values({ employeeId, title, body, href });
  }

  private async record(
    actor: AuthenticatedUser,
    action: string,
    target: string,
    data: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    await this.audit.record({ actorType: actor.type, actorId: actor.id, action, target, ...data });
  }
}
