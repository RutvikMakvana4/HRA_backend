/**
 * Module 7 — Timesheets + Project Allocation (PRD §5). The studio differentiator: project staffing,
 * billable vs non-billable effort, and capacity/utilization.
 *
 *  - `clients`           — external clients (internal projects have none).
 *  - `projects`          — client or internal projects, each with a PM, a billable default, and a
 *                          manually-set RAG health / progress %.
 *  - `projectAllocations`— who is on a project, at what planned capacity %, in what role.
 *  - `projectMilestones` — delivery points on a project.
 *  - `projectTasks`      — work items on a project, optionally under a milestone.
 *  - `timesheetWeeks`    — the weekly submit/approve unit per employee (Monday-anchored).
 *  - `timesheetEntries`  — per-day, per-project effort rows rolling up under a week, optionally
 *                          attributed to a task.
 *  - `updateComments`    — comments on a timesheet entry (the daily update).
 *
 * Hours are stored decimal-free as INTEGER MINUTES (project convention — see attendance), exposed as
 * decimal `hours` at the API boundary.
 */
import { boolean, date, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './_conventions';
import { employees } from './employees';
import {
  clientStatus,
  milestoneStatus,
  projectHealth,
  projectStatus,
  projectType,
  taskPriority,
  taskStatus,
  timesheetStatus,
} from './enums';

export const clients = pgTable(
  'clients',
  {
    id: uuidPk(),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    status: clientStatus('status').notNull().default('active'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index('ix_clients_status').on(t.status),
  }),
);

/** A client or internal project. `pmEmployeeId` is the per-project PM (approves + manages allocations). */
export const projects = pgTable(
  'projects',
  {
    id: uuidPk(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    type: projectType('type').notNull().default('client'),
    defaultBillable: boolean('default_billable').notNull().default(true),
    status: projectStatus('status').notNull().default('active'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    pmEmployeeId: uuid('pm_employee_id').references(() => employees.id, { onDelete: 'set null' }),
    /** RAG status, set manually by the PM. */
    health: projectHealth('health').notNull().default('on_track'),
    /** 0-100, set manually by the PM — never derived. */
    progressPct: integer('progress_pct').notNull().default(0),
    /**
     * When progress_pct or health last changed. A manual number goes stale silently and a
     * stale number reads as truth, so every surface shows how old it is.
     */
    progressUpdatedAt: timestamp('progress_updated_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    clientIdx: index('ix_projects_client').on(t.clientId),
    statusIdx: index('ix_projects_status').on(t.status),
    pmIdx: index('ix_projects_pm').on(t.pmEmployeeId),
  }),
);

/** An employee's planned allocation to a project. Soft-removed by end-dating + `isActive=false`. */
export const projectAllocations = pgTable(
  'project_allocations',
  {
    id: uuidPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    roleOnProject: text('role_on_project'),
    allocationPct: integer('allocation_pct').notNull().default(0),
    startDate: date('start_date'),
    endDate: date('end_date'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    projectIdx: index('ix_project_allocations_project').on(t.projectId, t.isActive),
    employeeIdx: index('ix_project_allocations_employee').on(t.employeeId, t.isActive),
  }),
);

/** Delivery points on a project. Billing is milestone-based, so these are real markers. */
export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: uuidPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    dueDate: date('due_date').notNull(),
    status: milestoneStatus('status').notNull().default('pending'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    projectIdx: index('ix_project_milestones_project').on(t.projectId),
  }),
);

/**
 * Work items on a project. Creation is open to any project member — a board only the PM
 * can add to stops reflecting reality within a week.
 *
 * `assignedByEmployeeId` records HOW the work was picked up: equal to the assignee means
 * self-assigned; anyone else means it was handed over. Both routes are legitimate.
 */
export const projectTasks = pgTable(
  'project_tasks',
  {
    id: uuidPk(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    assigneeEmployeeId: uuid('assignee_employee_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    assignedByEmployeeId: uuid('assigned_by_employee_id').references(() => employees.id, {
      onDelete: 'set null',
    }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    status: taskStatus('status').notNull().default('todo'),
    priority: taskPriority('priority').notNull().default('medium'),
    dueDate: date('due_date'),
    milestoneId: uuid('milestone_id').references(() => projectMilestones.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    projectIdx: index('ix_project_tasks_project').on(t.projectId),
    assigneeIdx: index('ix_project_tasks_assignee').on(t.assigneeEmployeeId),
  }),
);

/**
 * A comment on a daily update. The update IS the timesheet entry, so comments hang off
 * the entry — there is no parallel "update" record to attach to.
 */
export const updateComments = pgTable(
  'update_comments',
  {
    id: uuidPk(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => timesheetEntries.id, { onDelete: 'cascade' }),
    authorEmployeeId: uuid('author_employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    ...timestamps,
  },
  (t) => ({
    entryIdx: index('ix_update_comments_entry').on(t.entryId),
  }),
);

/**
 * The weekly submit/approve unit for one employee. `totalMinutes` is derived (sum of entries).
 * Unique per (employee, weekStartDate); `weekStartDate` is always a Monday.
 */
export const timesheetWeeks = pgTable(
  'timesheet_weeks',
  {
    id: uuidPk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    weekStartDate: date('week_start_date').notNull(),
    status: timesheetStatus('status').notNull().default('draft'),
    totalMinutes: integer('total_minutes').notNull().default(0),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approverId: uuid('approver_id').references(() => employees.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...timestamps,
  },
  (t) => ({
    employeeIdx: index('ix_timesheet_weeks_employee').on(t.employeeId),
    statusIdx: index('ix_timesheet_weeks_status').on(t.status),
    uniqWeek: unique('uq_timesheet_week').on(t.employeeId, t.weekStartDate),
  }),
);

/** A single day/project effort row. `minutes` is integer (hours × 60). `billable` defaults from project. */
export const timesheetEntries = pgTable(
  'timesheet_entries',
  {
    id: uuidPk(),
    weekId: uuid('week_id')
      .notNull()
      .references(() => timesheetWeeks.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'restrict' }),
    workDate: date('work_date').notNull(),
    minutes: integer('minutes').notNull(),
    billable: boolean('billable').notNull().default(true),
    taskDescription: text('task_description'),
    category: text('category'),
    /**
     * Optional task attribution. Deliberately NULLABLE: making it required would mean that on
     * any day the task list is stale, people stop logging time at all — which would corrupt the
     * timesheet data the rest of the platform depends on.
     */
    taskId: uuid('task_id').references(() => projectTasks.id, { onDelete: 'set null' }),
    status: timesheetStatus('status').notNull().default('draft'),
    ...timestamps,
  },
  (t) => ({
    weekIdx: index('ix_timesheet_entries_week').on(t.weekId),
    employeeDateIdx: index('ix_timesheet_entries_employee_date').on(t.employeeId, t.workDate),
    projectIdx: index('ix_timesheet_entries_project').on(t.projectId),
    // One row per cell. A week belongs to one employee, so (week, project, date) is
    // the cell identity saveWeek diffs on; the DB enforces it too, so no code path
    // (or concurrent save) can mint duplicate entries now that saveWeek no longer
    // blanket-deletes and reinserts the week.
    uniqCell: unique('uq_timesheet_entry_cell').on(t.weekId, t.projectId, t.workDate),
  }),
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectAllocation = typeof projectAllocations.$inferSelect;
export type NewProjectAllocation = typeof projectAllocations.$inferInsert;
export type ProjectMilestone = typeof projectMilestones.$inferSelect;
export type NewProjectMilestone = typeof projectMilestones.$inferInsert;
export type ProjectTask = typeof projectTasks.$inferSelect;
export type NewProjectTask = typeof projectTasks.$inferInsert;
export type TimesheetWeek = typeof timesheetWeeks.$inferSelect;
export type NewTimesheetWeek = typeof timesheetWeeks.$inferInsert;
export type TimesheetEntry = typeof timesheetEntries.$inferSelect;
export type NewTimesheetEntry = typeof timesheetEntries.$inferInsert;
export type UpdateComment = typeof updateComments.$inferSelect;
export type NewUpdateComment = typeof updateComments.$inferInsert;
