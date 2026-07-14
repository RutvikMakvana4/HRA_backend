/**
 * Module 1 — Employee Core + Documents (PRD §4). Every other module foreign-keys into
 * `employees`, so this is the schema foundation.
 *
 *  - `employees`   — the single source of truth for every person (employee, contractor, intern),
 *                    plus reserved (no-logic) payroll hooks and the self-referential org chart.
 *  - `departments` — simple org unit with an optional department head.
 *  - `documents`   — S3-backed document vault; files are served only via short-lived signed URLs.
 */
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { citext, timestamps, uuidPk } from './_conventions';
import { candidates } from './recruitment';
import {
  documentType,
  documentVisibility,
  employeeStatus,
  employmentType,
  workLocation,
} from './enums';

/**
 * Department — a simple org unit. `headEmployeeId` is a soft pointer to the employee who heads it
 * (nullable; no cascade). The employees.departmentId ⇄ departments.headEmployeeId pair is a
 * deliberate cycle, so both sides are nullable to allow either row to be created first.
 */
export const departments = pgTable(
  'departments',
  {
    id: uuidPk(),
    name: text('name').notNull().unique(),
    headEmployeeId: uuid('head_employee_id'),
    ...timestamps,
  },
  (t) => ({
    headIdx: index('ix_departments_head').on(t.headEmployeeId),
  }),
);

/**
 * Employee — the canonical person record. `employee_code` and `work_email` are unique and
 * immutable after creation (enforced in the service). Deletion is soft (status → `exited`).
 * `manager_id` is self-referential and must not equal the row's own id or form a cycle (guarded
 * in the service). Statutory ids / salary / bank are reserved payroll hooks with no MVP logic;
 * they hold sensitive data and must be encrypted at rest before real payroll ships.
 */
export const employees = pgTable(
  'employees',
  {
    id: uuidPk(),
    employeeCode: text('employee_code').notNull().unique(),

    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    displayName: text('display_name'),

    personalEmail: citext('personal_email'),
    workEmail: citext('work_email').notNull().unique(),

    phone: text('phone'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),

    dateOfBirth: date('date_of_birth'),
    gender: text('gender'),

    employmentType: employmentType('employment_type').notNull(),
    status: employeeStatus('status').notNull().default('active'),

    dateOfJoining: date('date_of_joining').notNull(),
    dateOfExit: date('date_of_exit'),

    workLocation: workLocation('work_location').notNull(),

    designation: text('designation'),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),

    // Self-referential org chart. AnyPgColumn breaks the type cycle on the self-FK.
    managerId: uuid('manager_id').references((): AnyPgColumn => employees.id, {
      onDelete: 'set null',
    }),

    // ── Reserved payroll hooks (no MVP logic). Encrypt at rest before payroll ships. ──
    statutoryIds: jsonb('statutory_ids'),
    salaryStructure: jsonb('salary_structure'),
    bankAccount: jsonb('bank_account'),

    ...timestamps,
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => ({
    departmentIdx: index('ix_employees_department').on(t.departmentId),
    managerIdx: index('ix_employees_manager').on(t.managerId),
    statusIdx: index('ix_employees_status').on(t.status),
    employmentTypeIdx: index('ix_employees_employment_type').on(t.employmentType),
    workLocationIdx: index('ix_employees_work_location').on(t.workLocation),
  }),
);

/**
 * Document — an S3-backed file attached to an employee OR a candidate (at most one owner,
 * enforced by the `documents_one_owner` check). `fileKey` is the object key; the bytes are
 * NEVER public and are exchanged only via short-lived signed URLs. Deletion is soft (`deletedAt`).
 */
export const documents = pgTable(
  'documents',
  {
    id: uuidPk(),
    employeeId: uuid('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').references((): AnyPgColumn => candidates.id, {
      onDelete: 'set null',
    }),
    type: documentType('type').notNull(),
    title: text('title').notNull(),
    fileKey: text('file_key').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    visibility: documentVisibility('visibility').notNull().default('hr_only'),
    uploadedBy: uuid('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    employeeIdx: index('ix_documents_employee').on(t.employeeId),
    candidateIdx: index('ix_documents_candidate').on(t.candidateId),
    typeIdx: index('ix_documents_type').on(t.type),
    oneOwner: check(
      'documents_one_owner',
      sql`not (${t.employeeId} is not null and ${t.candidateId} is not null)`,
    ),
  }),
);

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;
export type Employee = typeof employees.$inferSelect;
export type NewEmployee = typeof employees.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
