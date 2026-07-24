import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client';
import {
  applications,
  assetCategories,
  assets,
  attendanceRecords,
  departments,
  employees,
  leaveRequests,
  leaveTypes,
  metricSnapshots,
  pipelineStages,
  timesheetEntries,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove, isManagerOrAbove } from '../auth/roles';
import { splitMinutes } from '../timesheets/overtime.util';
import type {
  AttendanceAnalyticsDto,
  AttritionDto,
  ExportDto,
  HeadcountDto,
  LeaveAnalyticsDto,
  RecruitmentFunnelDto,
  UtilizationDto,
} from './dto/analytics.dto';

/** Look-ahead window (days) for warranty / renewal timelines on the assets dashboard. */
const EXPIRY_LOOKAHEAD_DAYS = 90;
/** Bound on org-chart traversal when resolving a manager's team (mirrors EmployeesService). */
const MAX_ORG_DEPTH = 20;

type ScopeMode = 'self' | 'team' | 'org';
/** Resolved scope: `ids === null` means org-wide (no employee filter). */
interface ResolvedScope {
  mode: ScopeMode;
  ids: string[] | null;
}

/** A generic count-by-key aggregation row used across the distribution endpoints. */
interface GroupCount {
  key: string | null;
  label: string;
  count: number;
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // ── Workforce ──────────────────────────────────────────────────────────────

  /** Active headcount grouped by department, employment type, or work location (org-wide). */
  async headcount(query: HeadcountDto): Promise<{ groupBy: string; total: number; groups: GroupCount[] }> {
    const count = sql<number>`cast(count(*) as int)`;
    let groups: GroupCount[];

    if (query.group_by === 'department') {
      const rows = await this.db
        .select({
          key: departments.id,
          label: sql<string>`coalesce(${departments.name}, 'Unassigned')`,
          count,
        })
        .from(employees)
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .where(eq(employees.status, 'active'))
        .groupBy(departments.id, departments.name)
        .orderBy(desc(count));
      groups = rows.map((r) => ({ key: r.key, label: r.label, count: r.count }));
    } else {
      const col = query.group_by === 'type' ? employees.employmentType : employees.workLocation;
      const rows = await this.db
        .select({ key: col, count })
        .from(employees)
        .where(eq(employees.status, 'active'))
        .groupBy(col)
        .orderBy(desc(count));
      groups = rows.map((r) => ({ key: r.key, label: r.key, count: r.count }));
    }

    const total = groups.reduce((sum, g) => sum + g.count, 0);
    return { groupBy: query.group_by, total, groups };
  }

  /** Joiners vs exits over a window, with a simple attrition rate over the opening headcount. */
  async attrition(query: AttritionDto) {
    const to = query.to ?? this.today();
    const from = query.from ?? this.yearStart(to);

    const joiners = await this.countEmployees(
      and(gte(employees.dateOfJoining, from), lte(employees.dateOfJoining, to)),
    );
    const exits = await this.countEmployees(
      and(
        isNotNull(employees.dateOfExit),
        gte(employees.dateOfExit, from),
        lte(employees.dateOfExit, to),
      ),
    );
    // Headcount present at the start of the window: joined on/before `from` and not yet exited then.
    const startHeadcount = await this.countEmployees(
      and(
        lte(employees.dateOfJoining, from),
        sql`(${employees.dateOfExit} is null or ${employees.dateOfExit} > ${from})`,
      ),
    );
    const endHeadcount = startHeadcount + joiners - exits;
    const denom = (startHeadcount + endHeadcount) / 2 || startHeadcount || 1;
    const attritionRate = this.round((exits / denom) * 100);

    return { from, to, joiners, exits, startHeadcount, endHeadcount, attritionRate };
  }

  // ── Time & attendance ───────────────────────────────────────────────────────

  /** Approved-leave utilization by leave type over a period, RBAC-scoped to the caller. */
  async leave(query: LeaveAnalyticsDto, actor: AuthenticatedUser) {
    const { from, to } = this.periodRange(query.period, 'year');
    const scope = await this.resolveScope(actor, query.scope);

    const filters: SQL[] = [
      eq(leaveRequests.status, 'approved'),
      gte(leaveRequests.startDate, from),
      lte(leaveRequests.startDate, to),
    ];
    if (query.type) filters.push(eq(leaveTypes.code, query.type));
    const scoped = this.scopeFilter(leaveRequests.employeeId, scope);
    if (scoped) filters.push(scoped);

    const rows = await this.db
      .select({
        leaveTypeId: leaveTypes.id,
        code: leaveTypes.code,
        name: leaveTypes.name,
        totalDays: sql<number>`cast(coalesce(sum(${leaveRequests.daysCount}), 0) as double precision)`,
        requests: sql<number>`cast(count(*) as int)`,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(...filters))
      .groupBy(leaveTypes.id, leaveTypes.code, leaveTypes.name)
      .orderBy(desc(sql`sum(${leaveRequests.daysCount})`));

    const totalDays = this.round(rows.reduce((sum, r) => sum + Number(r.totalDays), 0));
    return { period: this.periodLabel(query.period, 'year'), scope: scope.mode, from, to, totalDays, byType: rows };
  }

  /** Presence trend + WFH split over a month, RBAC-scoped to the caller. */
  async attendance(query: AttendanceAnalyticsDto, actor: AuthenticatedUser) {
    const { from, to } = this.periodRange(query.period, 'month');
    const scope = await this.resolveScope(actor, query.scope);

    const base: SQL[] = [gte(attendanceRecords.date, from), lte(attendanceRecords.date, to)];
    const scoped = this.scopeFilter(attendanceRecords.employeeId, scope);
    if (scoped) base.push(scoped);
    const where = and(...base);
    const count = sql<number>`cast(count(*) as int)`;

    const byStatus = await this.db
      .select({ key: attendanceRecords.status, count })
      .from(attendanceRecords)
      .where(where)
      .groupBy(attendanceRecords.status)
      .orderBy(desc(count));
    const byWorkMode = await this.db
      .select({ key: attendanceRecords.workMode, count })
      .from(attendanceRecords)
      .where(where)
      .groupBy(attendanceRecords.workMode)
      .orderBy(desc(count));

    const totalRecords = byStatus.reduce((sum, r) => sum + r.count, 0);
    return {
      period: this.periodLabel(query.period, 'month'),
      scope: scope.mode,
      from,
      to,
      totalRecords,
      byStatus: byStatus.map((r) => ({ status: r.key, count: r.count })),
      byWorkMode: byWorkMode.map((r) => ({ workMode: r.key, count: r.count })),
    };
  }

  /** Billable vs non-billable effort from approved timesheets over a window, RBAC-scoped. */
  async utilization(query: UtilizationDto, actor: AuthenticatedUser) {
    const to = query.to ?? this.today();
    const from = query.from ?? this.monthStart(to);
    const scope = await this.resolveScope(actor, query.scope);

    const filters: SQL[] = [
      eq(timesheetEntries.status, 'approved'),
      gte(timesheetEntries.workDate, from),
      lte(timesheetEntries.workDate, to),
    ];
    const scoped = this.scopeFilter(timesheetEntries.employeeId, scope);
    if (scoped) filters.push(scoped);

    const [row] = await this.db
      .select({
        billableMinutes: sql<number>`cast(coalesce(sum(case when ${timesheetEntries.billable} then ${timesheetEntries.minutes} else 0 end), 0) as int)`,
        nonBillableMinutes: sql<number>`cast(coalesce(sum(case when ${timesheetEntries.billable} then 0 else ${timesheetEntries.minutes} end), 0) as int)`,
      })
      .from(timesheetEntries)
      .where(and(...filters));

    const billable = row?.billableMinutes ?? 0;
    const nonBillable = row?.nonBillableMinutes ?? 0;
    const total = billable + nonBillable;
    return {
      from,
      to,
      scope: scope.mode,
      billableHours: this.hours(billable),
      nonBillableHours: this.hours(nonBillable),
      totalHours: this.hours(total),
      utilizationPct: total > 0 ? this.round((billable / total) * 100) : 0,
    };
  }

  /**
   * Per-employee regular (Mon–Sat) vs overtime (Sunday) hours from approved timesheets over a
   * window, RBAC-scoped. Entries are summed per employee per day in SQL; the weekday split happens
   * in JS via the shared `splitMinutes`/`isOvertimeDate` predicate (overtime.util.ts) so "what
   * counts as overtime" has exactly one definition across the app.
   */
  async hoursByEmployee(query: UtilizationDto, actor: AuthenticatedUser) {
    const to = query.to ?? this.today();
    const from = query.from ?? this.monthStart(to);
    const scope = await this.resolveScope(actor, query.scope);

    const filters: SQL[] = [
      eq(timesheetEntries.status, 'approved'),
      gte(timesheetEntries.workDate, from),
      lte(timesheetEntries.workDate, to),
    ];
    const scoped = this.scopeFilter(timesheetEntries.employeeId, scope);
    if (scoped) filters.push(scoped);

    const rows = await this.db
      .select({
        employeeId: timesheetEntries.employeeId,
        employeeName: this.nameExpr(),
        workDate: timesheetEntries.workDate,
        minutes: sql<number>`cast(coalesce(sum(${timesheetEntries.minutes}), 0) as int)`,
      })
      .from(timesheetEntries)
      .innerJoin(employees, eq(employees.id, timesheetEntries.employeeId))
      .where(and(...filters))
      .groupBy(
        timesheetEntries.employeeId,
        employees.displayName,
        employees.firstName,
        employees.lastName,
        timesheetEntries.workDate,
      );

    const byEmployee = new Map<string, { employeeName: string | null; days: { workDate: string; minutes: number }[] }>();
    for (const r of rows) {
      const bucket = byEmployee.get(r.employeeId);
      if (bucket) bucket.days.push({ workDate: r.workDate, minutes: r.minutes });
      else byEmployee.set(r.employeeId, { employeeName: r.employeeName, days: [{ workDate: r.workDate, minutes: r.minutes }] });
    }

    const employeeRows = [...byEmployee.entries()].map(([employeeId, { employeeName, days }]) => {
      const { regular, overtime } = splitMinutes(days);
      return {
        employeeId,
        employeeName,
        regularHours: this.hours(regular),
        overtimeHours: this.hours(overtime),
        totalHours: this.hours(regular + overtime),
      };
    });
    employeeRows.sort((a, b) => b.totalHours - a.totalHours);

    return { from, to, scope: scope.mode, employees: employeeRows };
  }

  // ── Recruitment ───────────────────────────────────────────────────────────────

  /** Pipeline funnel (stage + status distribution) and average time-to-hire, optionally per opening. */
  async recruitmentFunnel(query: RecruitmentFunnelDto) {
    const openingFilter = query.opening ? eq(applications.jobOpeningId, query.opening) : undefined;
    const count = sql<number>`cast(count(*) as int)`;

    const byStage = await this.db
      .select({
        stageId: pipelineStages.id,
        stageName: pipelineStages.name,
        sortOrder: pipelineStages.sortOrder,
        count,
      })
      .from(applications)
      .leftJoin(pipelineStages, eq(pipelineStages.id, applications.currentStageId))
      .where(openingFilter)
      .groupBy(pipelineStages.id, pipelineStages.name, pipelineStages.sortOrder)
      .orderBy(asc(pipelineStages.sortOrder));

    const byStatus = await this.db
      .select({ status: applications.status, count })
      .from(applications)
      .where(openingFilter)
      .groupBy(applications.status);

    const [tth] = await this.db
      .select({
        days: sql<
          number | null
        >`cast(avg(extract(epoch from (${applications.updatedAt} - ${applications.appliedAt})) / 86400.0) as double precision)`,
      })
      .from(applications)
      .where(and(eq(applications.status, 'hired'), openingFilter));

    const total = byStatus.reduce((sum, r) => sum + r.count, 0);
    return {
      opening: query.opening ?? null,
      total,
      timeToHireDays: tth?.days == null ? null : this.round(tth.days),
      byStage,
      byStatus,
    };
  }

  // ── Assets ────────────────────────────────────────────────────────────────────

  /** Inventory distribution by status + category, and upcoming warranty / licence-renewal timelines. */
  async assets() {
    const count = sql<number>`cast(count(*) as int)`;
    const cutoff = this.daysFromNow(EXPIRY_LOOKAHEAD_DAYS);

    const byStatus = await this.db
      .select({ status: assets.status, count })
      .from(assets)
      .groupBy(assets.status)
      .orderBy(desc(count));

    const byCategory = await this.db
      .select({ categoryId: assetCategories.id, categoryName: assetCategories.name, count })
      .from(assets)
      .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
      .groupBy(assetCategories.id, assetCategories.name)
      .orderBy(desc(count));

    const upcomingRenewals = await this.db
      .select({
        id: assets.id,
        assetTag: assets.assetTag,
        vendor: assets.vendor,
        renewalDate: assets.renewalDate,
        seatsTotal: assets.seatsTotal,
        seatsUsed: assets.seatsUsed,
      })
      .from(assets)
      .where(and(isNotNull(assets.renewalDate), lte(assets.renewalDate, cutoff)))
      .orderBy(asc(assets.renewalDate));

    const upcomingWarranties = await this.db
      .select({
        id: assets.id,
        assetTag: assets.assetTag,
        make: assets.make,
        model: assets.model,
        warrantyExpiry: assets.warrantyExpiry,
      })
      .from(assets)
      .where(and(isNotNull(assets.warrantyExpiry), lte(assets.warrantyExpiry, cutoff)))
      .orderBy(asc(assets.warrantyExpiry));

    const totalAssets = byStatus.reduce((sum, r) => sum + r.count, 0);
    return { totalAssets, byStatus, byCategory, upcomingRenewals, upcomingWarranties };
  }

  // ── Export (CSV) ────────────────────────────────────────────────────────────

  /** Build a CSV document for one report. Org-wide (leadership) — see controller RBAC. */
  async exportCsv(query: ExportDto, actor: AuthenticatedUser): Promise<{ filename: string; csv: string }> {
    if (query.format !== 'csv') {
      throw new AppError(ErrorCode.NOT_IMPLEMENTED, `Export format '${query.format}' is not supported`);
    }
    let columns: string[];
    let rows: (string | number | null)[][];

    switch (query.report) {
      case 'headcount': {
        const data = await this.headcount({ group_by: query.group_by ?? 'department' });
        columns = ['group', 'count'];
        rows = data.groups.map((g) => [g.label, g.count]);
        break;
      }
      case 'attrition': {
        const d = await this.attrition({ from: query.from, to: query.to });
        columns = ['from', 'to', 'joiners', 'exits', 'start_headcount', 'end_headcount', 'attrition_rate_pct'];
        rows = [[d.from, d.to, d.joiners, d.exits, d.startHeadcount, d.endHeadcount, d.attritionRate]];
        break;
      }
      case 'leave': {
        const d = await this.leave({ period: query.period, scope: 'org' }, actor);
        columns = ['leave_type', 'code', 'total_days', 'requests'];
        rows = d.byType.map((t) => [t.name, t.code, Number(t.totalDays), t.requests]);
        break;
      }
      case 'attendance': {
        const d = await this.attendance({ period: query.period, scope: 'org' }, actor);
        columns = ['metric', 'key', 'count'];
        rows = [
          ...d.byStatus.map((s) => ['status', s.status, s.count] as (string | number)[]),
          ...d.byWorkMode.map((w) => ['work_mode', w.workMode, w.count] as (string | number)[]),
        ];
        break;
      }
      case 'utilization': {
        const d = await this.utilization({ from: query.from, to: query.to, scope: 'org' }, actor);
        columns = ['from', 'to', 'billable_hours', 'non_billable_hours', 'total_hours', 'utilization_pct'];
        rows = [[d.from, d.to, d.billableHours, d.nonBillableHours, d.totalHours, d.utilizationPct]];
        break;
      }
      case 'recruitment-funnel': {
        const d = await this.recruitmentFunnel({ opening: query.opening });
        columns = ['stage', 'count'];
        rows = d.byStage.map((s) => [s.stageName ?? 'Unstaged', s.count]);
        break;
      }
      case 'assets': {
        const d = await this.assets();
        columns = ['status', 'count'];
        rows = d.byStatus.map((s) => [s.status, s.count]);
        break;
      }
    }

    return { filename: `${query.report}.csv`, csv: this.toCsv(columns, rows) };
  }

  // ── Metric snapshots (trend persistence) ──────────────────────────────────────

  /** Read persisted trend snapshots for a metric (chronological). */
  listSnapshots(metricKey: string) {
    return this.db
      .select()
      .from(metricSnapshots)
      .where(eq(metricSnapshots.metricKey, metricKey))
      .orderBy(asc(metricSnapshots.period), asc(metricSnapshots.dimensionKey));
  }

  /**
   * Capture point-in-time snapshots for the current period. Idempotent: rows are unique per
   * (metricKey, dimensionKey, period), so re-runs (scheduled + manual) do not duplicate.
   * Runs monthly on the 1st at 02:00; also callable by an admin on demand.
   */
  @Cron('0 2 1 * *')
  async captureSnapshots(): Promise<{ captured: number; period: string }> {
    const period = this.today().slice(0, 7); // YYYY-MM
    const values: (typeof metricSnapshots.$inferInsert)[] = [];

    // Org headcount + per-department headcount.
    const hc = await this.headcount({ group_by: 'department' });
    values.push({ metricKey: 'headcount', dimension: {}, dimensionKey: '', period, value: hc.total });
    for (const g of hc.groups) {
      values.push({
        metricKey: 'headcount',
        dimension: { department: g.label },
        dimensionKey: `department:${g.label}`,
        period,
        value: g.count,
      });
    }

    // Org utilization for the month-to-date.
    const util = await this.utilization({ scope: 'org' }, this.systemActor());
    values.push({
      metricKey: 'avg_utilization',
      dimension: {},
      dimensionKey: '',
      period,
      value: util.utilizationPct,
    });

    await this.db.insert(metricSnapshots).values(values).onConflictDoNothing();
    return { captured: values.length, period };
  }

  // ── Scope resolution (RBAC) ───────────────────────────────────────────────────

  /**
   * Downgrade a requested scope to the caller's ceiling: an employee is always self-only, a manager
   * can reach their team, and only HR/Admin sees org-wide. Defaults to the caller's ceiling.
   */
  private async resolveScope(actor: AuthenticatedUser, requested?: ScopeMode): Promise<ResolvedScope> {
    const admin = isAdminOrAbove(actor);
    const manager = isManagerOrAbove(actor);
    let mode: ScopeMode = requested ?? (admin ? 'org' : manager ? 'team' : 'self');
    if (mode === 'org' && !admin) mode = manager ? 'team' : 'self';
    if (mode === 'team' && !manager) mode = 'self';

    if (mode === 'org') return { mode, ids: null };
    if (mode === 'self') return { mode, ids: [actor.id] };
    return { mode, ids: await this.teamEmployeeIds(actor.id) };
  }

  private scopeFilter(column: AnyPgColumn, scope: ResolvedScope): SQL | undefined {
    if (scope.ids === null) return undefined;
    // Empty team → an unmatchable id so the query returns nothing rather than everything.
    return inArray(column, scope.ids.length ? scope.ids : ['00000000-0000-0000-0000-000000000000']);
  }

  /** A manager's team: themselves plus all (in)direct reports, via a bounded downward BFS. */
  private async teamEmployeeIds(managerId: string): Promise<string[]> {
    const collected = new Set<string>([managerId]);
    let frontier = [managerId];
    for (let depth = 0; depth < MAX_ORG_DEPTH && frontier.length; depth++) {
      const reports = await this.db
        .select({ id: employees.id })
        .from(employees)
        .where(inArray(employees.managerId, frontier));
      const next: string[] = [];
      for (const r of reports) {
        if (!collected.has(r.id)) {
          collected.add(r.id);
          next.push(r.id);
        }
      }
      frontier = next;
    }
    return [...collected];
  }

  // ── internals ──────────────────────────────────────────────────────────────────

  private async countEmployees(where: SQL | undefined): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(employees)
      .where(where);
    return row?.count ?? 0;
  }

  private toCsv(columns: string[], rows: (string | number | null)[][]): string {
    const escape = (v: string | number | null): string => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [columns.join(','), ...rows.map((r) => r.map(escape).join(','))];
    return lines.join('\n');
  }

  /** A synthetic actor for scheduled jobs (org-wide scope). */
  private systemActor(): AuthenticatedUser {
    return {
      id: 'system',
      uid: 'system',
      roles: ['super_admin'],
      permissions: [],
      scope: null,
      sid: 'system',
      type: 'admin',
    };
  }

  /** Prefer the employee's display name, falling back to first + last (mirrors TimesheetsService). */
  private nameExpr() {
    return sql<string | null>`coalesce(${employees.displayName}, ${employees.firstName} || ' ' || ${employees.lastName})`;
  }

  private hours(minutes: number): number {
    return this.round(minutes / 60);
  }

  private round(n: number): number {
    return Math.round(n * 100) / 100;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private yearStart(dateStr: string): string {
    return `${dateStr.slice(0, 4)}-01-01`;
  }

  private monthStart(dateStr: string): string {
    return `${dateStr.slice(0, 7)}-01`;
  }

  private daysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /** Resolve a `YYYY` / `YYYY-MM` period to a date range; default = the current year or month. */
  private periodRange(period: string | undefined, unit: 'year' | 'month'): { from: string; to: string } {
    const now = this.today();
    if (!period) {
      return unit === 'year'
        ? { from: `${now.slice(0, 4)}-01-01`, to: `${now.slice(0, 4)}-12-31` }
        : this.monthBounds(Number(now.slice(0, 4)), Number(now.slice(5, 7)));
    }
    if (period.length === 4) {
      return { from: `${period}-01-01`, to: `${period}-12-31` };
    }
    return this.monthBounds(Number(period.slice(0, 4)), Number(period.slice(5, 7)));
  }

  private monthBounds(year: number, month: number): { from: string; to: string } {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const mm = String(month).padStart(2, '0');
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
  }

  private periodLabel(period: string | undefined, unit: 'year' | 'month'): string {
    const now = this.today();
    return period ?? (unit === 'year' ? now.slice(0, 4) : now.slice(0, 7));
  }
}
