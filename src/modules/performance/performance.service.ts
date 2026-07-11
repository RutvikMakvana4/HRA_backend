import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client';
import {
  employees,
  feedback,
  goals,
  notifications,
  oneOnOnes,
  reviewCycles,
  reviewTemplates,
  reviews,
  type ActionItem,
  type Goal,
  type OneOnOne,
  type Review,
  type ReviewCycle,
  type ReviewTemplate,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove } from '../auth/roles';
import { EmployeesService } from '../employees/employees.service';
import type {
  AssignPeerDto,
  CreateCycleDto,
  CreateFeedbackDto,
  CreateGoalDto,
  CreateOneOnOneDto,
  CreateTemplateDto,
  ListFeedbackDto,
  ListGoalsDto,
  ListOneOnOnesDto,
  ListReviewsDto,
  SubmitReviewDto,
  UpdateCycleDto,
  UpdateGoalDto,
  UpdateOneOnOneDto,
  UpdateReviewDto,
  UpdateTemplateDto,
} from './dto/performance.dto';

@Injectable()
export class PerformanceService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly employeesService: EmployeesService,
  ) {}

  // ── Review cycles (HR) ───────────────────────────────────────────────────────

  listCycles() {
    return this.db
      .select({
        id: reviewCycles.id,
        name: reviewCycles.name,
        type: reviewCycles.type,
        startDate: reviewCycles.startDate,
        endDate: reviewCycles.endDate,
        status: reviewCycles.status,
        templateId: reviewCycles.templateId,
        includesSelfReview: reviewCycles.includesSelfReview,
        includesPeerReview: reviewCycles.includesPeerReview,
        includesManagerReview: reviewCycles.includesManagerReview,
        activatedAt: reviewCycles.activatedAt,
        closedAt: reviewCycles.closedAt,
        createdAt: reviewCycles.createdAt,
        updatedAt: reviewCycles.updatedAt,
        reviewCount: sql<number>`cast((select count(*) from reviews r where r.cycle_id = "review_cycles"."id") as int)`,
        submittedCount: sql<number>`cast((select count(*) from reviews r where r.cycle_id = "review_cycles"."id" and r.status = 'submitted') as int)`,
      })
      .from(reviewCycles)
      .orderBy(desc(reviewCycles.startDate));
  }

  async createCycle(dto: CreateCycleDto, actor: AuthenticatedUser) {
    const [row] = await this.db
      .insert(reviewCycles)
      .values({
        name: dto.name,
        type: dto.type,
        startDate: dto.startDate,
        endDate: dto.endDate,
        templateId: dto.templateId ?? null,
        includesSelfReview: dto.includesSelfReview,
        includesPeerReview: dto.includesPeerReview,
        includesManagerReview: dto.includesManagerReview,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create review cycle');
    await this.record(actor, 'review_cycle.create', `review_cycle:${row.id}`, {
      after: { name: row.name, type: row.type },
    });
    return row;
  }

  async updateCycle(id: string, dto: UpdateCycleDto, actor: AuthenticatedUser) {
    const cycle = await this.getCycleRow(id);
    if (cycle.status !== 'draft') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Cycle is ${cycle.status}; only draft cycles are editable`,
        HttpStatus.CONFLICT,
      );
    }
    const patch: Partial<typeof reviewCycles.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.startDate !== undefined) patch.startDate = dto.startDate;
    if (dto.endDate !== undefined) patch.endDate = dto.endDate;
    if (dto.templateId !== undefined) patch.templateId = dto.templateId;
    if (dto.includesSelfReview !== undefined) patch.includesSelfReview = dto.includesSelfReview;
    if (dto.includesPeerReview !== undefined) patch.includesPeerReview = dto.includesPeerReview;
    if (dto.includesManagerReview !== undefined)
      patch.includesManagerReview = dto.includesManagerReview;
    const [row] = await this.db
      .update(reviewCycles)
      .set(patch)
      .where(eq(reviewCycles.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update review cycle');
    await this.record(actor, 'review_cycle.update', `review_cycle:${id}`, { after: { name: row.name } });
    return row;
  }

  /**
   * Activate a cycle: snapshot `review` rows for every active employee based on the enabled review
   * types (self / manager). Peer reviews are nominated separately (`assignPeer`). Idempotent-ish:
   * only draft cycles can be activated.
   */
  async activateCycle(id: string, actor: AuthenticatedUser) {
    const cycle = await this.getCycleRow(id);
    if (cycle.status !== 'draft') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Cycle is ${cycle.status}; only draft cycles can be activated`,
        HttpStatus.CONFLICT,
      );
    }
    if (!cycle.templateId) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Set a review template on the cycle before activating',
      );
    }

    const participants = await this.db
      .select({ id: employees.id, managerId: employees.managerId })
      .from(employees)
      .where(eq(employees.status, 'active'));

    const rows: (typeof reviews.$inferInsert)[] = [];
    for (const p of participants) {
      if (cycle.includesSelfReview) {
        rows.push({
          cycleId: id,
          subjectEmployeeId: p.id,
          reviewerId: p.id,
          type: 'self',
          templateId: cycle.templateId,
        });
      }
      if (cycle.includesManagerReview && p.managerId) {
        rows.push({
          cycleId: id,
          subjectEmployeeId: p.id,
          reviewerId: p.managerId,
          type: 'manager',
          templateId: cycle.templateId,
        });
      }
    }

    await this.db.transaction(async (tx) => {
      if (rows.length > 0) await tx.insert(reviews).values(rows);
      await tx
        .update(reviewCycles)
        .set({ status: 'active', activatedAt: new Date(), updatedAt: new Date() })
        .where(eq(reviewCycles.id, id));
    });

    // Notify each reviewer that they have reviews to complete.
    const reviewerIds = [...new Set(rows.map((r) => r.reviewerId))];
    for (const reviewerId of reviewerIds) {
      await this.notify(
        reviewerId,
        'Review cycle opened',
        `"${cycle.name}" is now active — you have reviews to complete.`,
        '/me/reviews',
      );
    }

    await this.record(actor, 'review_cycle.activate', `review_cycle:${id}`, {
      before: { status: 'draft' },
      after: { status: 'active', generatedReviews: rows.length },
    });
    return { ...(await this.getCycleRow(id)), generatedReviews: rows.length };
  }

  async closeCycle(id: string, actor: AuthenticatedUser) {
    const cycle = await this.getCycleRow(id);
    if (cycle.status !== 'active') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Only active cycles can be closed (cycle is ${cycle.status})`,
        HttpStatus.CONFLICT,
      );
    }
    const [row] = await this.db
      .update(reviewCycles)
      .set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
      .where(eq(reviewCycles.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to close cycle');
    await this.record(actor, 'review_cycle.close', `review_cycle:${id}`, {
      before: { status: 'active' },
      after: { status: 'closed' },
    });
    return row;
  }

  // ── Review templates (HR) ─────────────────────────────────────────────────────

  listTemplates(): Promise<ReviewTemplate[]> {
    return this.db.select().from(reviewTemplates).orderBy(asc(reviewTemplates.name));
  }

  async createTemplate(dto: CreateTemplateDto, actor: AuthenticatedUser) {
    const [row] = await this.db
      .insert(reviewTemplates)
      .values({
        name: dto.name,
        competencies: dto.competencies.map((c) => ({ ...c, id: c.id ?? randomUUID() })),
        openQuestions: dto.openQuestions,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create template');
    await this.record(actor, 'review_template.create', `review_template:${row.id}`, {
      after: { name: row.name },
    });
    return row;
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto, actor: AuthenticatedUser) {
    await this.getTemplateRow(id);
    const patch: Partial<typeof reviewTemplates.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.competencies !== undefined) {
      patch.competencies = dto.competencies.map((c) => ({ ...c, id: c.id ?? randomUUID() }));
    }
    if (dto.openQuestions !== undefined) patch.openQuestions = dto.openQuestions;
    const [row] = await this.db
      .update(reviewTemplates)
      .set(patch)
      .where(eq(reviewTemplates.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update template');
    await this.record(actor, 'review_template.update', `review_template:${id}`, {
      after: { name: row.name },
    });
    return row;
  }

  // ── Goals ──────────────────────────────────────────────────────────────────────

  async listGoals(query: ListGoalsDto, actor: AuthenticatedUser): Promise<Goal[]> {
    const filters: SQL[] = [];

    if (query.scope === 'team') {
      // Mirrors listReviews' `team` branch: admins see every goal org-wide (the page is
      // admin-gated); everyone else sees only their direct reports'. `employeeId` is ignored.
      if (!isAdminOrAbove(actor)) {
        const reportIds = await this.directReportIds(actor.id);
        if (reportIds.length === 0) return [];
        filters.push(inArray(goals.employeeId, reportIds));
      }
    } else {
      const targetEmployeeId = query.employeeId ?? actor.id;
      await this.assertCanViewEmployee(actor, targetEmployeeId);
      filters.push(eq(goals.employeeId, targetEmployeeId));
    }

    if (query.cycleId) filters.push(eq(goals.cycleId, query.cycleId));

    const rows = this.db.select().from(goals);
    return filters.length
      ? rows.where(and(...filters)).orderBy(asc(goals.createdAt))
      : rows.orderBy(asc(goals.createdAt));
  }

  async createGoal(dto: CreateGoalDto, actor: AuthenticatedUser) {
    const employeeId = dto.employeeId ?? actor.id;
    if (employeeId !== actor.id) await this.assertCanManageEmployee(actor, employeeId);
    else await this.employeesService.ensureExists(employeeId);

    if (dto.parentGoalId) {
      const parent = await this.getGoalRow(dto.parentGoalId);
      if (parent.employeeId !== employeeId) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          'Parent goal must belong to the same employee',
        );
      }
    }
    if (dto.cycleId) await this.getCycleRow(dto.cycleId);

    const [row] = await this.db
      .insert(goals)
      .values({
        employeeId,
        cycleId: dto.cycleId ?? null,
        parentGoalId: dto.parentGoalId ?? null,
        title: dto.title,
        description: dto.description ?? null,
        category: dto.category,
        weight: dto.weight ?? null,
        metricTarget: dto.metricTarget ?? null,
        progressPct: dto.progressPct,
        status: dto.status,
        dueDate: dto.dueDate ?? null,
        createdBy: actor.id,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create goal');
    if (row.parentGoalId) await this.rollUpParentProgress(row.parentGoalId);
    await this.record(actor, 'goal.create', `goal:${row.id}`, {
      after: { title: row.title, employeeId },
    });
    return row;
  }

  async updateGoal(id: string, dto: UpdateGoalDto, actor: AuthenticatedUser) {
    const goal = await this.getGoalRow(id);
    if (goal.employeeId !== actor.id) await this.assertCanManageEmployee(actor, goal.employeeId);

    if (dto.parentGoalId) {
      if (dto.parentGoalId === id) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, 'A goal cannot be its own parent');
      }
      const parent = await this.getGoalRow(dto.parentGoalId);
      if (parent.employeeId !== goal.employeeId) {
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          'Parent goal must belong to the same employee',
        );
      }
    }
    if (dto.cycleId) await this.getCycleRow(dto.cycleId);

    const patch: Partial<typeof goals.$inferInsert> = { updatedAt: new Date() };
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.cycleId !== undefined) patch.cycleId = dto.cycleId;
    if (dto.parentGoalId !== undefined) patch.parentGoalId = dto.parentGoalId;
    if (dto.weight !== undefined) patch.weight = dto.weight;
    if (dto.metricTarget !== undefined) patch.metricTarget = dto.metricTarget;
    if (dto.progressPct !== undefined) patch.progressPct = dto.progressPct;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.dueDate !== undefined) patch.dueDate = dto.dueDate;

    const [row] = await this.db.update(goals).set(patch).where(eq(goals.id, id)).returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update goal');

    // Roll up progress to the (old and/or new) parent when a child's progress/weight changes.
    const parentsToRoll = new Set<string>();
    if (goal.parentGoalId) parentsToRoll.add(goal.parentGoalId);
    if (row.parentGoalId) parentsToRoll.add(row.parentGoalId);
    for (const p of parentsToRoll) await this.rollUpParentProgress(p);

    await this.record(actor, 'goal.update', `goal:${id}`, {
      after: { title: row.title, progressPct: row.progressPct, status: row.status },
    });
    return row;
  }

  async deleteGoal(id: string, actor: AuthenticatedUser) {
    const goal = await this.getGoalRow(id);
    if (goal.employeeId !== actor.id) await this.assertCanManageEmployee(actor, goal.employeeId);
    await this.db.delete(goals).where(eq(goals.id, id));
    if (goal.parentGoalId) await this.rollUpParentProgress(goal.parentGoalId);
    await this.record(actor, 'goal.delete', `goal:${id}`, { before: { title: goal.title } });
    return { id, deleted: true };
  }

  /**
   * Auto-roll a parent objective's progress from its children (PRD §3): weighted average when every
   * child carries a weight (>0), otherwise a simple average. No-op if the goal has no children.
   */
  private async rollUpParentProgress(parentId: string): Promise<void> {
    const children = await this.db
      .select({ progressPct: goals.progressPct, weight: goals.weight })
      .from(goals)
      .where(eq(goals.parentGoalId, parentId));
    if (children.length === 0) return;

    const allWeighted = children.every((c) => c.weight != null && c.weight > 0);
    let rolled: number;
    if (allWeighted) {
      const totalWeight = children.reduce((s, c) => s + (c.weight ?? 0), 0);
      const weighted = children.reduce((s, c) => s + c.progressPct * (c.weight ?? 0), 0);
      rolled = Math.round(weighted / totalWeight);
    } else {
      rolled = Math.round(children.reduce((s, c) => s + c.progressPct, 0) / children.length);
    }
    await this.db
      .update(goals)
      .set({ progressPct: rolled, updatedAt: new Date() })
      .where(eq(goals.id, parentId));
  }

  // ── Reviews ──────────────────────────────────────────────────────────────────

  async listReviews(query: ListReviewsDto, actor: AuthenticatedUser) {
    const filters: SQL[] = [];
    if (query.scope === 'me') {
      filters.push(eq(reviews.subjectEmployeeId, actor.id));
      // Self reviews are always visible to the subject; manager/peer reviews about them only once
      // their cycle has closed (mirrors `assertCanViewReview`'s per-review gate).
      const visibleType = or(eq(reviews.type, 'self'), eq(reviewCycles.status, 'closed'));
      if (visibleType) filters.push(visibleType);
    } else if (query.scope === 'to-complete') {
      filters.push(eq(reviews.reviewerId, actor.id));
      // "To complete" excludes reviews the reviewer has already submitted — a submitted review
      // is final (see `assertReviewEditable`) so it must not keep showing up as actionable.
      filters.push(eq(reviews.status, 'pending'));
    } else {
      // team: admins see every review org-wide (the page is admin-gated); everyone
      // else sees only their direct reports'.
      if (!isAdminOrAbove(actor)) {
        const reportIds = await this.directReportIds(actor.id);
        if (reportIds.length === 0) return [];
        filters.push(inArray(reviews.subjectEmployeeId, reportIds));
      }
    }
    if (query.cycleId) filters.push(eq(reviews.cycleId, query.cycleId));

    const reviewer = alias(employees, 'reviewer');

    return this.db
      .select({
        id: reviews.id,
        cycleId: reviews.cycleId,
        cycleName: reviewCycles.name,
        cycleStatus: reviewCycles.status,
        subjectEmployeeId: reviews.subjectEmployeeId,
        subjectName: this.nameExpr(),
        reviewerId: reviews.reviewerId,
        reviewerName: sql<string | null>`coalesce(${reviewer.displayName}, ${reviewer.firstName} || ' ' || ${reviewer.lastName})`,
        type: reviews.type,
        templateId: reviews.templateId,
        overallRating: reviews.overallRating,
        status: reviews.status,
        submittedAt: reviews.submittedAt,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .innerJoin(reviewCycles, eq(reviewCycles.id, reviews.cycleId))
      .innerJoin(employees, eq(employees.id, reviews.subjectEmployeeId))
      .leftJoin(reviewer, eq(reviewer.id, reviews.reviewerId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(reviews.createdAt));
  }

  async getReview(id: string, actor: AuthenticatedUser) {
    const review = await this.getReviewRow(id);
    await this.assertCanViewReview(review, actor);
    const [template] = review.templateId
      ? await this.db.select().from(reviewTemplates).where(eq(reviewTemplates.id, review.templateId)).limit(1)
      : [undefined];
    return { ...review, template: template ?? null };
  }

  /** Save review responses in draft (reviewer only, before submission). */
  async updateReview(id: string, dto: UpdateReviewDto, actor: AuthenticatedUser) {
    const review = await this.getReviewRow(id);
    this.assertReviewer(review, actor);
    this.assertReviewEditable(review);
    const patch: Partial<typeof reviews.$inferInsert> = { updatedAt: new Date() };
    if (dto.responses !== undefined) patch.responses = dto.responses;
    if (dto.overallRating !== undefined) patch.overallRating = dto.overallRating;
    const [row] = await this.db.update(reviews).set(patch).where(eq(reviews.id, id)).returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update review');
    await this.record(actor, 'review.update', `review:${id}`, { after: { status: row.status } });
    return row;
  }

  async submitReview(id: string, dto: SubmitReviewDto, actor: AuthenticatedUser) {
    const review = await this.getReviewRow(id);
    this.assertReviewer(review, actor);
    this.assertReviewEditable(review);
    const [row] = await this.db
      .update(reviews)
      .set({
        responses: dto.responses ?? review.responses,
        overallRating: dto.overallRating ?? review.overallRating,
        status: 'submitted',
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviews.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to submit review');
    await this.record(actor, 'review.submit', `review:${id}`, {
      before: { status: 'pending' },
      after: { status: 'submitted' },
    });
    // The subject sees manager/peer reviews only once the cycle closes; notify the manager reviewer's
    // completion to the subject is deferred to cycle close. Self-reviews notify the manager.
    if (row.type === 'self' && row.subjectEmployeeId !== row.reviewerId) {
      // (self reviewer is always the subject; nothing to notify)
    }
    return row;
  }

  /** Manager/HR nominates a peer reviewer for a subject in an active cycle (PRD §3). */
  async assignPeer(cycleId: string, dto: AssignPeerDto, actor: AuthenticatedUser) {
    const cycle = await this.getCycleRow(cycleId);
    if (cycle.status !== 'active') {
      throw new AppError(ErrorCode.CONFLICT, 'Peers can only be assigned on an active cycle', HttpStatus.CONFLICT);
    }
    if (!cycle.includesPeerReview) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'This cycle does not include peer reviews');
    }
    await this.assertCanManageEmployee(actor, dto.subjectEmployeeId);
    await this.employeesService.ensureExists(dto.reviewerId);
    if (dto.reviewerId === dto.subjectEmployeeId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'A peer reviewer cannot be the subject');
    }

    const [existing] = await this.db
      .select({ id: reviews.id })
      .from(reviews)
      .where(
        and(
          eq(reviews.cycleId, cycleId),
          eq(reviews.subjectEmployeeId, dto.subjectEmployeeId),
          eq(reviews.reviewerId, dto.reviewerId),
          eq(reviews.type, 'peer'),
        ),
      )
      .limit(1);
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, 'That peer review already exists', HttpStatus.CONFLICT);
    }

    const [row] = await this.db
      .insert(reviews)
      .values({
        cycleId,
        subjectEmployeeId: dto.subjectEmployeeId,
        reviewerId: dto.reviewerId,
        type: 'peer',
        templateId: cycle.templateId,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to assign peer reviewer');
    await this.notify(
      dto.reviewerId,
      'Peer review requested',
      `You've been asked to submit a peer review for "${cycle.name}".`,
      '/me/reviews',
    );
    await this.record(actor, 'review.assign_peer', `review:${row.id}`, {
      after: { subjectEmployeeId: dto.subjectEmployeeId, reviewerId: dto.reviewerId },
    });
    return row;
  }

  // ── 1:1s ─────────────────────────────────────────────────────────────────────

  async listOneOnOnes(query: ListOneOnOnesDto, actor: AuthenticatedUser) {
    const filters: SQL[] = [];
    if (query.employeeId) {
      await this.assertOneOnOneParticipantScope(actor, query.employeeId);
      filters.push(eq(oneOnOnes.employeeId, query.employeeId));
    } else {
      // Default: 1:1s I'm a participant in (either as manager or employee).
      filters.push(
        sql`(${oneOnOnes.managerId} = ${actor.id} OR ${oneOnOnes.employeeId} = ${actor.id})`,
      );
    }
    const rows = await this.db
      .select()
      .from(oneOnOnes)
      .where(and(...filters))
      .orderBy(desc(oneOnOnes.date));
    const redacted = await Promise.all(rows.map((r) => this.redactOneOnOne(r, actor)));
    return Promise.all(redacted.map((r) => this.withParticipantNames(r)));
  }

  async createOneOnOne(dto: CreateOneOnOneDto, actor: AuthenticatedUser) {
    // Resolve the two participants. An employee may log a 1:1 with their manager; a manager may
    // schedule one with a report. The actor must be one of the two participants (or admin).
    const employeeId = dto.employeeId ?? actor.id;
    let managerId = dto.managerId;
    if (!managerId) {
      const [emp] = await this.db
        .select({ managerId: employees.managerId })
        .from(employees)
        .where(eq(employees.id, employeeId))
        .limit(1);
      managerId = emp?.managerId ?? undefined;
    }
    if (!managerId) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'No manager resolved for this 1:1');
    }
    await this.employeesService.ensureExists(employeeId);
    await this.employeesService.ensureExists(managerId);

    const isParticipant = actor.id === managerId || actor.id === employeeId;
    if (!isParticipant && !isAdminOrAbove(actor)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not a participant of this 1:1', HttpStatus.FORBIDDEN);
    }
    // Only the manager (or admin) may record private notes.
    if (dto.privateNotes != null && actor.id !== managerId && !isAdminOrAbove(actor)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Only the manager can add private notes', HttpStatus.FORBIDDEN);
    }

    const [row] = await this.db
      .insert(oneOnOnes)
      .values({
        managerId,
        employeeId,
        date: dto.date,
        sharedNotes: dto.sharedNotes ?? null,
        privateNotes: dto.privateNotes ?? null,
        actionItems: this.withItemIds(dto.actionItems),
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create 1:1');
    // Notify the other participant.
    const other = actor.id === managerId ? employeeId : managerId;
    await this.notify(other, '1:1 logged', `A 1:1 was scheduled for ${dto.date}.`, '/me/one-on-ones');
    await this.record(actor, 'one_on_one.create', `one_on_one:${row.id}`, {
      after: { managerId, employeeId, date: dto.date },
    });
    return this.withParticipantNames(await this.redactOneOnOne(row, actor));
  }

  async updateOneOnOne(id: string, dto: UpdateOneOnOneDto, actor: AuthenticatedUser) {
    const oneOnOne = await this.getOneOnOneRow(id);
    const isManager = actor.id === oneOnOne.managerId || isAdminOrAbove(actor);
    const isParticipant = isManager || actor.id === oneOnOne.employeeId;
    if (!isParticipant) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not a participant of this 1:1', HttpStatus.FORBIDDEN);
    }
    if (dto.privateNotes !== undefined && !isManager) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Only the manager can edit private notes', HttpStatus.FORBIDDEN);
    }
    const patch: Partial<typeof oneOnOnes.$inferInsert> = { updatedAt: new Date() };
    if (dto.date !== undefined) patch.date = dto.date;
    if (dto.sharedNotes !== undefined) patch.sharedNotes = dto.sharedNotes;
    if (dto.privateNotes !== undefined) patch.privateNotes = dto.privateNotes;
    if (dto.actionItems !== undefined) patch.actionItems = this.withItemIds(dto.actionItems);
    const [row] = await this.db.update(oneOnOnes).set(patch).where(eq(oneOnOnes.id, id)).returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update 1:1');
    await this.record(actor, 'one_on_one.update', `one_on_one:${id}`, { after: { date: row.date } });
    return this.withParticipantNames(await this.redactOneOnOne(row, actor));
  }

  // ── Feedback ───────────────────────────────────────────────────────────────

  async createFeedback(dto: CreateFeedbackDto, actor: AuthenticatedUser) {
    if (dto.toEmployeeId === actor.id) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Cannot give feedback to yourself');
    }
    await this.employeesService.ensureExists(dto.toEmployeeId);
    const [row] = await this.db
      .insert(feedback)
      .values({
        fromEmployeeId: actor.id,
        toEmployeeId: dto.toEmployeeId,
        type: dto.type,
        visibility: dto.visibility,
        text: dto.text,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create feedback');
    await this.notify(
      dto.toEmployeeId,
      'New feedback received',
      `You received ${dto.type} feedback.`,
      '/me/feedback',
    );
    await this.record(actor, 'feedback.create', `feedback:${row.id}`, {
      after: { toEmployeeId: dto.toEmployeeId, type: dto.type, visibility: dto.visibility },
    });
    const [enriched] = await this.withFeedbackNames([row]);
    return enriched!;
  }

  async listFeedback(query: ListFeedbackDto, actor: AuthenticatedUser) {
    if (query.scope === 'given') {
      const rows = await this.db
        .select()
        .from(feedback)
        .where(eq(feedback.fromEmployeeId, actor.id))
        .orderBy(desc(feedback.createdAt));
      return this.withFeedbackNames(rows);
    }
    if (query.scope === 'team') {
      // Admins see every manager-visible note org-wide; everyone else sees only their direct
      // reports'. `manager_visible` is enforced on both paths — private feedback never leaks.
      const filters: SQL[] = [eq(feedback.visibility, 'manager_visible')];
      if (!isAdminOrAbove(actor)) {
        const reportIds = await this.directReportIds(actor.id);
        if (reportIds.length === 0) return [];
        filters.push(inArray(feedback.toEmployeeId, reportIds));
      }
      const rows = await this.db
        .select()
        .from(feedback)
        .where(and(...filters))
        .orderBy(desc(feedback.createdAt));
      return this.withFeedbackNames(rows);
    }
    // received: everything addressed to me, regardless of visibility.
    const rows = await this.db
      .select()
      .from(feedback)
      .where(eq(feedback.toEmployeeId, actor.id))
      .orderBy(desc(feedback.createdAt));
    return this.withFeedbackNames(rows);
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private async assertCanViewReview(review: Review, actor: AuthenticatedUser): Promise<void> {
    if (isAdminOrAbove(actor)) return;
    if (review.reviewerId === actor.id) return;
    if (review.subjectEmployeeId === actor.id) {
      // The subject can always see their own self-review; manager/peer reviews only once the
      // cycle is closed (and submitted).
      if (review.type === 'self') return;
      const cycle = await this.getCycleRow(review.cycleId);
      if (cycle.status === 'closed' && review.status === 'submitted') return;
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'This review is visible once the cycle closes',
        HttpStatus.FORBIDDEN,
      );
    }
    if (await this.employeesService.isManagerOf(actor.id, review.subjectEmployeeId)) return;
    throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view this review', HttpStatus.FORBIDDEN);
  }

  private assertReviewer(review: Review, actor: AuthenticatedUser): void {
    if (review.reviewerId !== actor.id) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Only the assigned reviewer can edit this review', HttpStatus.FORBIDDEN);
    }
  }

  private assertReviewEditable(review: Review): void {
    if (review.status === 'submitted') {
      throw new AppError(ErrorCode.CONFLICT, 'A submitted review is immutable', HttpStatus.CONFLICT);
    }
  }

  /** The employee can see their own; managers (of) and admins can see reports'. */
  private async assertCanViewEmployee(actor: AuthenticatedUser, employeeId: string): Promise<void> {
    if (employeeId === actor.id) return;
    if (isAdminOrAbove(actor)) return;
    if (await this.employeesService.isManagerOf(actor.id, employeeId)) return;
    throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view this employee', HttpStatus.FORBIDDEN);
  }

  /** Managers (of) and admins may mutate another employee's records. */
  private async assertCanManageEmployee(actor: AuthenticatedUser, employeeId: string): Promise<void> {
    if (isAdminOrAbove(actor)) return;
    if (await this.employeesService.isManagerOf(actor.id, employeeId)) return;
    throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to manage this employee', HttpStatus.FORBIDDEN);
  }

  private async assertOneOnOneParticipantScope(
    actor: AuthenticatedUser,
    employeeId: string,
  ): Promise<void> {
    if (employeeId === actor.id) return;
    if (isAdminOrAbove(actor)) return;
    if (await this.employeesService.isManagerOf(actor.id, employeeId)) return;
    throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view these 1:1s', HttpStatus.FORBIDDEN);
  }

  /** Give every action item a stable uuid, preserving ids the caller already sent. */
  private withItemIds(items: ActionItem[]): ActionItem[] {
    return items.map((item) => ({ ...item, id: item.id ?? randomUUID() }));
  }

  /** Attach the two participants' display names to a 1:1 row. */
  private async withParticipantNames<T extends { managerId: string; employeeId: string }>(
    row: T,
  ): Promise<T & { managerName: string | null; employeeName: string | null }> {
    const rows = await this.db
      .select({ id: employees.id, displayName: employees.displayName })
      .from(employees)
      .where(inArray(employees.id, [row.managerId, row.employeeId]));
    const byId = new Map(rows.map((e) => [e.id, e.displayName]));
    return {
      ...row,
      managerName: byId.get(row.managerId) ?? null,
      employeeName: byId.get(row.employeeId) ?? null,
    };
  }

  /** Attach the author's and recipient's display names to a feedback row. */
  private async withFeedbackNames<T extends { fromEmployeeId: string; toEmployeeId: string }>(
    rows: T[],
  ): Promise<(T & { fromName: string | null; toName: string | null })[]> {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.flatMap((r) => [r.fromEmployeeId, r.toEmployeeId]))];
    const people = await this.db
      .select({ id: employees.id, displayName: employees.displayName })
      .from(employees)
      .where(inArray(employees.id, ids));
    const byId = new Map(people.map((e) => [e.id, e.displayName]));
    return rows.map((r) => ({
      ...r,
      fromName: byId.get(r.fromEmployeeId) ?? null,
      toName: byId.get(r.toEmployeeId) ?? null,
    }));
  }

  /** Strip manager-only `privateNotes` unless the viewer is the manager or an admin. */
  private async redactOneOnOne(row: OneOnOne, actor: AuthenticatedUser): Promise<OneOnOne> {
    const canSeePrivate = actor.id === row.managerId || isAdminOrAbove(actor);
    if (canSeePrivate) return row;
    return { ...row, privateNotes: null };
  }

  private async directReportIds(managerId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.managerId, managerId));
    return rows.map((r) => r.id);
  }

  private async getCycleRow(id: string): Promise<ReviewCycle> {
    const [row] = await this.db.select().from(reviewCycles).where(eq(reviewCycles.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Review cycle not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getTemplateRow(id: string): Promise<ReviewTemplate> {
    const [row] = await this.db.select().from(reviewTemplates).where(eq(reviewTemplates.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Review template not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getGoalRow(id: string): Promise<Goal> {
    const [row] = await this.db.select().from(goals).where(eq(goals.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Goal not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getReviewRow(id: string): Promise<Review> {
    const [row] = await this.db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Review not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getOneOnOneRow(id: string): Promise<OneOnOne> {
    const [row] = await this.db.select().from(oneOnOnes).where(eq(oneOnOnes.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, '1:1 not found', HttpStatus.NOT_FOUND);
    return row;
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
