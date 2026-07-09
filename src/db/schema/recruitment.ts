/**
 * Module 9 — Recruitment / ATS (PRD §4). An internal hiring pipeline that closes the loop into
 * Phase 2 onboarding: an `application` reaching `hired` creates an `Employee` (comp routes to the
 * reserved payroll hooks) and spawns an onboarding `LifecycleCase`.
 *
 *  - `pipelineStages`      — ordered, configurable stages (Applied → Screening → … → Hired/Rejected).
 *  - `jobOpenings`         — a requisition with headcount, hiring manager, and department.
 *  - `candidates`          — a person in the pipeline (resume in the document vault, optional referrer).
 *  - `applications`        — a candidate applied to one opening; carries the current stage + status.
 *  - `interviews`          — a scheduled round on an application, with an assigned interviewer.
 *  - `interviewScorecards` — one interviewer's ratings + recommendation for an interview.
 *  - `offers`             — the (0..1) offer on an application; `accepted` gates the hire conversion.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './_conventions';
import { departments, documents, employees } from './employees';
import {
  applicationStatus,
  candidateSource,
  employmentType,
  interviewMode,
  interviewStatus,
  interviewType,
  jobOpeningStatus,
  offerStatus,
  scorecardRecommendation,
  workLocation,
} from './enums';

/** Free-form offer terms. `comp` is a placeholder that routes into the reserved payroll hooks on hire. */
export type OfferDetails = {
  designation?: string;
  joiningDate?: string;
  comp?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * A configurable pipeline stage. `sortOrder` drives the Kanban column order; `isTerminal` marks
 * end states (Hired / Rejected) that an application can only reach via the dedicated hire/reject
 * transitions rather than a plain stage move.
 */
export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuidPk(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isTerminal: boolean('is_terminal').notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    sortIdx: index('ix_pipeline_stages_sort').on(t.sortOrder),
  }),
);

/**
 * A job requisition. `location`/`employmentType` reuse the Employee Core enums so a hired candidate
 * maps straight onto an Employee. `status` auto-advances to `filled` when accepted hires meet
 * `headcount`.
 */
export const jobOpenings = pgTable(
  'job_openings',
  {
    id: uuidPk(),
    title: text('title').notNull(),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    employmentType: employmentType('employment_type').notNull(),
    hiringManagerId: uuid('hiring_manager_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    location: workLocation('location').notNull(),
    headcount: integer('headcount').notNull().default(1),
    description: text('description'),
    status: jobOpeningStatus('status').notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index('ix_job_openings_status').on(t.status),
    departmentIdx: index('ix_job_openings_department').on(t.departmentId),
    hiringManagerIdx: index('ix_job_openings_hiring_manager').on(t.hiringManagerId),
  }),
);

/**
 * A candidate in the pipeline. `resumeDocumentId` reuses the MVP document vault (nullable — a
 * referral may be logged before a resume exists). `referredByEmployeeId` is set when `source` is a
 * referral.
 */
export const candidates = pgTable(
  'candidates',
  {
    id: uuidPk(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    resumeDocumentId: uuid('resume_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    source: candidateSource('source').notNull().default('inbound'),
    referredByEmployeeId: uuid('referred_by_employee_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    emailIdx: index('ix_candidates_email').on(t.email),
    referrerIdx: index('ix_candidates_referrer').on(t.referredByEmployeeId),
  }),
);

/**
 * A candidate's application to one opening (a candidate may apply to several). `currentStageId`
 * tracks the Kanban position; `status` is the coarse lifecycle. A rejection requires a reason
 * (for the recruitment funnel analytics).
 */
export const applications = pgTable(
  'applications',
  {
    id: uuidPk(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    jobOpeningId: uuid('job_opening_id')
      .notNull()
      .references(() => jobOpenings.id, { onDelete: 'cascade' }),
    currentStageId: uuid('current_stage_id').references(() => pipelineStages.id, {
      onDelete: 'set null',
    }),
    status: applicationStatus('status').notNull().default('active'),
    appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
    rejectedReason: text('rejected_reason'),
    // Set when the application is hired — the Employee this application converted into.
    hiredEmployeeId: uuid('hired_employee_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => ({
    candidateIdx: index('ix_applications_candidate').on(t.candidateId),
    openingIdx: index('ix_applications_opening').on(t.jobOpeningId, t.status),
    stageIdx: index('ix_applications_stage').on(t.currentStageId),
  }),
);

/**
 * A scheduled interview round on an application. `interviewerId` is the assigned interviewer who
 * may submit the scorecard (a panel is modelled as multiple interview rows in V3).
 */
export const interviews = pgTable(
  'interviews',
  {
    id: uuidPk(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    round: integer('round').notNull().default(1),
    type: interviewType('type').notNull(),
    interviewerId: uuid('interviewer_id').references(() => employees.id, { onDelete: 'set null' }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    mode: interviewMode('mode').notNull().default('remote'),
    status: interviewStatus('status').notNull().default('scheduled'),
    ...timestamps,
  },
  (t) => ({
    applicationIdx: index('ix_interviews_application').on(t.applicationId),
    interviewerIdx: index('ix_interviews_interviewer').on(t.interviewerId, t.status),
  }),
);

/**
 * One interviewer's scorecard for an interview. `ratings` is a competency→score map; the aggregate
 * view is Recruiter/Hiring-Manager only, an interviewer sees only their own.
 */
export const interviewScorecards = pgTable(
  'interview_scorecards',
  {
    id: uuidPk(),
    interviewId: uuid('interview_id')
      .notNull()
      .references(() => interviews.id, { onDelete: 'cascade' }),
    interviewerId: uuid('interviewer_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    ratings: jsonb('ratings').notNull().$type<Record<string, number>>().default({}),
    notes: text('notes'),
    recommendation: scorecardRecommendation('recommendation').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    interviewIdx: index('ix_interview_scorecards_interview').on(t.interviewId),
    // One scorecard per interviewer per interview.
    uniqScorecard: uniqueIndex('uq_interview_scorecards_interview_interviewer').on(
      t.interviewId,
      t.interviewerId,
    ),
  }),
);

/**
 * The (0..1) offer on an application. `details` holds designation / joining date / comp placeholder;
 * the comp placeholder routes into the reserved payroll hooks on hire, never into active logic.
 */
export const offers = pgTable(
  'offers',
  {
    id: uuidPk(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    details: jsonb('details').notNull().$type<OfferDetails>().default({}),
    status: offerStatus('status').notNull().default('draft'),
    offerDocumentId: uuid('offer_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    // At most one offer per application.
    uniqApplication: uniqueIndex('uq_offers_application').on(t.applicationId),
  }),
);

export type PipelineStage = typeof pipelineStages.$inferSelect;
export type NewPipelineStage = typeof pipelineStages.$inferInsert;
export type JobOpening = typeof jobOpenings.$inferSelect;
export type NewJobOpening = typeof jobOpenings.$inferInsert;
export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type Interview = typeof interviews.$inferSelect;
export type NewInterview = typeof interviews.$inferInsert;
export type InterviewScorecard = typeof interviewScorecards.$inferSelect;
export type NewInterviewScorecard = typeof interviewScorecards.$inferInsert;
export type Offer = typeof offers.$inferSelect;
export type NewOffer = typeof offers.$inferInsert;
