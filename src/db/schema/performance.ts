/**
 * Module 8 — Performance & Reviews (PRD §3). Deliberately lightweight; the design goal is adoption.
 *
 *  - `reviewCycles`    — a named review window (quarterly/half-yearly/annual) that, when activated,
 *                        generates `review` rows per participant based on the enabled review types.
 *  - `goals`           — employee goals/OKRs with one level of self-nesting (Objective → Key Result).
 *  - `reviewTemplates` — reusable competency + open-question sets a review is filled against.
 *  - `reviews`         — one review of a subject by a reviewer (self/manager/peer); immutable once submitted.
 *  - `oneOnOnes`       — 1:1 log with shared notes (both) and private notes (manager only).
 *  - `feedback`        — continuous/ad-hoc praise or constructive notes with visibility scoping.
 */
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './_conventions';
import { employees } from './employees';
import {
  feedbackType,
  feedbackVisibility,
  goalCategory,
  goalStatus,
  reviewCycleStatus,
  reviewCycleType,
  reviewStatus,
  reviewType,
} from './enums';

/** One competency line inside a review template's `competencies` list. */
export type Competency = { label: string; description?: string; ratingScale: number };
/** One action item on a 1:1 (`actionItems` list). */
export type ActionItem = { text: string; ownerId?: string; done: boolean };

/**
 * A review cycle. Going `active` snapshots `review` rows for every active employee based on the
 * enabled review-type flags. `templateId` is the template those generated reviews are filled against
 * (required before activation).
 */
export const reviewCycles = pgTable(
  'review_cycles',
  {
    id: uuidPk(),
    name: text('name').notNull(),
    type: reviewCycleType('type').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: reviewCycleStatus('status').notNull().default('draft'),
    // The template generated reviews are filled against (nullable so a cycle can be drafted first).
    templateId: uuid('template_id').references(() => reviewTemplates.id, { onDelete: 'set null' }),
    includesSelfReview: boolean('includes_self_review').notNull().default(true),
    includesPeerReview: boolean('includes_peer_review').notNull().default(false),
    includesManagerReview: boolean('includes_manager_review').notNull().default(true),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index('ix_review_cycles_status').on(t.status),
  }),
);

/**
 * An employee goal or OKR. `parentGoalId` enables one level of nesting (Objective → Key Results);
 * a parent's `progressPct` may be auto-rolled from its children or set manually. `cycleId` is nullable
 * so goals can live outside any review cycle.
 */
export const goals = pgTable(
  'goals',
  {
    id: uuidPk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').references(() => reviewCycles.id, { onDelete: 'set null' }),
    // Self-referential OKR nesting. AnyPgColumn breaks the type cycle on the self-FK.
    parentGoalId: uuid('parent_goal_id').references((): AnyPgColumn => goals.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    description: text('description'),
    category: goalCategory('category').notNull().default('personal'),
    weight: integer('weight'),
    metricTarget: text('metric_target'),
    progressPct: integer('progress_pct').notNull().default(0),
    status: goalStatus('status').notNull().default('not_started'),
    dueDate: date('due_date'),
    createdBy: uuid('created_by'),
    ...timestamps,
  },
  (t) => ({
    employeeIdx: index('ix_goals_employee').on(t.employeeId),
    cycleIdx: index('ix_goals_cycle').on(t.cycleId),
    parentIdx: index('ix_goals_parent').on(t.parentGoalId),
  }),
);

/**
 * A reusable review template. `competencies` is a list of `{ label, description?, ratingScale }`;
 * `openQuestions` is a list of prompt strings.
 */
export const reviewTemplates = pgTable('review_templates', {
  id: uuidPk(),
  name: text('name').notNull(),
  competencies: jsonb('competencies').notNull().$type<Competency[]>().default([]),
  openQuestions: jsonb('open_questions').notNull().$type<string[]>().default([]),
  ...timestamps,
});

/**
 * A single review of `subjectEmployeeId` by `reviewerId` from one `type` perspective. `responses`
 * holds competency ratings + open-question answers keyed to the template. Immutable once `submitted`.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuidPk(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => reviewCycles.id, { onDelete: 'cascade' }),
    subjectEmployeeId: uuid('subject_employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    type: reviewType('type').notNull(),
    templateId: uuid('template_id').references(() => reviewTemplates.id, { onDelete: 'set null' }),
    responses: jsonb('responses').notNull().$type<Record<string, unknown>>().default({}),
    overallRating: integer('overall_rating'),
    status: reviewStatus('status').notNull().default('pending'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    cycleIdx: index('ix_reviews_cycle').on(t.cycleId),
    subjectIdx: index('ix_reviews_subject').on(t.subjectEmployeeId),
    reviewerIdx: index('ix_reviews_reviewer').on(t.reviewerId, t.status),
  }),
);

/**
 * A 1:1 between a manager and a report. `sharedNotes` and `actionItems` are visible to both;
 * `privateNotes` is manager-only and stripped for the employee at the API/query layer.
 */
export const oneOnOnes = pgTable(
  'one_on_ones',
  {
    id: uuidPk(),
    managerId: uuid('manager_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    sharedNotes: text('shared_notes'),
    privateNotes: text('private_notes'),
    actionItems: jsonb('action_items').notNull().$type<ActionItem[]>().default([]),
    ...timestamps,
  },
  (t) => ({
    managerIdx: index('ix_one_on_ones_manager').on(t.managerId),
    employeeIdx: index('ix_one_on_ones_employee').on(t.employeeId),
  }),
);

/**
 * Continuous/ad-hoc feedback. `visibility=private` is visible only to sender + recipient;
 * `manager_visible` also to the recipient's manager.
 */
export const feedback = pgTable(
  'feedback',
  {
    id: uuidPk(),
    fromEmployeeId: uuid('from_employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    toEmployeeId: uuid('to_employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    type: feedbackType('type').notNull(),
    visibility: feedbackVisibility('visibility').notNull().default('private'),
    text: text('text').notNull(),
    ...timestamps,
  },
  (t) => ({
    toIdx: index('ix_feedback_to').on(t.toEmployeeId),
    fromIdx: index('ix_feedback_from').on(t.fromEmployeeId),
  }),
);

export type ReviewCycle = typeof reviewCycles.$inferSelect;
export type NewReviewCycle = typeof reviewCycles.$inferInsert;
export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type ReviewTemplate = typeof reviewTemplates.$inferSelect;
export type NewReviewTemplate = typeof reviewTemplates.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type OneOnOne = typeof oneOnOnes.$inferSelect;
export type NewOneOnOne = typeof oneOnOnes.$inferInsert;
export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
