import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  checklistTasks,
  checklistTemplateItems,
  checklistTemplates,
  documents,
  employees,
  lifecycleCases,
  notifications,
  type ChecklistTask,
  type ChecklistTemplate,
  type LifecycleCase,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove } from '../auth/roles';
import { EmployeesService } from '../employees/employees.service';
import type {
  CreateCaseDto,
  CreateTemplateDto,
  ListCasesDto,
  ListTasksDto,
  ListTemplatesDto,
  UpdateTaskDto,
  UpdateTemplateDto,
} from './dto/onboarding.dto';

/** Task statuses that count as "closed" for progress and the clearance gate. */
const CLOSED_STATUSES = ['done', 'skipped'] as const;
/** Categories whose mandatory tasks form the offboarding clearance gate. */
const CLEARANCE_CATEGORIES = ['clearance', 'handover'] as const;

type AppliesTo = {
  employmentTypes?: string[];
  departmentIds?: string[];
  locations?: string[];
};

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly employeesService: EmployeesService,
  ) {}

  // ── Templates ───────────────────────────────────────────────────────────────

  async listTemplates(query: ListTemplatesDto) {
    const filters: SQL[] = [];
    if (query.type) filters.push(eq(checklistTemplates.type, query.type));
    if (query.isActive !== undefined) filters.push(eq(checklistTemplates.isActive, query.isActive));

    const templates = await this.db
      .select()
      .from(checklistTemplates)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(checklistTemplates.createdAt));

    if (templates.length === 0) return [];
    const items = await this.db
      .select()
      .from(checklistTemplateItems)
      .where(inArray(checklistTemplateItems.templateId, templates.map((t) => t.id)))
      .orderBy(asc(checklistTemplateItems.sortOrder));

    return templates.map((t) => ({ ...t, items: items.filter((i) => i.templateId === t.id) }));
  }

  async getTemplate(id: string) {
    const template = await this.getTemplateRow(id);
    const items = await this.db
      .select()
      .from(checklistTemplateItems)
      .where(eq(checklistTemplateItems.templateId, id))
      .orderBy(asc(checklistTemplateItems.sortOrder));
    return { ...template, items };
  }

  async createTemplate(dto: CreateTemplateDto, actor: AuthenticatedUser) {
    const created = await this.db.transaction(async (tx) => {
      const [template] = await tx
        .insert(checklistTemplates)
        .values({
          name: dto.name,
          type: dto.type,
          appliesTo: dto.appliesTo ?? null,
          isActive: dto.isActive,
        })
        .returning();
      if (!template) throw new AppError(ErrorCode.INTERNAL, 'Failed to create template');

      if (dto.items.length > 0) {
        await tx
          .insert(checklistTemplateItems)
          .values(dto.items.map((item) => ({ ...item, templateId: template.id })));
      }
      return template;
    });

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'checklist_template.create',
      target: `checklist_template:${created.id}`,
      after: { id: created.id, name: created.name, type: created.type, items: dto.items.length },
    });
    return this.getTemplate(created.id);
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto, actor: AuthenticatedUser) {
    const before = await this.getTemplateRow(id);

    await this.db.transaction(async (tx) => {
      const patch: Partial<typeof checklistTemplates.$inferInsert> = { updatedAt: new Date() };
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.appliesTo !== undefined) patch.appliesTo = dto.appliesTo;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;
      await tx.update(checklistTemplates).set(patch).where(eq(checklistTemplates.id, id));

      // `items` fully replaces the existing set (drives the reorderable editor).
      if (dto.items !== undefined) {
        await tx.delete(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, id));
        if (dto.items.length > 0) {
          await tx
            .insert(checklistTemplateItems)
            .values(dto.items.map((item) => ({ ...item, templateId: id })));
        }
      }
    });

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'checklist_template.update',
      target: `checklist_template:${id}`,
      before: { name: before.name, isActive: before.isActive },
    });
    return this.getTemplate(id);
  }

  // ── Lifecycle cases ─────────────────────────────────────────────────────────

  /** Create a case for an employee, snapshotting the (auto-selected or given) template into tasks. */
  async createCase(dto: CreateCaseDto, actor: AuthenticatedUser) {
    const employee = await this.getEmployee(dto.employeeId);

    const anchorDate =
      dto.anchorDate ??
      (dto.type === 'onboarding' ? employee.dateOfJoining : employee.dateOfExit);
    if (!anchorDate) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        dto.type === 'onboarding'
          ? 'Employee has no joining date; provide anchorDate'
          : 'Employee has no exit date; provide anchorDate',
      );
    }

    const template = dto.templateId
      ? await this.getTemplateRow(dto.templateId)
      : await this.autoSelectTemplate(dto.type, employee);
    if (template.type !== dto.type) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `Template "${template.name}" is not a ${dto.type} template`);
    }

    const items = await this.db
      .select()
      .from(checklistTemplateItems)
      .where(eq(checklistTemplateItems.templateId, template.id))
      .orderBy(asc(checklistTemplateItems.sortOrder));

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(lifecycleCases)
        .values({
          employeeId: employee.id,
          type: dto.type,
          templateId: template.id,
          anchorDate,
          status: 'not_started',
          createdBy: actor.id,
        })
        .returning();
      if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create lifecycle case');

      if (items.length > 0) {
        await tx.insert(checklistTasks).values(
          items.map((item) => ({
            caseId: row.id,
            title: item.title,
            description: item.description,
            category: item.category,
            assigneeId: this.resolveAssignee(item.defaultAssigneeRole, employee, actor.id),
            dueDate: this.addDays(anchorDate, item.offsetDays),
            isMandatory: item.isMandatory,
            requiresDocument: item.requiresDocument,
            sortOrder: item.sortOrder,
          })),
        );
      }
      return row;
    });

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'lifecycle_case.create',
      target: `lifecycle_case:${created.id}`,
      after: { id: created.id, employeeId: employee.id, type: dto.type, tasks: items.length },
    });

    // Notify each distinct assignee that they have new tasks.
    await this.notifyAssignees(created.id, dto.type);

    return this.getCase(created.id, actor);
  }

  /** Role-scoped case list. `me` = own cases; `assigned` = cases with a task assigned to me; `all` = HR. */
  async listCases(query: ListCasesDto, actor: AuthenticatedUser) {
    const filters: SQL[] = [];
    if (query.type) filters.push(eq(lifecycleCases.type, query.type));

    if (query.scope === 'me') {
      filters.push(eq(lifecycleCases.employeeId, actor.id));
    } else if (query.scope === 'assigned') {
      filters.push(
        sql`exists (select 1 from ${checklistTasks} t where t.case_id = ${lifecycleCases.id} and t.assignee_id = ${actor.id})`,
      );
    } else {
      if (!isAdminOrAbove(actor)) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view all cases', HttpStatus.FORBIDDEN);
      }
    }

    return this.db
      .select({
        id: lifecycleCases.id,
        employeeId: lifecycleCases.employeeId,
        employeeName: this.nameExpr(),
        type: lifecycleCases.type,
        status: lifecycleCases.status,
        anchorDate: lifecycleCases.anchorDate,
        progressPct: lifecycleCases.progressPct,
        templateId: lifecycleCases.templateId,
        createdBy: lifecycleCases.createdBy,
        completedAt: lifecycleCases.completedAt,
        createdAt: lifecycleCases.createdAt,
      })
      .from(lifecycleCases)
      .innerJoin(employees, eq(employees.id, lifecycleCases.employeeId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(lifecycleCases.createdAt));
  }

  /** A case with its tasks, progress, and (offboarding) clearance-gate state. */
  async getCase(id: string, actor: AuthenticatedUser) {
    const kase = await this.getCaseRow(id);

    const tasks = await this.db
      .select({
        id: checklistTasks.id,
        caseId: checklistTasks.caseId,
        title: checklistTasks.title,
        description: checklistTasks.description,
        category: checklistTasks.category,
        assigneeId: checklistTasks.assigneeId,
        assigneeName: this.nameExpr(),
        dueDate: checklistTasks.dueDate,
        status: checklistTasks.status,
        isMandatory: checklistTasks.isMandatory,
        requiresDocument: checklistTasks.requiresDocument,
        linkedDocumentId: checklistTasks.linkedDocumentId,
        sortOrder: checklistTasks.sortOrder,
        completedBy: checklistTasks.completedBy,
        completedAt: checklistTasks.completedAt,
        notes: checklistTasks.notes,
      })
      .from(checklistTasks)
      .leftJoin(employees, eq(employees.id, checklistTasks.assigneeId))
      .where(eq(checklistTasks.caseId, id))
      .orderBy(asc(checklistTasks.sortOrder));

    await this.assertCanViewCase(kase, tasks, actor);

    const clearanceComplete =
      kase.type === 'offboarding'
        ? tasks
            .filter((t) => t.isMandatory && CLEARANCE_CATEGORIES.includes(t.category as never))
            .every((t) => CLOSED_STATUSES.includes(t.status as never))
        : null;

    return { ...kase, tasks, clearanceComplete };
  }

  async cancelCase(id: string, note: string | undefined, actor: AuthenticatedUser) {
    const kase = await this.getCaseRow(id);
    if (!isAdminOrAbove(actor) && kase.createdBy !== actor.id) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to cancel this case', HttpStatus.FORBIDDEN);
    }
    if (kase.status === 'cancelled') {
      throw new AppError(ErrorCode.CONFLICT, 'Case is already cancelled', HttpStatus.CONFLICT);
    }
    if (kase.status === 'completed') {
      throw new AppError(ErrorCode.CONFLICT, 'Cannot cancel a completed case', HttpStatus.CONFLICT);
    }
    const [row] = await this.db
      .update(lifecycleCases)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(lifecycleCases.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to cancel case');

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'lifecycle_case.cancel',
      target: `lifecycle_case:${id}`,
      before: { status: kase.status },
      after: { status: 'cancelled', note },
    });
    return this.getCase(id, actor);
  }

  // ── Checklist tasks ──────────────────────────────────────────────────────────

  async listTasks(query: ListTasksDto, actor: AuthenticatedUser) {
    const filters: SQL[] = [];
    if (query.assignee === 'me') {
      filters.push(eq(checklistTasks.assigneeId, actor.id));
    } else if (query.assignee === 'all') {
      if (!isAdminOrAbove(actor)) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view all tasks', HttpStatus.FORBIDDEN);
      }
    } else {
      // A specific assignee id — only HR/Admin may inspect someone else's tasks.
      if (query.assignee !== actor.id && !isAdminOrAbove(actor)) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view these tasks', HttpStatus.FORBIDDEN);
      }
      filters.push(eq(checklistTasks.assigneeId, query.assignee));
    }
    if (query.status) filters.push(eq(checklistTasks.status, query.status));
    if (query.caseId) filters.push(eq(checklistTasks.caseId, query.caseId));

    return this.db
      .select({
        id: checklistTasks.id,
        caseId: checklistTasks.caseId,
        caseType: lifecycleCases.type,
        title: checklistTasks.title,
        category: checklistTasks.category,
        assigneeId: checklistTasks.assigneeId,
        dueDate: checklistTasks.dueDate,
        status: checklistTasks.status,
        isMandatory: checklistTasks.isMandatory,
        requiresDocument: checklistTasks.requiresDocument,
        linkedDocumentId: checklistTasks.linkedDocumentId,
        completedAt: checklistTasks.completedAt,
      })
      .from(checklistTasks)
      .innerJoin(lifecycleCases, eq(lifecycleCases.id, checklistTasks.caseId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(checklistTasks.dueDate));
  }

  /** Update status / notes / assignee / due-date / linked document on a task. */
  async updateTask(id: string, dto: UpdateTaskDto, actor: AuthenticatedUser) {
    const task = await this.getTaskRow(id);
    const reassigning = dto.assigneeId !== undefined && dto.assigneeId !== task.assigneeId;
    await this.assertCanEditTask(task, actor, reassigning);

    if (dto.status === 'done') {
      // Route completions through the same document-requirement validation.
      return this.completeTask(id, { linkedDocumentId: dto.linkedDocumentId ?? undefined, notes: dto.notes ?? undefined }, actor);
    }

    if (dto.linkedDocumentId) await this.assertDocumentExists(dto.linkedDocumentId);
    if (reassigning && dto.assigneeId) await this.employeesService.ensureExists(dto.assigneeId);

    const patch: Partial<typeof checklistTasks.$inferInsert> = { updatedAt: new Date() };
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.assigneeId !== undefined) patch.assigneeId = dto.assigneeId;
    if (dto.dueDate !== undefined) patch.dueDate = dto.dueDate;
    if (dto.linkedDocumentId !== undefined) patch.linkedDocumentId = dto.linkedDocumentId;

    const [row] = await this.db.update(checklistTasks).set(patch).where(eq(checklistTasks.id, id)).returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update task');

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'checklist_task.update',
      target: `checklist_task:${id}`,
      before: { status: task.status, assigneeId: task.assigneeId },
      after: { status: row.status, assigneeId: row.assigneeId },
    });
    if (reassigning && row.assigneeId) {
      await this.notify(row.assigneeId, 'New checklist task assigned', row.title, '/tasks');
    }
    await this.recomputeCase(task.caseId, actor);
    return row;
  }

  /** Mark a task done, enforcing the document requirement, then refresh the case. */
  async completeTask(
    id: string,
    dto: { linkedDocumentId?: string; notes?: string },
    actor: AuthenticatedUser,
  ) {
    const task = await this.getTaskRow(id);
    await this.assertCanEditTask(task, actor, false);
    if (task.status === 'done') {
      throw new AppError(ErrorCode.CONFLICT, 'Task is already done', HttpStatus.CONFLICT);
    }

    const linkedDocumentId = dto.linkedDocumentId ?? task.linkedDocumentId;
    if (task.requiresDocument && !linkedDocumentId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'This task requires a linked document before completion');
    }
    if (dto.linkedDocumentId) await this.assertDocumentExists(dto.linkedDocumentId);

    const [row] = await this.db
      .update(checklistTasks)
      .set({
        status: 'done',
        linkedDocumentId,
        notes: dto.notes ?? task.notes,
        completedBy: actor.id,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(checklistTasks.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to complete task');

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'checklist_task.complete',
      target: `checklist_task:${id}`,
      before: { status: task.status },
      after: { status: 'done', linkedDocumentId },
    });
    await this.recomputeCase(task.caseId, actor);
    return row;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Recompute derived case progress/status from its tasks. Auto-completes when every mandatory task
   * is closed; on offboarding completion, transitions the employee to `exited` (the clearance gate:
   * the exit only fires once mandatory clearance/handover tasks are done).
   */
  private async recomputeCase(caseId: string, actor: AuthenticatedUser): Promise<void> {
    const kase = await this.getCaseRow(caseId);
    if (kase.status === 'cancelled') return;

    const tasks = await this.db
      .select({ status: checklistTasks.status, isMandatory: checklistTasks.isMandatory })
      .from(checklistTasks)
      .where(eq(checklistTasks.caseId, caseId));

    const total = tasks.length;
    const closed = tasks.filter((t) => CLOSED_STATUSES.includes(t.status as never)).length;
    const progressPct = total === 0 ? 0 : Math.round((closed / total) * 100);
    const mandatory = tasks.filter((t) => t.isMandatory);
    const allMandatoryClosed =
      total > 0 && mandatory.every((t) => CLOSED_STATUSES.includes(t.status as never));
    const anyTouched = tasks.some((t) => t.status !== 'pending');

    const status: LifecycleCase['status'] = allMandatoryClosed
      ? 'completed'
      : anyTouched
        ? 'in_progress'
        : 'not_started';
    const justCompleted = status === 'completed' && kase.status !== 'completed';

    await this.db
      .update(lifecycleCases)
      .set({
        progressPct,
        status,
        completedAt: justCompleted ? new Date() : kase.completedAt,
        updatedAt: new Date(),
      })
      .where(eq(lifecycleCases.id, caseId));

    if (justCompleted) {
      await this.notify(
        kase.employeeId,
        `${kase.type === 'onboarding' ? 'Onboarding' : 'Offboarding'} complete`,
        'All checklist tasks are done.',
        '/me',
      );
      if (kase.type === 'offboarding') await this.exitEmployee(kase, actor);
    }
  }

  /** Offboarding clearance gate: move the employee to `exited`, stamping the anchor (exit) date. */
  private async exitEmployee(kase: LifecycleCase, actor: AuthenticatedUser): Promise<void> {
    const [emp] = await this.db
      .select({ status: employees.status })
      .from(employees)
      .where(eq(employees.id, kase.employeeId))
      .limit(1);
    if (!emp || emp.status === 'exited') return;

    await this.db
      .update(employees)
      .set({ status: 'exited', dateOfExit: kase.anchorDate, updatedBy: actor.id, updatedAt: new Date() })
      .where(eq(employees.id, kase.employeeId));

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'employee.exit_via_offboarding',
      target: `employee:${kase.employeeId}`,
      before: { status: emp.status },
      after: { status: 'exited', caseId: kase.id },
    });
  }

  /** Pick the best-matching active template for an employee; most specific wins, newest breaks ties. */
  private async autoSelectTemplate(
    type: LifecycleCase['type'],
    employee: EmployeeForCase,
  ): Promise<ChecklistTemplate> {
    const candidates = await this.db
      .select()
      .from(checklistTemplates)
      .where(and(eq(checklistTemplates.type, type), eq(checklistTemplates.isActive, true)))
      .orderBy(desc(checklistTemplates.createdAt));

    let best: ChecklistTemplate | undefined;
    let bestScore = -1;
    for (const template of candidates) {
      const score = this.matchScore(template.appliesTo as AppliesTo | null, employee);
      if (score > bestScore) {
        best = template;
        bestScore = score;
      }
    }
    if (!best) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        `No active ${type} template matches this employee; create one or pass templateId`,
        HttpStatus.NOT_FOUND,
      );
    }
    return best;
  }

  /**
   * Match score for a template's `applies_to` against an employee. A present dimension that does not
   * include the employee's value disqualifies the template (returns -1). Otherwise the score is the
   * count of matched present dimensions (higher = more specific).
   */
  private matchScore(appliesTo: AppliesTo | null, employee: EmployeeForCase): number {
    if (!appliesTo) return 0;
    let score = 0;
    const check = (values: string[] | undefined, actual: string | null): boolean | null => {
      if (!values || values.length === 0) return null; // wildcard
      if (actual !== null && values.includes(actual)) return true;
      return false;
    };
    for (const [values, actual] of [
      [appliesTo.employmentTypes, employee.employmentType],
      [appliesTo.departmentIds, employee.departmentId],
      [appliesTo.locations, employee.workLocation],
    ] as const) {
      const result = check(values, actual);
      if (result === false) return -1;
      if (result === true) score++;
    }
    return score;
  }

  /** Resolve a template item's assignee role to a concrete employee for this case. */
  private resolveAssignee(role: string, employee: EmployeeForCase, creatorId: string): string {
    switch (role) {
      case 'employee':
        return employee.id;
      case 'manager':
        return employee.managerId ?? creatorId;
      // `hr` and `it` have no single owner column yet — default to the HR creator, reassignable later.
      default:
        return creatorId;
    }
  }

  /** Notify each distinct assignee of a freshly-created case that they have tasks. */
  private async notifyAssignees(caseId: string, type: LifecycleCase['type']): Promise<void> {
    const rows = await this.db
      .selectDistinct({ assigneeId: checklistTasks.assigneeId })
      .from(checklistTasks)
      .where(eq(checklistTasks.caseId, caseId));
    const label = type === 'onboarding' ? 'onboarding' : 'offboarding';
    for (const r of rows) {
      if (r.assigneeId) {
        await this.notify(r.assigneeId, `New ${label} tasks assigned`, `You have ${label} checklist tasks to complete.`, '/tasks');
      }
    }
  }

  private async notify(employeeId: string, title: string, body: string, href: string): Promise<void> {
    await this.db.insert(notifications).values({ employeeId, title, body, href });
  }

  /** Add `days` to an ISO date string, returning an ISO date string. */
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

  // ── access checks & fetch helpers ────────────────────────────────────────────

  private async assertCanViewCase(
    kase: LifecycleCase,
    tasks: { assigneeId: string | null }[],
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (isAdminOrAbove(actor)) return;
    if (kase.employeeId === actor.id) return;
    if (kase.createdBy === actor.id) return;
    if (tasks.some((t) => t.assigneeId === actor.id)) return;
    if (await this.employeesService.isManagerOf(actor.id, kase.employeeId)) return;
    throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view this case', HttpStatus.FORBIDDEN);
  }

  private async assertCanEditTask(
    task: ChecklistTask,
    actor: AuthenticatedUser,
    reassigning: boolean,
  ): Promise<void> {
    if (isAdminOrAbove(actor)) return;
    if (reassigning) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Only HR/Admin can reassign a task', HttpStatus.FORBIDDEN);
    }
    if (task.assigneeId === actor.id) return;
    throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to update this task', HttpStatus.FORBIDDEN);
  }

  private async assertDocumentExists(id: string): Promise<void> {
    const [row] = await this.db.select({ id: documents.id }).from(documents).where(eq(documents.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Linked document not found', HttpStatus.NOT_FOUND);
  }

  private async getEmployee(id: string): Promise<EmployeeForCase> {
    const [row] = await this.db
      .select({
        id: employees.id,
        managerId: employees.managerId,
        departmentId: employees.departmentId,
        employmentType: employees.employmentType,
        workLocation: employees.workLocation,
        dateOfJoining: employees.dateOfJoining,
        dateOfExit: employees.dateOfExit,
      })
      .from(employees)
      .where(eq(employees.id, id))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Employee not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getTemplateRow(id: string): Promise<ChecklistTemplate> {
    const [row] = await this.db.select().from(checklistTemplates).where(eq(checklistTemplates.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Template not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getCaseRow(id: string): Promise<LifecycleCase> {
    const [row] = await this.db.select().from(lifecycleCases).where(eq(lifecycleCases.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Case not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getTaskRow(id: string): Promise<ChecklistTask> {
    const [row] = await this.db.select().from(checklistTasks).where(eq(checklistTasks.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Task not found', HttpStatus.NOT_FOUND);
    return row;
  }
}

type EmployeeForCase = {
  id: string;
  managerId: string | null;
  departmentId: string | null;
  employmentType: string;
  workLocation: string;
  dateOfJoining: string;
  dateOfExit: string | null;
};
