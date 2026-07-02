import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  employeeStatus,
  employmentType,
  workLocation,
} from '../../../db/schema/enums';

/** Enum schemas derived from the single source of truth (the pg enums). */
const employmentTypeSchema = z.enum(employmentType.enumValues);
const employeeStatusSchema = z.enum(employeeStatus.enumValues);
const workLocationSchema = z.enum(workLocation.enumValues);

/** A `YYYY-MM-DD` calendar date (no time component). */
const dateOnly = z.iso.date();

/** Free-form JSON payroll hook (reserved; encrypt at rest before payroll ships). */
const jsonHook = z.record(z.string(), z.unknown());

/**
 * Full create payload (HR/Admin only). `employeeCode` and `workEmail` are set once and are
 * immutable afterwards (enforced in the service — they are simply absent from the update schemas).
 */
export const createEmployeeSchema = z.object({
  employeeCode: z.string().trim().min(1).max(32),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(150).optional(),

  personalEmail: z.email().optional(),
  workEmail: z.email(),

  phone: z.string().trim().min(3).max(30).optional(),
  emergencyContactName: z.string().trim().min(1).max(150).optional(),
  emergencyContactPhone: z.string().trim().min(3).max(30).optional(),

  dateOfBirth: dateOnly.optional(),
  gender: z.string().trim().min(1).max(50).optional(),

  employmentType: employmentTypeSchema,
  status: employeeStatusSchema.optional(),

  dateOfJoining: dateOnly,
  dateOfExit: dateOnly.optional(),

  workLocation: workLocationSchema,

  designation: z.string().trim().min(1).max(150).optional(),
  departmentId: z.uuid().optional(),
  managerId: z.uuid().optional(),

  // Reserved payroll hooks — accepted but not processed in the MVP.
  statutoryIds: jsonHook.optional(),
  salaryStructure: jsonHook.optional(),
  bankAccount: jsonHook.optional(),
});

/**
 * HR/Admin update. Everything is optional (partial update) EXCEPT the immutable identity fields
 * (`employeeCode`, `workEmail`), which are intentionally not part of the schema.
 */
export const updateEmployeeSchema = createEmployeeSchema
  .omit({ employeeCode: true, workEmail: true })
  .partial()
  .strict();

/**
 * Self-service update (ESS). Employees may edit only this narrow subset of their own profile
 * (PRD §4.2). Everything else is HR-controlled.
 */
export const updateMyProfileSchema = z
  .object({
    phone: z.string().trim().min(3).max(30),
    personalEmail: z.email(),
    emergencyContactName: z.string().trim().min(1).max(150),
    emergencyContactPhone: z.string().trim().min(3).max(30),
  })
  .partial()
  .strict();

export class CreateEmployeeDto extends createZodDto(createEmployeeSchema) {}
export class UpdateEmployeeDto extends createZodDto(updateEmployeeSchema) {}
export class UpdateMyProfileDto extends createZodDto(updateMyProfileSchema) {}
