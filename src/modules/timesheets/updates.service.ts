import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  employees,
  projectAllocations,
  projectTasks,
  projects,
  timesheetEntries,
  updateComments,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';
import type { CreateCommentDto, ListUpdatesDto, MissingUpdatesDto } from './dto/timesheets.dto';

/**
 * Daily updates. The update IS the timesheet entry's task_description — there is no separate
 * update record. The feed reads entries REGARDLESS of week status (draft included), because a
 * manager who has to wait for the weekly submit->approve cycle sees Monday's update next week.
 */
@Injectable()
export class UpdatesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly projects: ProjectsService,
  ) {}

  private toHours(minutes: number): number {
    return Math.round((minutes / 60) * 100) / 100;
  }

  async listProjectUpdates(projectId: string, query: ListUpdatesDto, actor: AuthenticatedUser) {
    // getProjectRow BEFORE assertCanViewProject — canViewProject short-circuits true for an
    // admin regardless of whether the project id exists, so a read that only checked membership
    // would hand an admin a silent 200-with-empty-array instead of a 404 for a bad id. Same gap
    // Tasks 3 and 4 closed in listMilestones/listTasks.
    await this.projects.getProjectRow(projectId);
    await this.projects.assertCanViewProject(projectId, actor);

    const filters: SQL[] = [eq(timesheetEntries.projectId, projectId)];
    if (query.from) filters.push(gte(timesheetEntries.workDate, query.from));
    if (query.to) filters.push(lte(timesheetEntries.workDate, query.to));

    // No join to timesheet_weeks and no filter on any status column here — deliberately. The
    // feed must surface a draft week's entries today, not after submit -> approve.
    const rows = await this.db
      .select({
        id: timesheetEntries.id,
        employeeId: timesheetEntries.employeeId,
        employeeName: this.nameExpr(),
        workDate: timesheetEntries.workDate,
        minutes: timesheetEntries.minutes,
        billable: timesheetEntries.billable,
        taskDescription: timesheetEntries.taskDescription,
        taskId: timesheetEntries.taskId,
        taskTitle: projectTasks.title,
      })
      .from(timesheetEntries)
      .innerJoin(employees, eq(employees.id, timesheetEntries.employeeId))
      .leftJoin(projectTasks, eq(projectTasks.id, timesheetEntries.taskId))
      .where(and(...filters))
      .orderBy(desc(timesheetEntries.workDate), asc(employees.displayName));

    return this.withCommentCounts(rows);
  }

  /** Comment counts as a SEPARATE grouped query merged in JS — never a correlated subquery. */
  private async withCommentCounts<T extends { id: string; minutes: number }>(rows: T[]) {
    const ids = rows.map((r) => r.id);
    const counts =
      ids.length === 0
        ? []
        : await this.db
            .select({
              entryId: updateComments.entryId,
              count: sql<number>`cast(count(*) as int)`,
            })
            .from(updateComments)
            .where(inArray(updateComments.entryId, ids))
            .groupBy(updateComments.entryId);
    const byEntry = new Map(counts.map((c) => [c.entryId, c.count]));
    return rows.map(({ minutes, ...rest }) => ({
      ...rest,
      hours: this.toHours(minutes),
      commentCount: byEntry.get(rest.id) ?? 0,
    }));
  }

  /** Actively-allocated members with no entry on the date. */
  async missingUpdates(projectId: string, query: MissingUpdatesDto, actor: AuthenticatedUser) {
    // Same existence-check discipline as listProjectUpdates — see the comment there.
    await this.projects.getProjectRow(projectId);
    await this.projects.assertCanViewProject(projectId, actor);
    const onDate = query.date ?? new Date().toISOString().slice(0, 10);

    const members = await this.db
      .select({ employeeId: projectAllocations.employeeId, employeeName: this.nameExpr() })
      .from(projectAllocations)
      .innerJoin(employees, eq(employees.id, projectAllocations.employeeId))
      .where(
        and(eq(projectAllocations.projectId, projectId), eq(projectAllocations.isActive, true)),
      );

    const updated = await this.db
      .select({ employeeId: timesheetEntries.employeeId })
      .from(timesheetEntries)
      .where(and(eq(timesheetEntries.projectId, projectId), eq(timesheetEntries.workDate, onDate)));
    const done = new Set(updated.map((u) => u.employeeId));

    return {
      date: onDate,
      allocated: members.length,
      updated: members.filter((m) => done.has(m.employeeId)).length,
      missing: members.filter((m) => !done.has(m.employeeId)),
    };
  }

  /**
   * The actor's OWN updates across every project they have ever worked on — NO membership
   * check. A person's updates are their own record of work; leaving a project must never take
   * their history with it. Membership gates the project, never a person from their own history.
   */
  async listMyUpdates(query: ListUpdatesDto, actor: AuthenticatedUser) {
    const filters: SQL[] = [eq(timesheetEntries.employeeId, actor.id)];
    if (query.from) filters.push(gte(timesheetEntries.workDate, query.from));
    if (query.to) filters.push(lte(timesheetEntries.workDate, query.to));

    const rows = await this.db
      .select({
        id: timesheetEntries.id,
        employeeId: timesheetEntries.employeeId,
        employeeName: this.nameExpr(),
        projectId: timesheetEntries.projectId,
        projectName: projects.name,
        workDate: timesheetEntries.workDate,
        minutes: timesheetEntries.minutes,
        billable: timesheetEntries.billable,
        taskDescription: timesheetEntries.taskDescription,
        taskId: timesheetEntries.taskId,
        taskTitle: projectTasks.title,
      })
      .from(timesheetEntries)
      .innerJoin(employees, eq(employees.id, timesheetEntries.employeeId))
      .innerJoin(projects, eq(projects.id, timesheetEntries.projectId))
      .leftJoin(projectTasks, eq(projectTasks.id, timesheetEntries.taskId))
      .where(and(...filters))
      .orderBy(desc(timesheetEntries.workDate));

    return this.withCommentCounts(rows);
  }

  async listComments(entryId: string, actor: AuthenticatedUser) {
    const projectId = await this.entryProjectId(entryId);
    await this.projects.assertCanViewProject(projectId, actor);
    return this.db
      .select({
        id: updateComments.id,
        entryId: updateComments.entryId,
        authorEmployeeId: updateComments.authorEmployeeId,
        authorName: this.nameExpr(),
        body: updateComments.body,
        createdAt: updateComments.createdAt,
      })
      .from(updateComments)
      .innerJoin(employees, eq(employees.id, updateComments.authorEmployeeId))
      .where(eq(updateComments.entryId, entryId))
      .orderBy(asc(updateComments.createdAt));
  }

  /** Any project member may comment — commenting in place is the point. */
  async addComment(entryId: string, dto: CreateCommentDto, actor: AuthenticatedUser) {
    const projectId = await this.entryProjectId(entryId);
    await this.projects.assertCanViewProject(projectId, actor);
    const [row] = await this.db
      .insert(updateComments)
      .values({ entryId, authorEmployeeId: actor.id, body: dto.body })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to add comment');
    return row;
  }

  /** entryId is looked up unconditionally — its non-existence must 404, same as every other row lookup here. */
  private async entryProjectId(entryId: string): Promise<string> {
    const [entry] = await this.db
      .select({ projectId: timesheetEntries.projectId })
      .from(timesheetEntries)
      .where(eq(timesheetEntries.id, entryId));
    if (!entry) throw new AppError(ErrorCode.NOT_FOUND, 'Update not found', HttpStatus.NOT_FOUND);
    return entry.projectId;
  }

  private nameExpr() {
    return sql<
      string | null
    >`coalesce(${employees.displayName}, ${employees.firstName} || ' ' || ${employees.lastName})`;
  }
}
