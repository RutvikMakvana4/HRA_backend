/**
 * Module 5 — Onboarding / Offboarding (PRD §3). Checklist-driven lifecycle flows.
 *
 *  - `checklistTemplates`     — reusable step sets, auto-selected per employee via `applies_to`.
 *  - `checklistTemplateItems` — ordered steps within a template (category, assignee role, offset).
 *  - `lifecycleCases`         — a live on/offboarding instance for one employee.
 *  - `checklistTasks`         — tasks snapshotted from the template at case creation (template
 *                               edits never mutate live cases), each assignable and trackable.
 */
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './_conventions';
import { documents, employees } from './employees';
import {
  checklistAssigneeRole,
  checklistCategory,
  checklistTaskStatus,
  lifecycleCaseStatus,
  lifecycleType,
} from './enums';

/**
 * A reusable checklist template. `appliesTo` holds `{ employmentTypes?, departmentIds?, locations? }`
 * used to auto-select the best-matching active template for an employee (a dimension left out is a
 * wildcard). Editing a template never touches already-spawned cases.
 */
export const checklistTemplates = pgTable(
  'checklist_templates',
  {
    id: uuidPk(),
    name: text('name').notNull(),
    type: lifecycleType('type').notNull(),
    appliesTo: jsonb('applies_to'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    typeIdx: index('ix_checklist_templates_type').on(t.type, t.isActive),
  }),
);

/** One ordered step in a template. `offsetDays` is relative to the case anchor (joining/exit) date. */
export const checklistTemplateItems = pgTable(
  'checklist_template_items',
  {
    id: uuidPk(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    category: checklistCategory('category').notNull(),
    defaultAssigneeRole: checklistAssigneeRole('default_assignee_role').notNull().default('hr'),
    offsetDays: integer('offset_days').notNull().default(0),
    isMandatory: boolean('is_mandatory').notNull().default(true),
    requiresDocument: boolean('requires_document').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    templateIdx: index('ix_checklist_template_items_template').on(t.templateId, t.sortOrder),
  }),
);

/**
 * A live on/offboarding case for one employee. `anchorDate` is the joining date (onboarding) or exit
 * date (offboarding); task due dates derive from it. `progressPct` and `status` are derived from
 * task completion and refreshed on every task change.
 */
export const lifecycleCases = pgTable(
  'lifecycle_cases',
  {
    id: uuidPk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    type: lifecycleType('type').notNull(),
    // The template this case was spawned from (snapshot origin). Kept nullable so a template can be
    // deleted without destroying historical cases.
    templateId: uuid('template_id').references(() => checklistTemplates.id, { onDelete: 'set null' }),
    status: lifecycleCaseStatus('status').notNull().default('not_started'),
    anchorDate: date('anchor_date').notNull(),
    progressPct: integer('progress_pct').notNull().default(0),
    createdBy: uuid('created_by'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    employeeIdx: index('ix_lifecycle_cases_employee').on(t.employeeId),
    statusIdx: index('ix_lifecycle_cases_status').on(t.status),
    typeIdx: index('ix_lifecycle_cases_type').on(t.type),
  }),
);

/**
 * A task snapshotted from a template item at case creation. `isMandatory` gates case auto-completion
 * and the offboarding clearance gate; `requiresDocument` blocks `done` until `linkedDocumentId` is
 * set (reusing the MVP document vault).
 */
export const checklistTasks = pgTable(
  'checklist_tasks',
  {
    id: uuidPk(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => lifecycleCases.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    category: checklistCategory('category').notNull(),
    assigneeId: uuid('assignee_id').references(() => employees.id, { onDelete: 'set null' }),
    dueDate: date('due_date'),
    status: checklistTaskStatus('status').notNull().default('pending'),
    isMandatory: boolean('is_mandatory').notNull().default(true),
    requiresDocument: boolean('requires_document').notNull().default(false),
    linkedDocumentId: uuid('linked_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
    completedBy: uuid('completed_by'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    caseIdx: index('ix_checklist_tasks_case').on(t.caseId, t.sortOrder),
    assigneeIdx: index('ix_checklist_tasks_assignee').on(t.assigneeId, t.status),
    statusIdx: index('ix_checklist_tasks_status').on(t.status),
  }),
);

export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type NewChecklistTemplate = typeof checklistTemplates.$inferInsert;
export type ChecklistTemplateItem = typeof checklistTemplateItems.$inferSelect;
export type NewChecklistTemplateItem = typeof checklistTemplateItems.$inferInsert;
export type LifecycleCase = typeof lifecycleCases.$inferSelect;
export type NewLifecycleCase = typeof lifecycleCases.$inferInsert;
export type ChecklistTask = typeof checklistTasks.$inferSelect;
export type NewChecklistTask = typeof checklistTasks.$inferInsert;
