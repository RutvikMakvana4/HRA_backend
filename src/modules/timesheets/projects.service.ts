import { forwardRef, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client';
import {
  clients,
  employees,
  projectAllocations,
  projectMilestones,
  projectTasks,
  projects,
  timesheetEntries,
  updateComments,
  type Client,
  type Project,
  type ProjectAllocation,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode, pgErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove } from '../auth/roles';
import { EmployeesService } from '../employees/employees.service';
import { TimesheetsService } from './timesheets.service';
import type {
  AllocationReportDto,
  CreateAllocationDto,
  CreateClientDto,
  CreateMilestoneDto,
  CreateProjectDto,
  CreateTaskDto,
  ListAllocationsDto,
  ListProjectsDto,
  ListTasksDto,
  LogTaskWorkDto,
  MyTasksQueryDto,
  UpdateClientDto,
  UpdateMilestoneDto,
  UpdateProgressDto,
  UpdateProjectDto,
  UpdateTaskDto,
} from './dto/timesheets.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly employeesService: EmployeesService,
    @Inject(forwardRef(() => TimesheetsService)) private readonly timesheetsService: TimesheetsService,
  ) {}

  // ── Clients ────────────────────────────────────────────────────────────────

  listClients(): Promise<Client[]> {
    return this.db.select().from(clients).orderBy(asc(clients.name));
  }

  async createClient(dto: CreateClientDto, actor: AuthenticatedUser): Promise<Client> {
    const [row] = await this.mapWrite(() => this.db.insert(clients).values(dto).returning());
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create client');
    await this.record(actor, 'client.create', `client:${row.id}`, { after: { ...row } });
    return row;
  }

  async updateClient(id: string, dto: UpdateClientDto, actor: AuthenticatedUser): Promise<Client> {
    await this.getClientRow(id);
    const [row] = await this.mapWrite(() =>
      this.db
        .update(clients)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(clients.id, id))
        .returning(),
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update client');
    await this.record(actor, 'client.update', `client:${id}`, { after: { ...row } });
    return row;
  }

  // ── Projects ───────────────────────────────────────────────────────────────

  async listProjects(query: ListProjectsDto) {
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(projects.status, query.status));
    if (query.clientId) filters.push(eq(projects.clientId, query.clientId));
    if (query.type) filters.push(eq(projects.type, query.type));

    const rows = await this.db
      .select({
        id: projects.id,
        clientId: projects.clientId,
        clientName: clients.name,
        name: projects.name,
        code: projects.code,
        type: projects.type,
        defaultBillable: projects.defaultBillable,
        status: projects.status,
        startDate: projects.startDate,
        endDate: projects.endDate,
        pmEmployeeId: projects.pmEmployeeId,
        pmName: this.nameExpr(),
        createdAt: projects.createdAt,
      })
      .from(projects)
      .leftJoin(clients, eq(clients.id, projects.clientId))
      .leftJoin(employees, eq(employees.id, projects.pmEmployeeId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(projects.name));

    // Active-allocation counts, grouped — a flat aggregate, NOT a correlated subquery.
    const counts = await this.db
      .select({
        projectId: projectAllocations.projectId,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(projectAllocations)
      .where(eq(projectAllocations.isActive, true))
      .groupBy(projectAllocations.projectId);
    const countByProject = new Map(counts.map((c) => [c.projectId, c.count]));

    return rows.map((r) => ({ ...r, allocationCount: countByProject.get(r.id) ?? 0 }));
  }

  async createProject(dto: CreateProjectDto, actor: AuthenticatedUser): Promise<Project> {
    if (dto.clientId) await this.getClientRow(dto.clientId);
    if (dto.pmEmployeeId) await this.employeesService.ensureExists(dto.pmEmployeeId);
    const [row] = await this.mapWrite(() =>
      this.db
        .insert(projects)
        .values({
          clientId: dto.clientId ?? null,
          name: dto.name,
          code: dto.code,
          type: dto.type,
          defaultBillable: dto.defaultBillable,
          status: dto.status,
          startDate: dto.startDate ?? null,
          endDate: dto.endDate ?? null,
          pmEmployeeId: dto.pmEmployeeId ?? null,
        })
        .returning(),
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create project');
    await this.record(actor, 'project.create', `project:${row.id}`, { after: { ...row } });
    return row;
  }

  async updateProject(id: string, dto: UpdateProjectDto, actor: AuthenticatedUser): Promise<Project> {
    const before = await this.getProjectRow(id);
    if (dto.clientId) await this.getClientRow(dto.clientId);
    if (dto.pmEmployeeId) await this.employeesService.ensureExists(dto.pmEmployeeId);
    const [row] = await this.mapWrite(() =>
      this.db
        .update(projects)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(projects.id, id))
        .returning(),
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update project');
    await this.record(actor, 'project.update', `project:${id}`, {
      before: { status: before.status, pmEmployeeId: before.pmEmployeeId },
      after: { status: row.status, pmEmployeeId: row.pmEmployeeId },
    });
    return row;
  }

  // ── Allocations ──────────────────────────────────────────────────────────────

  async listAllocations(projectId: string, actor: AuthenticatedUser) {
    // Same existence-check gap listMilestones/listTasks close: canViewProject short-circuits
    // true for an admin regardless of whether the project id exists, so a read that only asserts
    // view access would hand an admin a silent 200 with an empty array for a bad id instead of a
    // 404. getProjectRow closes that before membership is even evaluated.
    await this.getProjectRow(projectId);
    await this.assertCanViewProject(projectId, actor);
    return this.db
      .select({
        id: projectAllocations.id,
        projectId: projectAllocations.projectId,
        employeeId: projectAllocations.employeeId,
        employeeName: this.nameExpr(),
        roleOnProject: projectAllocations.roleOnProject,
        allocationPct: projectAllocations.allocationPct,
        startDate: projectAllocations.startDate,
        endDate: projectAllocations.endDate,
        isActive: projectAllocations.isActive,
      })
      .from(projectAllocations)
      .innerJoin(employees, eq(employees.id, projectAllocations.employeeId))
      .where(and(eq(projectAllocations.projectId, projectId), eq(projectAllocations.isActive, true)))
      .orderBy(asc(projectAllocations.isActive));
  }

  /** Assign an employee to a project. Returns the row plus an over-allocation warning (>100%). */
  async createAllocation(projectId: string, dto: CreateAllocationDto, actor: AuthenticatedUser) {
    const project = await this.getProjectRow(projectId);
    await this.assertCanManageProject(project, actor);
    await this.employeesService.ensureExists(dto.employeeId);

    const [row] = await this.db
      .insert(projectAllocations)
      .values({
        projectId,
        employeeId: dto.employeeId,
        roleOnProject: dto.roleOnProject ?? null,
        allocationPct: dto.allocationPct,
        startDate: dto.startDate ?? null,
        endDate: dto.endDate ?? null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create allocation');

    await this.record(actor, 'project_allocation.create', `project_allocation:${row.id}`, {
      after: { projectId, employeeId: dto.employeeId, allocationPct: dto.allocationPct },
    });

    const totalPct = await this.activeAllocationPct(dto.employeeId);
    const warning = totalPct > 100 ? `Employee is over-allocated at ${totalPct}% across active projects` : null;
    return { ...row, warning };
  }

  /** Soft-remove an allocation: end-date today and mark inactive (PRD — DELETE is soft). */
  async removeAllocation(id: string, actor: AuthenticatedUser) {
    const alloc = await this.getAllocationRow(id);
    const project = await this.getProjectRow(alloc.projectId);
    await this.assertCanManageProject(project, actor);

    const today = new Date().toISOString().slice(0, 10);
    const [row] = await this.db
      .update(projectAllocations)
      .set({ isActive: false, endDate: alloc.endDate ?? today, updatedAt: new Date() })
      .where(eq(projectAllocations.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to remove allocation');
    await this.record(actor, 'project_allocation.remove', `project_allocation:${id}`, {
      before: { isActive: true },
      after: { isActive: false },
    });
    return { id: row.id, isActive: row.isActive, endDate: row.endDate };
  }

  /** The scoped employees' active allocations, with project_name. Default scope = the caller. */
  async listMyAllocations(query: ListAllocationsDto, actor: AuthenticatedUser) {
    const employeeIds = await this.employeesService.scopeEmployeeIds(query.scope, actor);
    if (employeeIds.length === 0) return [];
    return this.db
      .select({
        id: projectAllocations.id,
        projectId: projectAllocations.projectId,
        projectName: projects.name,
        employeeId: projectAllocations.employeeId,
        employeeName: this.nameExpr(),
        roleOnProject: projectAllocations.roleOnProject,
        allocationPct: projectAllocations.allocationPct,
        startDate: projectAllocations.startDate,
        endDate: projectAllocations.endDate,
        isActive: projectAllocations.isActive,
      })
      .from(projectAllocations)
      .innerJoin(projects, eq(projects.id, projectAllocations.projectId))
      .innerJoin(employees, eq(employees.id, projectAllocations.employeeId))
      .where(and(inArray(projectAllocations.employeeId, employeeIds), eq(projectAllocations.isActive, true)))
      .orderBy(asc(projects.name));
  }

  // ── Allocation report ────────────────────────────────────────────────────────

  /** Who is on what, with per-employee total % and an over-allocated flag. HR/Delivery view. */
  async allocationReport(query: AllocationReportDto, actor: AuthenticatedUser) {
    const employeeIds = await this.employeesService.scopeEmployeeIds(query.scope, actor);
    if (employeeIds.length === 0) return { date: query.date ?? new Date().toISOString().slice(0, 10), employees: [] };
    const onDate = query.date ?? new Date().toISOString().slice(0, 10);

    const rows = await this.db
      .select({
        employeeId: projectAllocations.employeeId,
        employeeName: this.nameExpr(),
        projectId: projectAllocations.projectId,
        projectName: projects.name,
        roleOnProject: projectAllocations.roleOnProject,
        allocationPct: projectAllocations.allocationPct,
      })
      .from(projectAllocations)
      .innerJoin(employees, eq(employees.id, projectAllocations.employeeId))
      .innerJoin(projects, eq(projects.id, projectAllocations.projectId))
      .where(
        and(
          inArray(projectAllocations.employeeId, employeeIds),
          eq(projectAllocations.isActive, true),
          sql`(${projectAllocations.startDate} is null or ${projectAllocations.startDate} <= ${onDate})`,
          sql`(${projectAllocations.endDate} is null or ${projectAllocations.endDate} >= ${onDate})`,
        ),
      )
      .orderBy(asc(projectAllocations.employeeId));

    const byEmployee = new Map<
      string,
      {
        employeeId: string;
        employeeName: string | null;
        totalPct: number;
        overAllocated: boolean;
        projects: { projectId: string; projectName: string; roleOnProject: string | null; allocationPct: number }[];
      }
    >();
    for (const r of rows) {
      let bucket = byEmployee.get(r.employeeId);
      if (!bucket) {
        bucket = { employeeId: r.employeeId, employeeName: r.employeeName, totalPct: 0, overAllocated: false, projects: [] };
        byEmployee.set(r.employeeId, bucket);
      }
      bucket.projects.push({
        projectId: r.projectId,
        projectName: r.projectName,
        roleOnProject: r.roleOnProject,
        allocationPct: r.allocationPct,
      });
      bucket.totalPct += r.allocationPct;
      bucket.overAllocated = bucket.totalPct > 100;
    }
    return { date: onDate, employees: [...byEmployee.values()] };
  }

  // ── Summary ──────────────────────────────────────────────────────────────────

  /**
   * Every aggregate below is a SEPARATE grouped query merged in JS — never a correlated
   * subquery interpolating `projectId`, which would emit unqualified and silently match nothing.
   *
   * getProjectRow BEFORE assertCanViewProject — same existence-check discipline as
   * listMilestones/listTasks/listProjectUpdates: canViewProject short-circuits true for an
   * admin regardless of whether the project id exists, so checking membership first would let
   * an admin's request for a nonexistent project fall through to a "summary of nothing" 200
   * instead of a 404, and would give a non-admin a 403 instead of a 404 on a bad id.
   */
  async projectSummary(projectId: string, actor: AuthenticatedUser) {
    const project = await this.getProjectRow(projectId);
    await this.assertCanViewProject(projectId, actor);
    const today = new Date().toISOString().slice(0, 10);

    const milestones = await this.db
      .select({ status: projectMilestones.status, dueDate: projectMilestones.dueDate })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, projectId));

    const tasks = await this.db
      .select({ status: projectTasks.status, count: sql<number>`cast(count(*) as int)` })
      .from(projectTasks)
      .where(and(eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)))
      .groupBy(projectTasks.status);

    const [hours] = await this.db
      .select({
        totalMinutes: sql<number>`cast(coalesce(sum(${timesheetEntries.minutes}), 0) as int)`,
      })
      .from(timesheetEntries)
      .where(eq(timesheetEntries.projectId, projectId));

    const [lastUpdate] = await this.db
      .select({ workDate: timesheetEntries.workDate })
      .from(timesheetEntries)
      .where(eq(timesheetEntries.projectId, projectId))
      .orderBy(desc(timesheetEntries.workDate))
      .limit(1);

    const members = await this.db
      .select({ employeeId: projectAllocations.employeeId })
      .from(projectAllocations)
      .where(and(eq(projectAllocations.projectId, projectId), eq(projectAllocations.isActive, true)));

    const updatedToday = await this.db
      .selectDistinct({ employeeId: timesheetEntries.employeeId })
      .from(timesheetEntries)
      .where(
        and(eq(timesheetEntries.projectId, projectId), eq(timesheetEntries.workDate, today)),
      );

    return {
      projectId,
      health: project.health,
      progressPct: project.progressPct,
      progressUpdatedAt: project.progressUpdatedAt,
      milestonesTotal: milestones.length,
      milestonesDone: milestones.filter((m) => m.status === 'done').length,
      milestonesOverdue: milestones.filter((m) => m.status === 'pending' && m.dueDate < today).length,
      tasksByStatus: Object.fromEntries(tasks.map((t) => [t.status, t.count])),
      totalHours: Math.round(((hours?.totalMinutes ?? 0) / 60) * 100) / 100,
      lastUpdateDate: lastUpdate?.workDate ?? null,
      membersAllocated: members.length,
      membersUpdatedToday: updatedToday.length,
    };
  }

  /** The actor's active projects, each with its summary block. */
  async myProjects(actor: AuthenticatedUser) {
    const rows = await this.db
      .select({ projectId: projectAllocations.projectId })
      .from(projectAllocations)
      .where(
        and(eq(projectAllocations.employeeId, actor.id), eq(projectAllocations.isActive, true)),
      );
    const ids = [...new Set(rows.map((r) => r.projectId))];
    const out = [];
    for (const id of ids) {
      const project = await this.getProjectRow(id);
      out.push({
        id: project.id,
        name: project.name,
        code: project.code,
        status: project.status,
        summary: await this.projectSummary(id, actor),
      });
    }
    return out;
  }

  // ── Milestones & progress ─────────────────────────────────────────────────────

  async listMilestones(projectId: string, actor: AuthenticatedUser) {
    // canViewProject short-circuits true for an admin regardless of whether the project id
    // exists, so a read that only calls assertCanViewProject would hand an admin a silent
    // 200 with an empty list instead of a 404 for a bad id. getProjectRow closes that gap.
    await this.getProjectRow(projectId);
    await this.assertCanViewProject(projectId, actor);
    return this.db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, projectId))
      .orderBy(asc(projectMilestones.sortOrder), asc(projectMilestones.dueDate));
  }

  async createMilestone(projectId: string, dto: CreateMilestoneDto, actor: AuthenticatedUser) {
    const project = await this.getProjectRow(projectId);
    await this.assertCanManageProject(project, actor);
    const [row] = await this.db
      .insert(projectMilestones)
      .values({
        projectId,
        name: dto.name,
        description: dto.description ?? null,
        dueDate: dto.dueDate,
        sortOrder: dto.sortOrder ?? 0,
      })
      .returning();
    return row;
  }

  async updateMilestone(id: string, dto: UpdateMilestoneDto, actor: AuthenticatedUser) {
    const [existing] = await this.db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, id));
    if (!existing) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Milestone not found', HttpStatus.NOT_FOUND);
    }
    const project = await this.getProjectRow(existing.projectId);
    await this.assertCanManageProject(project, actor);

    // Marking done stamps completedAt; reopening clears it.
    const completedAt =
      dto.status === 'done' ? new Date() : dto.status === 'pending' ? null : undefined;

    const [row] = await this.db
      .update(projectMilestones)
      .set({
        ...dto,
        ...(completedAt !== undefined ? { completedAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(projectMilestones.id, id))
      .returning();
    return row;
  }

  async deleteMilestone(id: string, actor: AuthenticatedUser) {
    const [existing] = await this.db
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.id, id));
    if (!existing) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Milestone not found', HttpStatus.NOT_FOUND);
    }
    const project = await this.getProjectRow(existing.projectId);
    await this.assertCanManageProject(project, actor);
    await this.db.delete(projectMilestones).where(eq(projectMilestones.id, id));
    return { id };
  }

  async updateProgress(projectId: string, dto: UpdateProgressDto, actor: AuthenticatedUser) {
    const project = await this.getProjectRow(projectId);
    await this.assertCanManageProject(project, actor);
    if (dto.progressPct === undefined && dto.health === undefined) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Nothing to update');
    }
    const [row] = await this.db
      .update(projects)
      .set({ ...dto, progressUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning();
    return row;
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  async listTasks(projectId: string, query: ListTasksDto, actor: AuthenticatedUser) {
    // Same existence-check gap Task 3 closed in listMilestones: canViewProject short-circuits
    // true for an admin regardless of whether the project id exists, so a read that only asserts
    // view access would hand an admin a silent 200 with an empty array for a bad id instead of a
    // 404. getProjectRow closes that before membership is even evaluated.
    await this.getProjectRow(projectId);
    await this.assertCanViewProject(projectId, actor);

    const filters = [eq(projectTasks.projectId, projectId), isNull(projectTasks.archivedAt)];
    if (query.status) filters.push(eq(projectTasks.status, query.status));
    if (query.assigneeId) filters.push(eq(projectTasks.assigneeEmployeeId, query.assigneeId));

    // Two distinct aliases — assignee and assigner are two different rows of `employees`.
    const assignee = alias(employees, 'assignee');
    const assigner = alias(employees, 'assigner');
    return this.db
      .select({
        id: projectTasks.id,
        projectId: projectTasks.projectId,
        title: projectTasks.title,
        description: projectTasks.description,
        assigneeEmployeeId: projectTasks.assigneeEmployeeId,
        assigneeName: this.nameExpr(assignee),
        assignedByEmployeeId: projectTasks.assignedByEmployeeId,
        assignedByName: this.nameExpr(assigner),
        assignedAt: projectTasks.assignedAt,
        status: projectTasks.status,
        priority: projectTasks.priority,
        dueDate: projectTasks.dueDate,
        milestoneId: projectTasks.milestoneId,
        blockedReason: projectTasks.blockedReason,
        createdBy: projectTasks.createdBy,
        sortOrder: projectTasks.sortOrder,
        createdAt: projectTasks.createdAt,
      })
      .from(projectTasks)
      .leftJoin(assignee, eq(assignee.id, projectTasks.assigneeEmployeeId))
      .leftJoin(assigner, eq(assigner.id, projectTasks.assignedByEmployeeId))
      .where(and(...filters))
      .orderBy(asc(projectTasks.sortOrder), desc(projectTasks.createdAt));
  }

  /** Any project member may create. Self-assign only — assigning to someone else needs manage. */
  async createTask(projectId: string, dto: CreateTaskDto, actor: AuthenticatedUser) {
    // getProjectRow unconditionally, before the assignment branch — closes the same
    // existence-check gap as listTasks instead of only surfacing it when someone hands the task
    // to a colleague. The row is reused below rather than fetched a second time.
    const project = await this.getProjectRow(projectId);
    await this.assertCanViewProject(projectId, actor);

    const wantsAssignee = dto.assigneeEmployeeId ?? null;
    if (wantsAssignee && wantsAssignee !== actor.id) {
      await this.assertCanManageProject(project, actor);
    }

    const [row] = await this.db
      .insert(projectTasks)
      .values({
        projectId,
        title: dto.title,
        description: dto.description ?? null,
        assigneeEmployeeId: wantsAssignee,
        assignedByEmployeeId: wantsAssignee ? actor.id : null,
        assignedAt: wantsAssignee ? new Date() : null,
        priority: dto.priority ?? 'medium',
        dueDate: dto.dueDate ?? null,
        milestoneId: dto.milestoneId ?? null,
        blockedReason: dto.blockedReason ?? null,
        createdBy: actor.id,
      })
      .returning();
    return row;
  }

  /**
   * The permission ladder — one branch per field group. `canManageProject` hits the database, so
   * it is resolved once here and reused across all four checks rather than re-queried per branch.
   */
  async updateTask(id: string, dto: UpdateTaskDto, actor: AuthenticatedUser) {
    const [task] = await this.db.select().from(projectTasks).where(eq(projectTasks.id, id));
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);

    await this.assertCanViewProject(task.projectId, actor);
    const canManage = await this.canManageProject(task.projectId, actor);

    const patch: Record<string, unknown> = {};
    const touches = (k: keyof UpdateTaskDto) => dto[k] !== undefined;

    // 1. Scheduling levers — PM/admin only.
    if (touches('dueDate') || touches('priority') || touches('milestoneId')) {
      if (!canManage) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Only the project PM or HR/Delivery can change a task’s schedule',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 2. Title / description — PM/admin, or the creator while nobody else has picked it up.
    if (touches('title') || touches('description')) {
      const ownUnclaimed =
        task.createdBy === actor.id &&
        (task.assigneeEmployeeId === null || task.assigneeEmployeeId === actor.id);
      if (!canManage && !ownUnclaimed) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'You can only edit a task you created that nobody else has picked up',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    // 3. Assignment.
    if (touches('assigneeEmployeeId')) {
      const next = dto.assigneeEmployeeId ?? null;
      if (!canManage) {
        const claiming = next === actor.id && task.assigneeEmployeeId === null;
        const releasingOwn = next === null && task.assigneeEmployeeId === actor.id;
        if (!claiming && !releasingOwn) {
          throw new AppError(
            ErrorCode.FORBIDDEN,
            'You can only claim an unassigned task or release one you claimed',
            HttpStatus.FORBIDDEN,
          );
        }
      }
      patch.assigneeEmployeeId = next;
      patch.assignedByEmployeeId = next ? actor.id : null;
      patch.assignedAt = next ? new Date() : null;
    }

    // 4. Status — PM/admin or the current assignee. `blockedReason` is governed by this SAME
    // gate rather than its own — a plain member who is neither the manager nor the assignee must
    // not be able to set or edit it, whether through a status change or a bare `{ blockedReason }`
    // patch. Keeping it out of the generic field-copy loop below is what makes that hold.
    if (touches('status') || touches('blockedReason')) {
      if (!canManage && task.assigneeEmployeeId !== actor.id) {
        throw new AppError(
          ErrorCode.FORBIDDEN,
          'Only the assignee or the PM can change this task’s status or blocked reason',
          HttpStatus.FORBIDDEN,
        );
      }
      if (touches('status')) patch.status = dto.status;

      const nextStatus = dto.status ?? task.status;
      if (nextStatus === 'blocked') {
        const reason = dto.blockedReason ?? task.blockedReason;
        if (!reason) {
          throw new AppError(
            ErrorCode.BAD_REQUEST,
            'A blocked task needs a reason',
            HttpStatus.BAD_REQUEST,
          );
        }
        patch.blockedReason = reason;
      } else if (task.status === 'blocked') {
        patch.blockedReason = null;
      }
    }

    for (const k of ['title', 'description', 'dueDate', 'priority', 'milestoneId'] as const) {
      if (touches(k)) patch[k] = dto[k];
    }

    const [row] = await this.db
      .update(projectTasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(projectTasks.id, id))
      .returning();
    return row;
  }

  /** PM/admin, or the creator while nobody else has picked it up. */
  async deleteTask(id: string, actor: AuthenticatedUser) {
    const [task] = await this.db.select().from(projectTasks).where(eq(projectTasks.id, id));
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    await this.assertCanViewProject(task.projectId, actor);

    const canManage = await this.canManageProject(task.projectId, actor);
    const ownUnclaimed =
      task.createdBy === actor.id &&
      (task.assigneeEmployeeId === null || task.assigneeEmployeeId === actor.id);
    if (!canManage && !ownUnclaimed) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'You can only delete a task you created that nobody else has picked up',
        HttpStatus.FORBIDDEN,
      );
    }
    // Soft-delete: archive rather than DELETE. A task with logged time can't be hard-deleted
    // anyway (timesheet_entries.task_id is NOT NULL + ON DELETE restrict), and history must
    // survive. Reads filter on `archivedAt IS NULL`.
    await this.db
      .update(projectTasks)
      .set({ archivedAt: new Date() })
      .where(eq(projectTasks.id, id));
    return { id };
  }

  // ── Task-scoped work logging (v2) ─────────────────────────────────────────────

  /**
   * Log time+notes ON a task, for a single day. The v2 write path — this is the only caller of
   * `TimesheetsService.upsertTaskEntry`, which is in turn the only writer of a `timesheet_entries`
   * row. Gated on view access (members, PM, or admin may log); an archived task refuses writes
   * outright, since there is nothing left to log against.
   */
  async logTaskWork(taskId: string, dto: LogTaskWorkDto, actor: AuthenticatedUser) {
    const [task] = await this.db.select().from(projectTasks).where(eq(projectTasks.id, taskId));
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    if (task.archivedAt) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'Task is archived', HttpStatus.BAD_REQUEST);
    }
    await this.assertCanViewProject(task.projectId, actor);
    return this.timesheetsService.upsertTaskEntry(taskId, task.projectId, dto, actor);
  }

  /**
   * The task's log — its entries across dates (its thread), newest first, with author name and
   * comment count. Unlike `logTaskWork`, an archived task's history is still readable: reading
   * the past never needs to be refused just because the task itself is closed out.
   */
  async listTaskLog(taskId: string, actor: AuthenticatedUser) {
    const [task] = await this.db.select().from(projectTasks).where(eq(projectTasks.id, taskId));
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    await this.assertCanViewProject(task.projectId, actor);

    const rows = await this.db
      .select({
        id: timesheetEntries.id,
        workDate: timesheetEntries.workDate,
        minutes: timesheetEntries.minutes,
        billable: timesheetEntries.billable,
        taskDescription: timesheetEntries.taskDescription,
        employeeId: timesheetEntries.employeeId,
        employeeName: this.nameExpr(),
      })
      .from(timesheetEntries)
      .innerJoin(employees, eq(employees.id, timesheetEntries.employeeId))
      .where(eq(timesheetEntries.taskId, taskId))
      .orderBy(desc(timesheetEntries.workDate));

    // Comment counts: a SEPARATE grouped query over update_comments (never a correlated
    // subquery), merged in JS — same pattern as UpdatesService.withCommentCounts. Guarded for the
    // empty case: an `inArray` with no ids must not even be built.
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
    const countByEntry = new Map(counts.map((c) => [c.entryId, c.count]));

    return rows.map(({ minutes, ...rest }) => ({
      ...rest,
      hours: Math.round((minutes / 60) * 100) / 100,
      commentCount: countByEntry.get(rest.id) ?? 0,
    }));
  }

  // ── My tasks (cross-project, v2) ───────────────────────────────────────────────

  /**
   * The actor's own tasks across EVERY project — no membership gate, deliberately (mirrors
   * UpdatesService.listMyUpdates: this is the actor's own work, not a project-scoped read).
   *
   * `query.date` given => My Day: only the tasks the actor logged a timesheet entry against on
   * that date (inner join on timesheet_entries), each returned with that day's hours + note.
   *
   * No date => all of the actor's work: assigned to them, or created by them and still
   * unassigned (self-service pickup hasn't happened yet). Left-joined against today's entry so
   * `hoursToday` is 0 rather than dropping the task when nothing has been logged yet today.
   *
   * Same two-alias provenance pattern as listTasks (assignee/assigner are two different rows of
   * `employees`), plus a project join for `projectName` since this spans projects.
   */
  async myTasks(query: MyTasksQueryDto, actor: AuthenticatedUser) {
    const assignee = alias(employees, 'assignee');
    const assigner = alias(employees, 'assigner');
    const statusOrder = sql`case ${projectTasks.status} when 'todo' then 0 when 'in_progress' then 1 when 'blocked' then 2 else 3 end`;

    const archivedFilter = isNull(projectTasks.archivedAt);
    const statusFilter = query.status ? eq(projectTasks.status, query.status) : undefined;

    const baseSelect = {
      id: projectTasks.id,
      projectId: projectTasks.projectId,
      projectName: projects.name,
      title: projectTasks.title,
      description: projectTasks.description,
      assigneeEmployeeId: projectTasks.assigneeEmployeeId,
      assigneeName: this.nameExpr(assignee),
      assignedByEmployeeId: projectTasks.assignedByEmployeeId,
      assignedByName: this.nameExpr(assigner),
      assignedAt: projectTasks.assignedAt,
      status: projectTasks.status,
      priority: projectTasks.priority,
      dueDate: projectTasks.dueDate,
      milestoneId: projectTasks.milestoneId,
      blockedReason: projectTasks.blockedReason,
      createdBy: projectTasks.createdBy,
      sortOrder: projectTasks.sortOrder,
      createdAt: projectTasks.createdAt,
    };

    if (query.date) {
      const rows = await this.db
        .select({ ...baseSelect, minutes: timesheetEntries.minutes, note: timesheetEntries.taskDescription })
        .from(projectTasks)
        .innerJoin(
          timesheetEntries,
          and(
            eq(timesheetEntries.taskId, projectTasks.id),
            eq(timesheetEntries.employeeId, actor.id),
            eq(timesheetEntries.workDate, query.date),
          ),
        )
        .innerJoin(projects, eq(projects.id, projectTasks.projectId))
        .leftJoin(assignee, eq(assignee.id, projectTasks.assigneeEmployeeId))
        .leftJoin(assigner, eq(assigner.id, projectTasks.assignedByEmployeeId))
        .where(and(archivedFilter, statusFilter))
        .orderBy(statusOrder, sql`${projectTasks.dueDate} asc nulls last`);

      return rows.map(({ minutes, ...rest }) => ({
        ...rest,
        hours: Math.round((minutes / 60) * 100) / 100,
      }));
    }

    const today = new Date().toISOString().slice(0, 10);
    const todayEntry = alias(timesheetEntries, 'todayEntry');
    const ownershipFilter = or(
      eq(projectTasks.assigneeEmployeeId, actor.id),
      and(eq(projectTasks.createdBy, actor.id), isNull(projectTasks.assigneeEmployeeId)),
    );

    const rows = await this.db
      .select({ ...baseSelect, minutesToday: todayEntry.minutes })
      .from(projectTasks)
      .innerJoin(projects, eq(projects.id, projectTasks.projectId))
      .leftJoin(assignee, eq(assignee.id, projectTasks.assigneeEmployeeId))
      .leftJoin(assigner, eq(assigner.id, projectTasks.assignedByEmployeeId))
      .leftJoin(
        todayEntry,
        and(
          eq(todayEntry.taskId, projectTasks.id),
          eq(todayEntry.employeeId, actor.id),
          eq(todayEntry.workDate, today),
        ),
      )
      .where(and(archivedFilter, statusFilter, ownershipFilter))
      .orderBy(statusOrder, sql`${projectTasks.dueDate} asc nulls last`);

    return rows.map(({ minutesToday, ...rest }) => ({
      ...rest,
      hoursToday: Math.round(((minutesToday ?? 0) / 60) * 100) / 100,
    }));
  }

  // ── shared helpers used by the timesheets service ─────────────────────────────

  /** True if the actor is the PM of the project, or HR/Delivery (admin+). */
  async canManageProject(projectId: string, actor: AuthenticatedUser): Promise<boolean> {
    if (isAdminOrAbove(actor)) return true;
    const [row] = await this.db
      .select({ pm: projects.pmEmployeeId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    return Boolean(row && row.pm === actor.id);
  }

  /**
   * Project membership — the module's third access dimension, alongside role (isAdminOrAbove)
   * and org chart (isManagerOf). An employee must be able to open a project they work on even
   * though they manage nobody, and must not be able to open one they have nothing to do with.
   *
   * ONE copy, called by every project-scoped read. A duplicated membership test is exactly the
   * IDOR the timesheets integration nearly shipped with its scope resolver.
   */
  async canViewProject(projectId: string, actor: AuthenticatedUser): Promise<boolean> {
    if (isAdminOrAbove(actor)) return true;

    const [project] = await this.db
      .select({ pmEmployeeId: projects.pmEmployeeId })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) return false;
    if (project.pmEmployeeId === actor.id) return true;

    const [allocation] = await this.db
      .select({ id: projectAllocations.id })
      .from(projectAllocations)
      .where(
        and(
          eq(projectAllocations.projectId, projectId),
          eq(projectAllocations.employeeId, actor.id),
          eq(projectAllocations.isActive, true),
        ),
      )
      .limit(1);
    return Boolean(allocation);
  }

  async assertCanViewProject(projectId: string, actor: AuthenticatedUser): Promise<void> {
    if (!(await this.canViewProject(projectId, actor))) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Not allowed to view this project',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /** Sum of active allocation % for an employee across all projects. */
  async activeAllocationPct(employeeId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`cast(coalesce(sum(${projectAllocations.allocationPct}), 0) as int)` })
      .from(projectAllocations)
      .where(and(eq(projectAllocations.employeeId, employeeId), eq(projectAllocations.isActive, true)));
    return row?.total ?? 0;
  }

  async getProjectRow(id: string): Promise<Project> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Project not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async assertCanManageProject(project: Project, actor: AuthenticatedUser): Promise<void> {
    if (isAdminOrAbove(actor)) return;
    if (project.pmEmployeeId === actor.id) return;
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the project PM or HR/Delivery can manage this project', HttpStatus.FORBIDDEN);
  }

  private async getClientRow(id: string): Promise<Client> {
    const [row] = await this.db.select().from(clients).where(eq(clients.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Client not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getAllocationRow(id: string): Promise<ProjectAllocation> {
    const [row] = await this.db.select().from(projectAllocations).where(eq(projectAllocations.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Allocation not found', HttpStatus.NOT_FOUND);
    return row;
  }

  /**
   * Structural, not `typeof employees`, so an `alias(employees, ...)` join (a distinct table
   * literal type) can be passed too — e.g. task assignee/assigner are two aliased joins of the
   * same table. Defaults to the bare `employees` table.
   */
  private nameExpr(
    table: { displayName: AnyPgColumn; firstName: AnyPgColumn; lastName: AnyPgColumn } = employees,
  ) {
    return sql<
      string | null
    >`coalesce(${table.displayName}, ${table.firstName} || ' ' || ${table.lastName})`;
  }

  private async record(
    actor: AuthenticatedUser,
    action: string,
    target: string,
    data: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    await this.audit.record({ actorType: actor.type, actorId: actor.id, action, target, ...data });
  }

  private async mapWrite<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (pgErrorCode(err) === '23505') {
        throw new AppError(ErrorCode.CONFLICT, 'A record with that code already exists', HttpStatus.CONFLICT);
      }
      throw err;
    }
  }
}
