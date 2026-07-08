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
  feedback,
  goals,
  lifecycleCases,
  oneOnOnes,
  projectAllocations,
  projects,
  reviewCycles,
  reviewTemplates,
  reviews,
  timesheetEntries,
  timesheetWeeks,
  userAccounts,
  applications,
  candidates,
  interviewScorecards,
  interviews,
  jobOpenings,
  offers,
  pipelineStages,
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

// ── Module 8: Performance & Reviews ──────────────────────────────────────────

export const reviewCyclesRelations = relations(reviewCycles, ({ one, many }) => ({
  template: one(reviewTemplates, {
    fields: [reviewCycles.templateId],
    references: [reviewTemplates.id],
  }),
  reviews: many(reviews),
  goals: many(goals),
}));

export const goalsRelations = relations(goals, ({ one, many }) => ({
  employee: one(employees, { fields: [goals.employeeId], references: [employees.id] }),
  cycle: one(reviewCycles, { fields: [goals.cycleId], references: [reviewCycles.id] }),
  parent: one(goals, {
    fields: [goals.parentGoalId],
    references: [goals.id],
    relationName: 'goal_parent',
  }),
  children: many(goals, { relationName: 'goal_parent' }),
}));

export const reviewTemplatesRelations = relations(reviewTemplates, ({ many }) => ({
  reviews: many(reviews),
  cycles: many(reviewCycles),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  cycle: one(reviewCycles, { fields: [reviews.cycleId], references: [reviewCycles.id] }),
  subject: one(employees, {
    fields: [reviews.subjectEmployeeId],
    references: [employees.id],
    relationName: 'review_subject',
  }),
  reviewer: one(employees, {
    fields: [reviews.reviewerId],
    references: [employees.id],
    relationName: 'review_reviewer',
  }),
  template: one(reviewTemplates, {
    fields: [reviews.templateId],
    references: [reviewTemplates.id],
  }),
}));

export const oneOnOnesRelations = relations(oneOnOnes, ({ one }) => ({
  manager: one(employees, {
    fields: [oneOnOnes.managerId],
    references: [employees.id],
    relationName: 'one_on_one_manager',
  }),
  employee: one(employees, {
    fields: [oneOnOnes.employeeId],
    references: [employees.id],
    relationName: 'one_on_one_employee',
  }),
}));

export const feedbackRelations = relations(feedback, ({ one }) => ({
  from: one(employees, {
    fields: [feedback.fromEmployeeId],
    references: [employees.id],
    relationName: 'feedback_from',
  }),
  to: one(employees, {
    fields: [feedback.toEmployeeId],
    references: [employees.id],
    relationName: 'feedback_to',
  }),
}));

// ── Module 9: Recruitment / ATS ──────────────────────────────────────────────

export const pipelineStagesRelations = relations(pipelineStages, ({ many }) => ({
  applications: many(applications),
}));

export const jobOpeningsRelations = relations(jobOpenings, ({ one, many }) => ({
  department: one(departments, {
    fields: [jobOpenings.departmentId],
    references: [departments.id],
  }),
  hiringManager: one(employees, {
    fields: [jobOpenings.hiringManagerId],
    references: [employees.id],
  }),
  applications: many(applications),
}));

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
  resume: one(documents, {
    fields: [candidates.resumeDocumentId],
    references: [documents.id],
  }),
  referredBy: one(employees, {
    fields: [candidates.referredByEmployeeId],
    references: [employees.id],
  }),
  applications: many(applications),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  candidate: one(candidates, {
    fields: [applications.candidateId],
    references: [candidates.id],
  }),
  jobOpening: one(jobOpenings, {
    fields: [applications.jobOpeningId],
    references: [jobOpenings.id],
  }),
  currentStage: one(pipelineStages, {
    fields: [applications.currentStageId],
    references: [pipelineStages.id],
  }),
  hiredEmployee: one(employees, {
    fields: [applications.hiredEmployeeId],
    references: [employees.id],
  }),
  interviews: many(interviews),
  offer: one(offers),
}));

export const interviewsRelations = relations(interviews, ({ one, many }) => ({
  application: one(applications, {
    fields: [interviews.applicationId],
    references: [applications.id],
  }),
  interviewer: one(employees, {
    fields: [interviews.interviewerId],
    references: [employees.id],
  }),
  scorecards: many(interviewScorecards),
}));

export const interviewScorecardsRelations = relations(interviewScorecards, ({ one }) => ({
  interview: one(interviews, {
    fields: [interviewScorecards.interviewId],
    references: [interviews.id],
  }),
  interviewer: one(employees, {
    fields: [interviewScorecards.interviewerId],
    references: [employees.id],
  }),
}));

export const offersRelations = relations(offers, ({ one }) => ({
  application: one(applications, {
    fields: [offers.applicationId],
    references: [applications.id],
  }),
  offerDocument: one(documents, {
    fields: [offers.offerDocumentId],
    references: [documents.id],
  }),
}));
