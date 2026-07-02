/**
 * Postgres enum types (Enums sheet of the DB Schema doc). Defined once here and reused across
 * domain table files to avoid duplication and circular imports. Re-exported via ./index so
 * drizzle-kit emits `CREATE TYPE` for each.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

/** Who performed an audited action. */
export const actorType = pgEnum('actor_type', ['admin', 'user', 'system']);

// ── Module 1: Employee Core + Documents ──────────────────────────────────────

/** Nature of the engagement (drives some policy defaults later). */
export const employmentType = pgEnum('employment_type', ['full_time', 'contractor', 'intern']);

/** Lifecycle state. Deletes are soft: `exited` rather than a row removal. */
export const employeeStatus = pgEnum('employee_status', [
  'active',
  'on_notice',
  'exited',
  'suspended',
]);

/** Primary work location — drives which statutory holiday calendar applies (India / UK). */
export const workLocation = pgEnum('work_location', ['india', 'uk', 'remote']);

/** Category of an employee document. */
export const documentType = pgEnum('document_type', [
  'offer_letter',
  'id_proof',
  'contract',
  'certificate',
  'other',
]);

/** Who may see a document. `employee_visible` also surfaces to the owning employee via ESS. */
export const documentVisibility = pgEnum('document_visibility', ['hr_only', 'employee_visible']);

// ── Auth / RBAC (PRD §2, §8.1) ───────────────────────────────────────────────

/**
 * Primary role for a login account — exactly one per account (PRD §2). Capability ranking:
 *   employee (self) < manager (self + direct/indirect reports) < admin (org-wide)
 *   < super_admin (admin + role management, system settings, audit-log access).
 * Manager's team scope is still resolved from the org chart; the role gates team-wide screens.
 */
export const userRole = pgEnum('user_role', ['employee', 'manager', 'admin', 'super_admin']);

/** Login-account lifecycle. Disabled accounts cannot authenticate. */
export const accountStatus = pgEnum('account_status', ['active', 'disabled']);

// ── Module 2: Leave Management (PRD §5) ──────────────────────────────────────

/** Which statutory calendar a leave type / holiday applies to. `all` = every location. */
export const leaveLocation = pgEnum('leave_location', ['india', 'uk', 'all']);

/** Location a holiday belongs to (a holiday is always tied to one statutory calendar). */
export const holidayLocation = pgEnum('holiday_location', ['india', 'uk']);

/** Lifecycle of a leave request. */
export const leaveStatus = pgEnum('leave_status', [
  'pending',
  'approved',
  'rejected',
  'cancelled',
]);

/** Which half of the day a half-day leave covers. */
export const halfDayPeriod = pgEnum('half_day_period', ['first_half', 'second_half']);

// ── Module 3: Attendance (PRD §6) ────────────────────────────────────────────

/** Where the work happened on a given day. */
export const workMode = pgEnum('work_mode', ['office', 'wfh', 'remote']);

/** Derived attendance status for a day (leave > holiday > weekend > present/absent). */
export const attendanceStatus = pgEnum('attendance_status', [
  'present',
  'absent',
  'half_day',
  'on_leave',
  'holiday',
  'weekend',
]);

/** How an attendance record came to exist. */
export const attendanceSource = pgEnum('attendance_source', ['self', 'system', 'hr_edit']);

/** Lifecycle of an attendance regularization request. */
export const regularizationStatus = pgEnum('regularization_status', [
  'pending',
  'approved',
  'rejected',
]);
