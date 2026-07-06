/**
 * Module 2 — Leave Management (PRD §5). Two statutory calendars (India + UK) via `work_location`.
 *
 *  - `leaveTypes`    — configurable leave categories with an accrual policy (jsonb).
 *  - `holidays`      — per-location public holidays; excluded from leave day counts.
 *  - `leaveBalances` — per employee / type / year running totals (accrued/used/pending/carried).
 *  - `leaveRequests` — apply → approve/reject/cancel workflow.
 */
import { boolean, date, index, integer, jsonb, pgTable, real, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './_conventions';
import { employees } from './employees';
import { halfDayPeriod, holidayLocation, leaveLocation, leaveStatus } from './enums';

/**
 * A configurable leave category (Casual, Sick, Earned, Unpaid, Comp-off, …). `accrualPolicy` holds
 * `{ method, rate, cap, carryForward, carryForwardCap }` and drives the (scheduled) accrual job.
 */
export const leaveTypes = pgTable(
  'leave_types',
  {
    id: uuidPk(),
    name: text('name').notNull(),
    code: text('code').notNull().unique(),
    isPaid: boolean('is_paid').notNull().default(true),
    appliesToLocation: leaveLocation('applies_to_location').notNull().default('all'),
    accrualPolicy: jsonb('accrual_policy'),
    requiresApproval: boolean('requires_approval').notNull().default(true),
    allowHalfDay: boolean('allow_half_day').notNull().default(true),
    maxConsecutiveDays: integer('max_consecutive_days'),
    ...timestamps,
  },
  (t) => ({
    locationIdx: index('ix_leave_types_location').on(t.appliesToLocation),
  }),
);

/** A public holiday for one statutory calendar. Unique per (date, location). */
export const holidays = pgTable(
  'holidays',
  {
    id: uuidPk(),
    name: text('name').notNull(),
    date: date('date').notNull(),
    location: holidayLocation('location').notNull(),
    year: integer('year').notNull(),
    ...timestamps,
  },
  (t) => ({
    locationYearIdx: index('ix_holidays_location_year').on(t.location, t.year),
    uniqDateLocation: unique('uq_holidays_date_location').on(t.date, t.location),
  }),
);

/** Running leave totals for an employee/type/year. `available` is derived (accrued+carried−used−pending). */
export const leaveBalances = pgTable(
  'leave_balances',
  {
    id: uuidPk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    // Half-day leave books 0.5, so day totals are fractional (in .5 steps).
    accrued: real('accrued').notNull().default(0),
    used: real('used').notNull().default(0),
    pending: real('pending').notNull().default(0),
    carriedForward: real('carried_forward').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    employeeIdx: index('ix_leave_balances_employee').on(t.employeeId),
    uniqBalance: unique('uq_leave_balance').on(t.employeeId, t.leaveTypeId, t.year),
  }),
);

/** A leave application and its approval workflow. */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuidPk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    leaveTypeId: uuid('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id, { onDelete: 'restrict' }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    isHalfDay: boolean('is_half_day').notNull().default(false),
    halfDayPeriod: halfDayPeriod('half_day_period'),
    daysCount: real('days_count').notNull(),
    reason: text('reason'),
    status: leaveStatus('status').notNull().default('pending'),
    approverId: uuid('approver_id').references(() => employees.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...timestamps,
  },
  (t) => ({
    employeeIdx: index('ix_leave_requests_employee').on(t.employeeId),
    approverIdx: index('ix_leave_requests_approver').on(t.approverId),
    statusIdx: index('ix_leave_requests_status').on(t.status),
  }),
);

export type LeaveType = typeof leaveTypes.$inferSelect;
export type NewLeaveType = typeof leaveTypes.$inferInsert;
export type Holiday = typeof holidays.$inferSelect;
export type NewHoliday = typeof holidays.$inferInsert;
export type LeaveBalance = typeof leaveBalances.$inferSelect;
export type NewLeaveBalance = typeof leaveBalances.$inferInsert;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type NewLeaveRequest = typeof leaveRequests.$inferInsert;
