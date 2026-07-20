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

// ── Module 5: Onboarding / Offboarding (PRD §3) ──────────────────────────────

/** A lifecycle flow is either a joining (onboarding) or an exit (offboarding). */
export const lifecycleType = pgEnum('lifecycle_type', ['onboarding', 'offboarding']);

/** Category of a checklist item/task — groups the board and drives the clearance gate. */
export const checklistCategory = pgEnum('checklist_category', [
  'documentation',
  'access_provisioning',
  'asset',
  'orientation',
  'compliance',
  'clearance',
  'handover',
]);

/** Whom a template item defaults to — resolved to a concrete employee when a case is spawned. */
export const checklistAssigneeRole = pgEnum('checklist_assignee_role', [
  'hr',
  'manager',
  'it',
  'employee',
]);

/** Lifecycle-case status. Derived from task completion (auto-completes when mandatory tasks close). */
export const lifecycleCaseStatus = pgEnum('lifecycle_case_status', [
  'not_started',
  'in_progress',
  'completed',
  'cancelled',
]);

/** Per-task status on a checklist board. */
export const checklistTaskStatus = pgEnum('checklist_task_status', [
  'pending',
  'in_progress',
  'done',
  'blocked',
  'skipped',
]);

// ── Module 6: Expenses & Reimbursement (PRD §4) ──────────────────────────────

/** Supported claim currencies. Multi-currency, no FX conversion in V2 (report per currency). */
export const currency = pgEnum('currency', ['INR', 'GBP']);

/** Expense-claim lifecycle. `reimbursed` is the terminal Finance transition (no money movement). */
export const expenseClaimStatus = pgEnum('expense_claim_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
  'cancelled',
]);

// ── Module 7: Timesheets + Project Allocation (PRD §5) ───────────────────────

/** Client lifecycle. */
export const clientStatus = pgEnum('client_status', ['active', 'inactive']);

/** Project nature — `internal` projects have no client. */
export const projectType = pgEnum('project_type', ['client', 'internal']);

/** Project lifecycle. */
export const projectStatus = pgEnum('project_status', [
  'planned',
  'active',
  'on_hold',
  'completed',
  'archived',
]);

/** Timesheet lifecycle — managed at the week level; entries inherit it. */
export const timesheetStatus = pgEnum('timesheet_status', [
  'draft',
  'submitted',
  'approved',
  'rejected',
]);

// ── Module 7b: Project Management ────────────────────────────────────────────

/** RAG health of a project, set manually by its PM. */
export const projectHealth = pgEnum('project_health', ['on_track', 'at_risk', 'delayed']);

/** A milestone is a delivery point — delivered or not. The due date carries "is it late". */
export const milestoneStatus = pgEnum('milestone_status', ['pending', 'done']);

/** `blocked` earns its place: without it people encode blockage in the title. */
export const taskStatus = pgEnum('task_status', ['todo', 'in_progress', 'blocked', 'done']);

export const taskPriority = pgEnum('task_priority', ['low', 'medium', 'high']);

// ── Module 8: Performance & Reviews (PRD §3) ─────────────────────────────────

/** Cadence of a review cycle. */
export const reviewCycleType = pgEnum('review_cycle_type', ['quarterly', 'half_yearly', 'annual']);

/** Review-cycle lifecycle. `active` generates the per-participant review rows; `closed` is terminal. */
export const reviewCycleStatus = pgEnum('review_cycle_status', ['draft', 'active', 'closed']);

/** Goal flavour. `objective`/`key_result` model one level of OKR nesting; `personal` is standalone. */
export const goalCategory = pgEnum('goal_category', [
  'objective',
  'key_result',
  'personal',
  'okr',
]);

/** Goal progress state. */
export const goalStatus = pgEnum('goal_status', [
  'not_started',
  'on_track',
  'at_risk',
  'completed',
  'dropped',
]);

/** Perspective a review is written from. */
export const reviewType = pgEnum('review_type', ['self', 'manager', 'peer']);

/** Review lifecycle — immutable once `submitted`. */
export const reviewStatus = pgEnum('review_status', ['pending', 'submitted']);

/** Nature of continuous feedback. */
export const feedbackType = pgEnum('feedback_type', ['praise', 'constructive']);

/** Who may see a feedback note. `manager_visible` also surfaces to the recipient's manager. */
export const feedbackVisibility = pgEnum('feedback_visibility', ['private', 'manager_visible']);

// ── Module 9: Recruitment / ATS (PRD §4) ─────────────────────────────────────

/** Job-opening lifecycle. `filled` is set automatically once headcount is met. */
export const jobOpeningStatus = pgEnum('job_opening_status', [
  'open',
  'on_hold',
  'closed',
  'filled',
]);

/** How a candidate entered the pipeline (feeds source-effectiveness analytics). */
export const candidateSource = pgEnum('candidate_source', [
  'referral',
  'inbound',
  'outbound',
  'agency',
  'other',
]);

/** Application lifecycle. `hired` is the integration trigger (creates Employee + onboarding case). */
export const applicationStatus = pgEnum('application_status', [
  'active',
  'rejected',
  'withdrawn',
  'hired',
]);

/** Interview round flavour. */
export const interviewType = pgEnum('interview_type', ['screen', 'technical', 'cultural', 'final']);

/** Where an interview happens. */
export const interviewMode = pgEnum('interview_mode', ['onsite', 'remote']);

/** Interview lifecycle. */
export const interviewStatus = pgEnum('interview_status', ['scheduled', 'completed', 'cancelled']);

/** Interviewer's hire recommendation on a scorecard. */
export const scorecardRecommendation = pgEnum('scorecard_recommendation', [
  'strong_hire',
  'hire',
  'no_hire',
  'strong_no_hire',
]);

/** Offer lifecycle. `accepted` gates the hire → Employee conversion. */
export const offerStatus = pgEnum('offer_status', ['draft', 'sent', 'accepted', 'declined']);

// ── Module 10: Asset Management (PRD §5) ─────────────────────────────────────

/** Nature of an asset category — hardware is single-custody, a software license is seat-based. */
export const assetCategoryType = pgEnum('asset_category_type', ['hardware', 'software_license']);

/** Asset lifecycle. `assigned` is set while an asset is in someone's custody; `retired`/`lost` are terminal. */
export const assetStatus = pgEnum('asset_status', [
  'available',
  'assigned',
  'in_repair',
  'retired',
  'lost',
]);
