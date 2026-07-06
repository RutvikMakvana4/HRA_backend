/**
 * Module 6 — Expenses & Reimbursement (PRD §4). Claim → approve → reimbursed tracking. Multi-currency
 * (INR + GBP), no money movement (mark-as-reimbursed only).
 *
 *  - `expenseCategories` — configurable categories with receipt/cap policy.
 *  - `expenseClaims`     — a claim owned by an employee; single currency; total derived from lines.
 *  - `expenseLineItems`  — the individual receipts/amounts within a claim.
 *
 * Amounts are `money` (bigint, MINOR UNITS — paise/pence — Golden Rule 1); never float.
 */
import { boolean, date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { money, timestamps, uuidPk } from './_conventions';
import { documents, employees } from './employees';
import { projects } from './projects';
import { currency, expenseClaimStatus } from './enums';

/** An expense category with receipt-required and (optional) monthly-cap policy. */
export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: uuidPk(),
    name: text('name').notNull().unique(),
    requiresReceipt: boolean('requires_receipt').notNull().default(true),
    /** Optional monthly cap in minor units; a breach is a soft warning to the approver (not a block). */
    monthlyCap: money('monthly_cap'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    activeIdx: index('ix_expense_categories_active').on(t.isActive),
  }),
);

/**
 * An expense claim. `totalAmount` is derived (sum of line items) and refreshed on every line change.
 * All line items share the claim's single `currency`. `reimbursementRef` records a bank ref for audit;
 * NO actual payment is executed.
 */
export const expenseClaims = pgTable(
  'expense_claims',
  {
    id: uuidPk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    currency: currency('currency').notNull(),
    totalAmount: money('total_amount').notNull(),
    status: expenseClaimStatus('status').notNull().default('draft'),
    /** Allocate spend to a client project if billable/rechargeable (optional). */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approverId: uuid('approver_id').references(() => employees.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    reimbursedAt: timestamp('reimbursed_at', { withTimezone: true }),
    reimbursedBy: uuid('reimbursed_by'),
    reimbursementRef: text('reimbursement_ref'),
    ...timestamps,
  },
  (t) => ({
    employeeIdx: index('ix_expense_claims_employee').on(t.employeeId),
    statusIdx: index('ix_expense_claims_status').on(t.status),
    approverIdx: index('ix_expense_claims_approver').on(t.approverId),
    projectIdx: index('ix_expense_claims_project').on(t.projectId),
  }),
);

/** One receipt/amount within a claim. Receipt-required categories must set `receiptDocumentId`. */
export const expenseLineItems = pgTable(
  'expense_line_items',
  {
    id: uuidPk(),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => expenseClaims.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id, { onDelete: 'restrict' }),
    expenseDate: date('expense_date').notNull(),
    amount: money('amount').notNull(),
    description: text('description'),
    receiptDocumentId: uuid('receipt_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),
    merchant: text('merchant'),
    ...timestamps,
  },
  (t) => ({
    claimIdx: index('ix_expense_line_items_claim').on(t.claimId),
    categoryIdx: index('ix_expense_line_items_category').on(t.categoryId),
  }),
);

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type NewExpenseCategory = typeof expenseCategories.$inferInsert;
export type ExpenseClaim = typeof expenseClaims.$inferSelect;
export type NewExpenseClaim = typeof expenseClaims.$inferInsert;
export type ExpenseLineItem = typeof expenseLineItems.$inferSelect;
export type NewExpenseLineItem = typeof expenseLineItems.$inferInsert;
