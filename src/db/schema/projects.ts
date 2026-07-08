/**
 * Module 7 — Timesheets + Project Allocation (PRD §5). The studio differentiator: project staffing,
 * billable vs non-billable effort, and capacity/utilization.
 *
 *  - `clients`           — external clients (internal projects have none).
 *  - `projects`          — client or internal projects, each with a PM and a billable default.
 *  - `projectAllocations`— who is on a project, at what planned capacity %, in what role.
 *  - `timesheetWeeks`    — the weekly submit/approve unit per employee (Monday-anchored).
 *  - `timesheetEntries`  — per-day, per-project effort rows rolling up under a week.
 *
 * Hours are stored decimal-free as INTEGER MINUTES (project convention — see attendance), exposed as
 * decimal `hours` at the API boundary.
 */
import { boolean, date, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './_conventions';
import { employees } from './employees';
import { clientStatus, projectStatus, projectType, timesheetStatus } from './enums';

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
    status: timesheetStatus('status').notNull().default('draft'),
    ...timestamps,
  },
  (t) => ({
    weekIdx: index('ix_timesheet_entries_week').on(t.weekId),
    employeeDateIdx: index('ix_timesheet_entries_employee_date').on(t.employeeId, t.workDate),
    projectIdx: index('ix_timesheet_entries_project').on(t.projectId),
  }),
);

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectAllocation = typeof projectAllocations.$inferSelect;
export type NewProjectAllocation = typeof projectAllocations.$inferInsert;
export type TimesheetWeek = typeof timesheetWeeks.$inferSelect;
export type NewTimesheetWeek = typeof timesheetWeeks.$inferInsert;
export type TimesheetEntry = typeof timesheetEntries.$inferSelect;
export type NewTimesheetEntry = typeof timesheetEntries.$inferInsert;
