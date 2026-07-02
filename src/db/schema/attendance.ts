/**
 * Module 3 — Attendance (PRD §6). Lightweight check-in/out with WFH handling; no biometric.
 *
 *  - `attendanceRecords`        — one row per employee per day; status is derived.
 *  - `attendanceRegularizations`— employee-requested corrections routed to manager/HR.
 */
import { date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './_conventions';
import { employees } from './employees';
import { attendanceSource, attendanceStatus, regularizationStatus, workMode } from './enums';

/** One attendance record per employee per day. `totalHours` is minutes-agnostic (decimal-free): stored as integer minutes. */
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuidPk(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    checkIn: timestamp('check_in', { withTimezone: true }),
    checkOut: timestamp('check_out', { withTimezone: true }),
    workMode: workMode('work_mode').notNull().default('office'),
    status: attendanceStatus('status').notNull().default('present'),
    /** Worked minutes derived from check-in/out; null until check-out. */
    totalMinutes: integer('total_minutes'),
    notes: text('notes'),
    source: attendanceSource('source').notNull().default('self'),
    ...timestamps,
  },
  (t) => ({
    employeeIdx: index('ix_attendance_employee').on(t.employeeId),
    dateIdx: index('ix_attendance_date').on(t.date),
    uniqPerDay: unique('uq_attendance_employee_day').on(t.employeeId, t.date),
  }),
);

/** A requested correction to an attendance record (e.g. missed check-out). */
export const attendanceRegularizations = pgTable(
  'attendance_regularizations',
  {
    id: uuidPk(),
    attendanceRecordId: uuid('attendance_record_id')
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    requestedChange: jsonb('requested_change').notNull(),
    reason: text('reason'),
    status: regularizationStatus('status').notNull().default('pending'),
    approverId: uuid('approver_id').references(() => employees.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    employeeIdx: index('ix_regularizations_employee').on(t.employeeId),
    statusIdx: index('ix_regularizations_status').on(t.status),
  }),
);

export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert;
export type AttendanceRegularization = typeof attendanceRegularizations.$inferSelect;
export type NewAttendanceRegularization = typeof attendanceRegularizations.$inferInsert;
