/**
 * Drizzle relations for Module 1. These power the relational query API (`db.query.*`) and give
 * typed `with: { ... }` joins. They describe row relationships only — the real FK constraints live
 * on the table definitions in ./schema.
 */
import { relations } from 'drizzle-orm';
import {
  authSessions,
  checklistTasks,
  checklistTemplateItems,
  checklistTemplates,
  clients,
  departments,
  documents,
  employees,
  expenseCategories,
  expenseClaims,
  expenseLineItems,
  lifecycleCases,
  projectAllocations,
  projects,
  timesheetEntries,
  timesheetWeeks,
  userAccounts,
} from './schema';

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  /** The employee who heads this department (soft pointer). */
  head: one(employees, {
    fields: [departments.headEmployeeId],
    references: [employees.id],
    relationName: 'department_head',
  }),
  /** Members of this department. */
  members: many(employees, { relationName: 'department_members' }),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  /** The department this employee belongs to. */
  department: one(departments, {
    fields: [employees.departmentId],
    references: [departments.id],
    relationName: 'department_members',
  }),
  /** This employee's manager (self-reference). */
  manager: one(employees, {
    fields: [employees.managerId],
    references: [employees.id],
    relationName: 'employee_manager',
  }),
  /** This employee's direct reports. */
  reports: many(employees, { relationName: 'employee_manager' }),
  /** Documents attached to this employee. */
  documents: many(documents),
  /** The login account for this person (1:1), if one exists. */
  account: one(userAccounts, {
    fields: [employees.id],
    references: [userAccounts.employeeId],
  }),
}));

export const userAccountsRelations = relations(userAccounts, ({ one, many }) => ({
  employee: one(employees, {
    fields: [userAccounts.employeeId],
    references: [employees.id],
  }),
  sessions: many(authSessions),
}));

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(userAccounts, {
    fields: [authSessions.userId],
    references: [userAccounts.id],
  }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  /** The employee this document belongs to. */
  employee: one(employees, {
    fields: [documents.employeeId],
    references: [employees.id],
  }),
}));

// ── Module 5: Onboarding / Offboarding ───────────────────────────────────────

export const checklistTemplatesRelations = relations(checklistTemplates, ({ many }) => ({
  items: many(checklistTemplateItems),
  cases: many(lifecycleCases),
}));

export const checklistTemplateItemsRelations = relations(checklistTemplateItems, ({ one }) => ({
  template: one(checklistTemplates, {
    fields: [checklistTemplateItems.templateId],
    references: [checklistTemplates.id],
  }),
}));

export const lifecycleCasesRelations = relations(lifecycleCases, ({ one, many }) => ({
  employee: one(employees, {
    fields: [lifecycleCases.employeeId],
    references: [employees.id],
  }),
  template: one(checklistTemplates, {
    fields: [lifecycleCases.templateId],
    references: [checklistTemplates.id],
  }),
  tasks: many(checklistTasks),
}));

export const checklistTasksRelations = relations(checklistTasks, ({ one }) => ({
  case: one(lifecycleCases, {
    fields: [checklistTasks.caseId],
    references: [lifecycleCases.id],
  }),
  assignee: one(employees, {
    fields: [checklistTasks.assigneeId],
    references: [employees.id],
  }),
  linkedDocument: one(documents, {
    fields: [checklistTasks.linkedDocumentId],
    references: [documents.id],
  }),
}));

// ── Module 7: Timesheets + Project Allocation ────────────────────────────────

export const clientsRelations = relations(clients, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
  pm: one(employees, { fields: [projects.pmEmployeeId], references: [employees.id] }),
  allocations: many(projectAllocations),
  timesheetEntries: many(timesheetEntries),
}));

export const projectAllocationsRelations = relations(projectAllocations, ({ one }) => ({
  project: one(projects, { fields: [projectAllocations.projectId], references: [projects.id] }),
  employee: one(employees, {
    fields: [projectAllocations.employeeId],
    references: [employees.id],
  }),
}));

export const timesheetWeeksRelations = relations(timesheetWeeks, ({ one, many }) => ({
  employee: one(employees, {
    fields: [timesheetWeeks.employeeId],
    references: [employees.id],
  }),
  entries: many(timesheetEntries),
}));

export const timesheetEntriesRelations = relations(timesheetEntries, ({ one }) => ({
  week: one(timesheetWeeks, {
    fields: [timesheetEntries.weekId],
    references: [timesheetWeeks.id],
  }),
  project: one(projects, { fields: [timesheetEntries.projectId], references: [projects.id] }),
  employee: one(employees, {
    fields: [timesheetEntries.employeeId],
    references: [employees.id],
  }),
}));

// ── Module 6: Expenses & Reimbursement ───────────────────────────────────────

export const expenseCategoriesRelations = relations(expenseCategories, ({ many }) => ({
  lineItems: many(expenseLineItems),
}));

export const expenseClaimsRelations = relations(expenseClaims, ({ one, many }) => ({
  employee: one(employees, {
    fields: [expenseClaims.employeeId],
    references: [employees.id],
  }),
  project: one(projects, { fields: [expenseClaims.projectId], references: [projects.id] }),
  lineItems: many(expenseLineItems),
}));

export const expenseLineItemsRelations = relations(expenseLineItems, ({ one }) => ({
  claim: one(expenseClaims, {
    fields: [expenseLineItems.claimId],
    references: [expenseClaims.id],
  }),
  category: one(expenseCategories, {
    fields: [expenseLineItems.categoryId],
    references: [expenseCategories.id],
  }),
  receipt: one(documents, {
    fields: [expenseLineItems.receiptDocumentId],
    references: [documents.id],
  }),
}));
