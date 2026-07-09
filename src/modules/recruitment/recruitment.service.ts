import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  applications,
  candidates,
  departments,
  documents,
  employees,
  interviewScorecards,
  interviews,
  jobOpenings,
  notifications,
  offers,
  pipelineStages,
  type Application,
  type Candidate,
  type Interview,
  type JobOpening,
  type Offer,
  type PipelineStage,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove } from '../auth/roles';
import { EmployeesService } from '../employees/employees.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import type {
  CreateApplicationDto,
  CreateCandidateDto,
  CreateInterviewDto,
  CreateJobOpeningDto,
  CreateOfferDto,
  CreateStageDto,
  HireApplicationDto,
  ListApplicationsDto,
  ListCandidatesDto,
  ListInterviewsDto,
  ListJobOpeningsDto,
  MoveApplicationDto,
  RejectApplicationDto,
  SubmitScorecardDto,
  UpdateCandidateDto,
  UpdateInterviewDto,
  UpdateJobOpeningDto,
  UpdateOfferDto,
  UpdateStageDto,
} from './dto/recruitment.dto';

/** Default pipeline seeded lazily the first time stages are read/needed. Order matters. */
const DEFAULT_STAGES: { name: string; sortOrder: number; isTerminal: boolean }[] = [
  { name: 'Applied', sortOrder: 0, isTerminal: false },
  { name: 'Screening', sortOrder: 1, isTerminal: false },
  { name: 'Interview', sortOrder: 2, isTerminal: false },
  { name: 'Offer', sortOrder: 3, isTerminal: false },
  { name: 'Hired', sortOrder: 4, isTerminal: true },
  { name: 'Rejected', sortOrder: 5, isTerminal: true },
];

@Injectable()
export class RecruitmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly employeesService: EmployeesService,
    private readonly onboardingService: OnboardingService,
  ) {}

  // ── Pipeline stages (config) ─────────────────────────────────────────────────

  /** List stages, seeding the default pipeline on first use so the board is usable out of the box. */
  async listStages(): Promise<PipelineStage[]> {
    await this.ensureStages();
    return this.db.select().from(pipelineStages).orderBy(asc(pipelineStages.sortOrder));
  }

  async createStage(dto: CreateStageDto, actor: AuthenticatedUser) {
    const [row] = await this.db
      .insert(pipelineStages)
      .values({ name: dto.name, sortOrder: dto.sortOrder, isTerminal: dto.isTerminal })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create stage');
    await this.record(actor, 'pipeline_stage.create', `pipeline_stage:${row.id}`, {
      after: { name: row.name, sortOrder: row.sortOrder },
    });
    return row;
  }

  async updateStage(id: string, dto: UpdateStageDto, actor: AuthenticatedUser) {
    await this.getStageRow(id);
    const patch: Partial<typeof pipelineStages.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.isTerminal !== undefined) patch.isTerminal = dto.isTerminal;
    const [row] = await this.db
      .update(pipelineStages)
      .set(patch)
      .where(eq(pipelineStages.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update stage');
    await this.record(actor, 'pipeline_stage.update', `pipeline_stage:${id}`, {
      after: { name: row.name },
    });
    return row;
  }

  // ── Job openings ─────────────────────────────────────────────────────────────

  async listJobOpenings(query: ListJobOpeningsDto) {
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(jobOpenings.status, query.status));
    return this.db
      .select({
        id: jobOpenings.id,
        title: jobOpenings.title,
        departmentId: jobOpenings.departmentId,
        departmentName: departments.name,
        employmentType: jobOpenings.employmentType,
        hiringManagerId: jobOpenings.hiringManagerId,
        hiringManagerName: this.nameExpr(),
        location: jobOpenings.location,
        headcount: jobOpenings.headcount,
        status: jobOpenings.status,
        openedAt: jobOpenings.openedAt,
        closedAt: jobOpenings.closedAt,
        createdAt: jobOpenings.createdAt,
        activeCount: sql<number>`cast((select count(*) from applications a where a.job_opening_id = ${jobOpenings.id} and a.status = 'active') as int)`,
        hiredCount: sql<number>`cast((select count(*) from applications a where a.job_opening_id = ${jobOpenings.id} and a.status = 'hired') as int)`,
      })
      .from(jobOpenings)
      .leftJoin(employees, eq(employees.id, jobOpenings.hiringManagerId))
      .leftJoin(departments, eq(departments.id, jobOpenings.departmentId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(jobOpenings.openedAt));
  }

  async getJobOpening(id: string) {
    const opening = await this.getJobOpeningRow(id);
    const [dept] = opening.departmentId
      ? await this.db.select({ name: departments.name }).from(departments).where(eq(departments.id, opening.departmentId)).limit(1)
      : [];
    const hiredCount = await this.countHires(id);
    const [active] = await this.db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(applications)
      .where(and(eq(applications.jobOpeningId, id), eq(applications.status, 'active')));
    return { ...opening, departmentName: dept?.name ?? null, activeCount: active?.count ?? 0, hiredCount };
  }

  async createJobOpening(dto: CreateJobOpeningDto, actor: AuthenticatedUser) {
    if (dto.hiringManagerId) await this.employeesService.ensureExists(dto.hiringManagerId);
    const [row] = await this.db
      .insert(jobOpenings)
      .values({
        title: dto.title,
        departmentId: dto.departmentId ?? null,
        employmentType: dto.employmentType,
        hiringManagerId: dto.hiringManagerId ?? null,
        location: dto.location,
        headcount: dto.headcount,
        description: dto.description ?? null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create job opening');
    await this.record(actor, 'job_opening.create', `job_opening:${row.id}`, {
      after: { title: row.title, headcount: row.headcount },
    });
    return row;
  }

  async updateJobOpening(id: string, dto: UpdateJobOpeningDto, actor: AuthenticatedUser) {
    const before = await this.getJobOpeningRow(id);
    if (dto.hiringManagerId) await this.employeesService.ensureExists(dto.hiringManagerId);

    const patch: Partial<typeof jobOpenings.$inferInsert> = { updatedAt: new Date() };
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.departmentId !== undefined) patch.departmentId = dto.departmentId;
    if (dto.employmentType !== undefined) patch.employmentType = dto.employmentType;
    if (dto.hiringManagerId !== undefined) patch.hiringManagerId = dto.hiringManagerId;
    if (dto.location !== undefined) patch.location = dto.location;
    if (dto.headcount !== undefined) patch.headcount = dto.headcount;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.status !== undefined) {
      patch.status = dto.status;
      // Stamp/clear the close timestamp as the opening leaves/re-enters an open state.
      if ((dto.status === 'closed' || dto.status === 'filled') && !before.closedAt) {
        patch.closedAt = new Date();
      } else if (dto.status === 'open' || dto.status === 'on_hold') {
        patch.closedAt = null;
      }
    }

    const [row] = await this.db
      .update(jobOpenings)
      .set(patch)
      .where(eq(jobOpenings.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update job opening');
    await this.record(actor, 'job_opening.update', `job_opening:${id}`, {
      before: { status: before.status },
      after: { status: row.status },
    });
    return row;
  }

  // ── Candidates ───────────────────────────────────────────────────────────────

  listCandidates(query: ListCandidatesDto) {
    const filters: SQL[] = [];
    if (query.q) {
      const term = `%${query.q}%`;
      const match = or(ilike(candidates.fullName, term), ilike(candidates.email, term));
      if (match) filters.push(match);
    }
    return this.db
      .select({
        id: candidates.id,
        fullName: candidates.fullName,
        email: candidates.email,
        phone: candidates.phone,
        resumeDocumentId: candidates.resumeDocumentId,
        source: candidates.source,
        referredByEmployeeId: candidates.referredByEmployeeId,
        referredByName: sql<string | null>`(select coalesce(e.display_name, e.first_name || ' ' || e.last_name) from employees e where e.id = ${candidates.referredByEmployeeId})`,
        notes: candidates.notes,
        createdAt: candidates.createdAt,
      })
      .from(candidates)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(candidates.createdAt));
  }

  async getCandidate(id: string) {
    const candidate = await this.getCandidateRow(id);
    const [ref] = candidate.referredByEmployeeId
      ? await this.db.select({ name: this.nameExpr() }).from(employees).where(eq(employees.id, candidate.referredByEmployeeId)).limit(1)
      : [];
    const apps = await this.listApplications({ candidateId: id } as ListApplicationsDto);
    const appIds = apps.map((a) => a.id);
    // getCandidate has no actor (controller passes none) — the bundle shows every round for this
    // candidate's applications, so query interviews directly rather than via listInterviews.
    const rounds = appIds.length
      ? await this.db
          .select({
            id: interviews.id,
            applicationId: interviews.applicationId,
            round: interviews.round,
            type: interviews.type,
            interviewerId: interviews.interviewerId,
            interviewerName: this.nameExpr(),
            scheduledAt: interviews.scheduledAt,
            mode: interviews.mode,
            status: interviews.status,
          })
          .from(interviews)
          .leftJoin(employees, eq(employees.id, interviews.interviewerId))
          .where(inArray(interviews.applicationId, appIds))
          .orderBy(asc(interviews.round))
      : [];
    const cards = rounds.length
      ? await Promise.all(rounds.map((iv) => this.listScorecards(iv.id))).then((x) => x.flat())
      : [];
    const offerRows = appIds.length
      ? await this.db.select().from(offers).where(inArray(offers.applicationId, appIds))
      : [];
    return {
      candidate: { ...candidate, referredByName: ref?.name ?? null },
      applications: apps,
      interviews: rounds,
      scorecards: cards,
      offers: offerRows,
    };
  }

  /**
   * Create a candidate. Non-recruiters (referral flow) may only submit referrals — the source is
   * forced to `referral` and `referredBy` to the actor (PRD §4.2 ESS referrals).
   */
  async createCandidate(dto: CreateCandidateDto, actor: AuthenticatedUser) {
    const isRecruiter = isAdminOrAbove(actor);
    const source = isRecruiter ? dto.source : 'referral';
    const referredBy = isRecruiter ? (dto.referredByEmployeeId ?? null) : actor.id;

    if (referredBy) await this.employeesService.ensureExists(referredBy);
    if (dto.resumeDocumentId) await this.assertDocumentExists(dto.resumeDocumentId);

    const [row] = await this.db
      .insert(candidates)
      .values({
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone ?? null,
        resumeDocumentId: dto.resumeDocumentId ?? null,
        source,
        referredByEmployeeId: referredBy,
        notes: dto.notes ?? null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create candidate');
    await this.record(actor, 'candidate.create', `candidate:${row.id}`, {
      after: { fullName: row.fullName, source: row.source },
    });
    return row;
  }

  async updateCandidate(id: string, dto: UpdateCandidateDto, actor: AuthenticatedUser) {
    await this.getCandidateRow(id);
    if (dto.resumeDocumentId) await this.assertDocumentExists(dto.resumeDocumentId);
    const patch: Partial<typeof candidates.$inferInsert> = { updatedAt: new Date() };
    if (dto.fullName !== undefined) patch.fullName = dto.fullName;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.resumeDocumentId !== undefined) patch.resumeDocumentId = dto.resumeDocumentId;
    if (dto.source !== undefined) patch.source = dto.source;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    const [row] = await this.db
      .update(candidates)
      .set(patch)
      .where(eq(candidates.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update candidate');
    await this.record(actor, 'candidate.update', `candidate:${id}`, {
      after: { fullName: row.fullName },
    });
    return row;
  }

  // ── Applications ─────────────────────────────────────────────────────────────

  async listApplications(query: ListApplicationsDto) {
    const filters: SQL[] = [];
    if (query.jobOpeningId) filters.push(eq(applications.jobOpeningId, query.jobOpeningId));
    if (query.candidateId) filters.push(eq(applications.candidateId, query.candidateId));
    if (query.status) filters.push(eq(applications.status, query.status));
    return this.db
      .select({
        id: applications.id,
        candidateId: applications.candidateId,
        candidateName: candidates.fullName,
        jobOpeningId: applications.jobOpeningId,
        jobTitle: jobOpenings.title,
        currentStageId: applications.currentStageId,
        stageName: pipelineStages.name,
        status: applications.status,
        appliedAt: applications.appliedAt,
        rejectedReason: applications.rejectedReason,
        hiredEmployeeId: applications.hiredEmployeeId,
      })
      .from(applications)
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(jobOpenings, eq(jobOpenings.id, applications.jobOpeningId))
      .leftJoin(pipelineStages, eq(pipelineStages.id, applications.currentStageId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(applications.appliedAt));
  }

  async getApplication(id: string) {
    const app = await this.getApplicationRow(id);
    const [candidate] = await this.db
      .select()
      .from(candidates)
      .where(eq(candidates.id, app.candidateId))
      .limit(1);
    const rounds = await this.db
      .select()
      .from(interviews)
      .where(eq(interviews.applicationId, id))
      .orderBy(asc(interviews.round));
    const [offer] = await this.db
      .select()
      .from(offers)
      .where(eq(offers.applicationId, id))
      .limit(1);
    return { ...app, candidate: candidate ?? null, interviews: rounds, offer: offer ?? null };
  }

  /** Attach a candidate to an opening. Rejects a duplicate active application on the same opening. */
  async createApplication(dto: CreateApplicationDto, actor: AuthenticatedUser) {
    await this.getCandidateRow(dto.candidateId);
    const opening = await this.getJobOpeningRow(dto.jobOpeningId);
    if (opening.status !== 'open') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Job opening is ${opening.status}; cannot add applications`,
        HttpStatus.CONFLICT,
      );
    }

    const [dupe] = await this.db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.candidateId, dto.candidateId),
          eq(applications.jobOpeningId, dto.jobOpeningId),
          eq(applications.status, 'active'),
        ),
      )
      .limit(1);
    if (dupe) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Candidate already has an active application for this opening',
        HttpStatus.CONFLICT,
      );
    }

    const stageId = dto.stageId ? (await this.getStageRow(dto.stageId)).id : await this.firstStageId();

    const [row] = await this.db
      .insert(applications)
      .values({
        candidateId: dto.candidateId,
        jobOpeningId: dto.jobOpeningId,
        currentStageId: stageId,
        status: 'active',
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create application');
    await this.record(actor, 'application.create', `application:${row.id}`, {
      after: { candidateId: dto.candidateId, jobOpeningId: dto.jobOpeningId },
    });
    return row;
  }

  /** Move an application to another (non-terminal) stage. Hired/Rejected go through their endpoints. */
  async moveApplication(id: string, dto: MoveApplicationDto, actor: AuthenticatedUser) {
    const app = await this.getApplicationRow(id);
    if (app.status !== 'active') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Application is ${app.status}; only active applications can move`,
        HttpStatus.CONFLICT,
      );
    }
    const stage = await this.getStageRow(dto.stageId);
    if (stage.isTerminal) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'Use the reject or hire endpoint to reach a terminal stage',
      );
    }
    const [row] = await this.db
      .update(applications)
      .set({ currentStageId: stage.id, updatedAt: new Date() })
      .where(eq(applications.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to move application');
    await this.record(actor, 'application.move', `application:${id}`, {
      before: { stageId: app.currentStageId },
      after: { stageId: stage.id, stageName: stage.name },
    });
    return row;
  }

  /** Reject an application (reason required for the funnel). Moves it to a Rejected terminal stage. */
  async rejectApplication(id: string, dto: RejectApplicationDto, actor: AuthenticatedUser) {
    const app = await this.getApplicationRow(id);
    if (app.status !== 'active') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Application is already ${app.status}`,
        HttpStatus.CONFLICT,
      );
    }
    const rejectedStage = await this.terminalStageByName('rejected');
    const [row] = await this.db
      .update(applications)
      .set({
        status: 'rejected',
        rejectedReason: dto.reason,
        currentStageId: rejectedStage?.id ?? app.currentStageId,
        updatedAt: new Date(),
      })
      .where(eq(applications.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to reject application');
    await this.record(actor, 'application.reject', `application:${id}`, {
      before: { status: 'active' },
      after: { status: 'rejected', reason: dto.reason },
    });
    return row;
  }

  /**
   * The key integration (PRD §4). Convert an accepted-offer application into an Employee (comp routes
   * to the reserved payroll hooks) and spawn a Phase 2 onboarding case. If no active onboarding
   * template matches the new hire, the Employee is still created and the onboarding step is reported
   * as skipped rather than failing the hire.
   */
  async hireApplication(id: string, dto: HireApplicationDto, actor: AuthenticatedUser) {
    const app = await this.getApplicationRow(id);
    if (app.status !== 'active') {
      throw new AppError(ErrorCode.CONFLICT, `Application is already ${app.status}`, HttpStatus.CONFLICT);
    }
    if (app.hiredEmployeeId) {
      throw new AppError(ErrorCode.CONFLICT, 'Application is already hired', HttpStatus.CONFLICT);
    }

    const candidate = await this.getCandidateRow(app.candidateId);
    const opening = await this.getJobOpeningRow(app.jobOpeningId);
    const [offer] = await this.db
      .select()
      .from(offers)
      .where(eq(offers.applicationId, id))
      .limit(1);
    if (offer && offer.status !== 'accepted') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Offer must be accepted before hiring (offer is ${offer.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const offerDetails = (offer?.details ?? {}) as {
      designation?: string;
      joiningDate?: string;
      comp?: Record<string, unknown>;
    };
    const dateOfJoining = dto.dateOfJoining ?? offerDetails.joiningDate;
    if (!dateOfJoining) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'No joining date — set it on the offer or pass dateOfJoining',
      );
    }

    const { firstName, lastName } = this.splitName(candidate.fullName, dto);
    const managerId = dto.managerId ?? opening.hiringManagerId ?? null;
    if (managerId) await this.employeesService.ensureExists(managerId);

    // Create the Employee. `salaryStructure` receives the offer comp placeholder (reserved payroll
    // hook only — never fed into active logic).
    const employee = await this.employeesService.create(
      {
        employeeCode: dto.employeeCode ?? this.generateEmployeeCode(),
        firstName,
        lastName,
        workEmail: candidate.email,
        phone: candidate.phone ?? undefined,
        employmentType: dto.employmentType ?? opening.employmentType,
        dateOfJoining,
        workLocation: dto.workLocation ?? opening.location,
        designation: dto.designation ?? offerDetails.designation ?? opening.title,
        departmentId: dto.departmentId ?? opening.departmentId ?? undefined,
        managerId: managerId ?? undefined,
        salaryStructure: offerDetails.comp,
      },
      actor,
    );

    const hiredStage = await this.terminalStageByName('hired');
    await this.db
      .update(applications)
      .set({
        status: 'hired',
        hiredEmployeeId: employee.id,
        currentStageId: hiredStage?.id ?? app.currentStageId,
        updatedAt: new Date(),
      })
      .where(eq(applications.id, id));

    await this.record(actor, 'application.hire', `application:${id}`, {
      before: { status: 'active' },
      after: { status: 'hired', employeeId: employee.id },
    });

    // Auto-fill the opening once headcount is met.
    await this.maybeMarkFilled(opening.id, actor);

    // Spawn the onboarding case (non-fatal — a hire must not fail for a missing template).
    let onboarding: { caseId: string } | { skipped: string };
    try {
      const kase = await this.onboardingService.createCase(
        {
          employeeId: employee.id,
          type: 'onboarding',
          templateId: dto.onboardingTemplateId,
          anchorDate: dto.onboardingAnchorDate,
        },
        actor,
      );
      onboarding = { caseId: kase.id };
    } catch (err) {
      onboarding = { skipped: err instanceof AppError ? err.message : 'Onboarding case not created' };
    }

    await this.notify(
      employee.id,
      'Welcome aboard',
      `Your onboarding for "${opening.title}" is being set up.`,
      '/me',
    );
    if (managerId) {
      await this.notify(
        managerId,
        'New hire',
        `${firstName} ${lastName} was hired for "${opening.title}".`,
        '/team',
      );
    }

    return { application: await this.getApplication(id), employee, onboarding };
  }

  // ── Interviews & scorecards ────────────────────────────────────────────────

  async listInterviews(query: ListInterviewsDto, actor: AuthenticatedUser) {
    const filters: SQL[] = [];
    if (query.scope === 'mine') {
      filters.push(eq(interviews.interviewerId, actor.id));
    } else if (!isAdminOrAbove(actor)) {
      // Non-recruiters only ever see their own interviews.
      filters.push(eq(interviews.interviewerId, actor.id));
    }
    if (query.applicationId) filters.push(eq(interviews.applicationId, query.applicationId));

    return this.db
      .select({
        id: interviews.id,
        applicationId: interviews.applicationId,
        candidateName: candidates.fullName,
        jobTitle: jobOpenings.title,
        round: interviews.round,
        type: interviews.type,
        interviewerId: interviews.interviewerId,
        interviewerName: this.nameExpr(),
        scheduledAt: interviews.scheduledAt,
        mode: interviews.mode,
        status: interviews.status,
      })
      .from(interviews)
      .innerJoin(applications, eq(applications.id, interviews.applicationId))
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(jobOpenings, eq(jobOpenings.id, applications.jobOpeningId))
      .leftJoin(employees, eq(employees.id, interviews.interviewerId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(interviews.scheduledAt));
  }

  async createInterview(dto: CreateInterviewDto, actor: AuthenticatedUser) {
    const app = await this.getApplicationRow(dto.applicationId);
    if (app.status !== 'active') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Application is ${app.status}; cannot schedule interviews`,
        HttpStatus.CONFLICT,
      );
    }
    if (dto.interviewerId) await this.employeesService.ensureExists(dto.interviewerId);

    const [row] = await this.db
      .insert(interviews)
      .values({
        applicationId: dto.applicationId,
        round: dto.round,
        type: dto.type,
        interviewerId: dto.interviewerId ?? null,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        mode: dto.mode,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to schedule interview');
    await this.record(actor, 'interview.create', `interview:${row.id}`, {
      after: { applicationId: dto.applicationId, round: dto.round, type: dto.type },
    });
    if (row.interviewerId) {
      await this.notify(
        row.interviewerId,
        'Interview scheduled',
        `You're scheduled to interview a candidate (round ${row.round}, ${row.type}).`,
        '/me/interviews',
      );
    }
    return row;
  }

  async updateInterview(id: string, dto: UpdateInterviewDto, actor: AuthenticatedUser) {
    const before = await this.getInterviewRow(id);
    if (dto.interviewerId) await this.employeesService.ensureExists(dto.interviewerId);
    const patch: Partial<typeof interviews.$inferInsert> = { updatedAt: new Date() };
    if (dto.round !== undefined) patch.round = dto.round;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.interviewerId !== undefined) patch.interviewerId = dto.interviewerId;
    if (dto.scheduledAt !== undefined)
      patch.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (dto.mode !== undefined) patch.mode = dto.mode;
    if (dto.status !== undefined) patch.status = dto.status;

    const [row] = await this.db
      .update(interviews)
      .set(patch)
      .where(eq(interviews.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update interview');
    await this.record(actor, 'interview.update', `interview:${id}`, {
      after: { status: row.status },
    });
    if (
      dto.interviewerId &&
      dto.interviewerId !== before.interviewerId &&
      row.interviewerId
    ) {
      await this.notify(
        row.interviewerId,
        'Interview assigned',
        `You've been assigned an interview (round ${row.round}, ${row.type}).`,
        '/me/interviews',
      );
    }
    return row;
  }

  /**
   * Submit a scorecard for an interview. Only the assigned interviewer (or a recruiter) may submit,
   * and only one scorecard per interviewer per interview. Marks the interview `completed`.
   */
  async submitScorecard(interviewId: string, dto: SubmitScorecardDto, actor: AuthenticatedUser) {
    const interview = await this.getInterviewRow(interviewId);
    const isRecruiter = isAdminOrAbove(actor);
    if (interview.interviewerId && interview.interviewerId !== actor.id && !isRecruiter) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Only the assigned interviewer can submit this scorecard',
        HttpStatus.FORBIDDEN,
      );
    }

    const [existing] = await this.db
      .select({ id: interviewScorecards.id })
      .from(interviewScorecards)
      .where(
        and(
          eq(interviewScorecards.interviewId, interviewId),
          eq(interviewScorecards.interviewerId, actor.id),
        ),
      )
      .limit(1);
    if (existing) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'You have already submitted a scorecard for this interview',
        HttpStatus.CONFLICT,
      );
    }

    const [row] = await this.db
      .insert(interviewScorecards)
      .values({
        interviewId,
        interviewerId: actor.id,
        ratings: dto.ratings,
        notes: dto.notes ?? null,
        recommendation: dto.recommendation,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to submit scorecard');

    if (interview.status === 'scheduled') {
      await this.db
        .update(interviews)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(interviews.id, interviewId));
    }

    await this.record(actor, 'interview_scorecard.submit', `interview_scorecard:${row.id}`, {
      after: { interviewId, recommendation: dto.recommendation },
    });
    return row;
  }

  /** Aggregated scorecards for an interview — Recruiter/Hiring-Manager only (via controller RBAC). */
  listScorecards(interviewId: string) {
    return this.db
      .select({
        id: interviewScorecards.id,
        interviewId: interviewScorecards.interviewId,
        interviewerId: interviewScorecards.interviewerId,
        interviewerName: this.nameExpr(),
        ratings: interviewScorecards.ratings,
        notes: interviewScorecards.notes,
        recommendation: interviewScorecards.recommendation,
        submittedAt: interviewScorecards.submittedAt,
      })
      .from(interviewScorecards)
      .leftJoin(employees, eq(employees.id, interviewScorecards.interviewerId))
      .where(eq(interviewScorecards.interviewId, interviewId))
      .orderBy(desc(interviewScorecards.submittedAt));
  }

  // ── Offers ─────────────────────────────────────────────────────────────────

  async createOffer(dto: CreateOfferDto, actor: AuthenticatedUser) {
    const app = await this.getApplicationRow(dto.applicationId);
    if (app.status !== 'active') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Application is ${app.status}; cannot create an offer`,
        HttpStatus.CONFLICT,
      );
    }
    const [existing] = await this.db
      .select({ id: offers.id })
      .from(offers)
      .where(eq(offers.applicationId, dto.applicationId))
      .limit(1);
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, 'An offer already exists for this application', HttpStatus.CONFLICT);
    }
    if (dto.offerDocumentId) await this.assertDocumentExists(dto.offerDocumentId);

    const [row] = await this.db
      .insert(offers)
      .values({
        applicationId: dto.applicationId,
        details: dto.details,
        status: dto.status,
        offerDocumentId: dto.offerDocumentId ?? null,
        sentAt: dto.status === 'sent' ? new Date() : null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create offer');
    await this.record(actor, 'offer.create', `offer:${row.id}`, {
      after: { applicationId: dto.applicationId, status: row.status },
    });
    return row;
  }

  /** Update an offer — send it, accept/decline it, or amend details/document. */
  async updateOffer(id: string, dto: UpdateOfferDto, actor: AuthenticatedUser) {
    const before = await this.getOfferRow(id);
    if (dto.offerDocumentId) await this.assertDocumentExists(dto.offerDocumentId);

    const patch: Partial<typeof offers.$inferInsert> = { updatedAt: new Date() };
    if (dto.details !== undefined) patch.details = { ...before.details, ...dto.details };
    if (dto.offerDocumentId !== undefined) patch.offerDocumentId = dto.offerDocumentId;
    if (dto.status !== undefined) {
      this.assertOfferTransition(before.status, dto.status);
      patch.status = dto.status;
      if (dto.status === 'sent' && !before.sentAt) patch.sentAt = new Date();
      if (dto.status === 'accepted' || dto.status === 'declined') patch.respondedAt = new Date();
    }

    const [row] = await this.db.update(offers).set(patch).where(eq(offers.id, id)).returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update offer');
    await this.record(actor, 'offer.update', `offer:${id}`, {
      before: { status: before.status },
      after: { status: row.status },
    });

    // Notify recruiters/hiring manager when a candidate responds.
    if (dto.status === 'accepted' || dto.status === 'declined') {
      const app = await this.getApplicationRow(before.applicationId);
      const opening = await this.getJobOpeningRow(app.jobOpeningId);
      if (opening.hiringManagerId) {
        await this.notify(
          opening.hiringManagerId,
          `Offer ${dto.status}`,
          `A candidate ${dto.status} the offer for "${opening.title}".`,
          '/recruitment',
        );
      }
    }
    return row;
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private assertOfferTransition(from: Offer['status'], to: Offer['status']): void {
    const allowed: Record<Offer['status'], Offer['status'][]> = {
      draft: ['sent', 'declined'],
      sent: ['accepted', 'declined'],
      accepted: [],
      declined: [],
    };
    if (from === to) return;
    if (!allowed[from].includes(to)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Cannot move an offer from ${from} to ${to}`,
        HttpStatus.CONFLICT,
      );
    }
  }

  /** Bump a job opening to `filled` once accepted hires meet its headcount. */
  private async maybeMarkFilled(openingId: string, actor: AuthenticatedUser): Promise<void> {
    const opening = await this.getJobOpeningRow(openingId);
    if (opening.status === 'filled' || opening.status === 'closed') return;
    const hires = await this.countHires(openingId);
    if (hires >= opening.headcount) {
      await this.db
        .update(jobOpenings)
        .set({ status: 'filled', closedAt: new Date(), updatedAt: new Date() })
        .where(eq(jobOpenings.id, openingId));
      await this.record(actor, 'job_opening.filled', `job_opening:${openingId}`, {
        after: { status: 'filled', hires },
      });
    }
  }

  private async countHires(openingId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(applications)
      .where(and(eq(applications.jobOpeningId, openingId), eq(applications.status, 'hired')));
    return row?.count ?? 0;
  }

  /** Split a candidate's full name into first/last, honouring explicit overrides. */
  private splitName(
    fullName: string,
    dto: HireApplicationDto,
  ): { firstName: string; lastName: string } {
    if (dto.firstName || dto.lastName) {
      return { firstName: dto.firstName ?? fullName, lastName: dto.lastName ?? '-' };
    }
    const parts = fullName.trim().split(/\s+/);
    const firstName = parts.shift() ?? fullName;
    const lastName = parts.length > 0 ? parts.join(' ') : '-';
    return { firstName, lastName };
  }

  private generateEmployeeCode(): string {
    return `NH-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  /** Seed the default pipeline if the org has no stages yet. */
  private async ensureStages(): Promise<void> {
    const [any] = await this.db.select({ id: pipelineStages.id }).from(pipelineStages).limit(1);
    if (any) return;
    await this.db.insert(pipelineStages).values(DEFAULT_STAGES).onConflictDoNothing();
  }

  private async firstStageId(): Promise<string | null> {
    await this.ensureStages();
    const [row] = await this.db
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(eq(pipelineStages.isTerminal, false))
      .orderBy(asc(pipelineStages.sortOrder))
      .limit(1);
    return row?.id ?? null;
  }

  private async terminalStageByName(name: string): Promise<PipelineStage | undefined> {
    await this.ensureStages();
    const [row] = await this.db
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.isTerminal, true), ilike(pipelineStages.name, name)))
      .limit(1);
    return row;
  }

  private nameExpr() {
    return sql<
      string | null
    >`coalesce(${employees.displayName}, ${employees.firstName} || ' ' || ${employees.lastName})`;
  }

  private async assertDocumentExists(id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Document not found', HttpStatus.NOT_FOUND);
  }

  private async getStageRow(id: string): Promise<PipelineStage> {
    const [row] = await this.db.select().from(pipelineStages).where(eq(pipelineStages.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Pipeline stage not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getJobOpeningRow(id: string): Promise<JobOpening> {
    const [row] = await this.db.select().from(jobOpenings).where(eq(jobOpenings.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Job opening not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getCandidateRow(id: string): Promise<Candidate> {
    const [row] = await this.db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Candidate not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getApplicationRow(id: string): Promise<Application> {
    const [row] = await this.db.select().from(applications).where(eq(applications.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Application not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getInterviewRow(id: string): Promise<Interview> {
    const [row] = await this.db.select().from(interviews).where(eq(interviews.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Interview not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getOfferRow(id: string): Promise<Offer> {
    const [row] = await this.db.select().from(offers).where(eq(offers.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Offer not found', HttpStatus.NOT_FOUND);
    return row;
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
