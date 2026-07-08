import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { halfDayPeriod, holidayLocation, leaveLocation } from '../../../db/schema/enums';

const dateOnly = z.iso.date();
const scope = z.enum(['me', 'team', 'all']).default('me');

// ── Leave types ──────────────────────────────────────────────────────────────

const accrualPolicySchema = z.object({
  method: z.enum(['monthly', 'annual', 'none']),
  rate: z.number().nonnegative().optional(),
  cap: z.number().nonnegative().optional(),
  carryForward: z.boolean().optional(),
  carryForwardCap: z.number().nonnegative().nullable().optional(),
});

export const createLeaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(20),
  isPaid: z.boolean().default(true),
  appliesToLocation: z.enum(leaveLocation.enumValues).default('all'),
  /** Null means "no accrual rules" (e.g. comp-off). */
  accrualPolicy: accrualPolicySchema.nullable().optional(),
  requiresApproval: z.boolean().default(true),
  allowHalfDay: z.boolean().default(true),
  maxConsecutiveDays: z.number().int().positive().nullable().optional(),
});

/** Partial update; `code` is immutable (it is the type's stable identifier). */
export const updateLeaveTypeSchema = createLeaveTypeSchema
  .omit({ code: true })
  .partial()
  .strict();

// ── Leave requests ───────────────────────────────────────────────────────────

export const applyLeaveSchema = z
  .object({
    leaveTypeId: z.uuid(),
    startDate: dateOnly,
    endDate: dateOnly,
    isHalfDay: z.boolean().default(false),
    halfDayPeriod: z.enum(halfDayPeriod.enumValues).nullable().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })
  .refine((v) => !v.isHalfDay || v.startDate === v.endDate, {
    message: 'A half-day leave must be a single day',
    path: ['isHalfDay'],
  });

export const listLeaveRequestsSchema = z.object({ scope });

/** Body for approve / reject / cancel: an optional decision note. */
export const decideLeaveSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

// ── Leave balances ───────────────────────────────────────────────────────────

/**
 * Manual balance set (HR/Admin) — the stop-gap until accrual automation lands.
 * SETS the employee's accrued days for the year (absolute, not incremental),
 * so the call is idempotent and doubles as the edit: set again to correct it.
 * `used`/`pending` are never touched here.
 */
export const setLeaveBalanceSchema = z.object({
  employeeId: z.uuid(),
  leaveTypeId: z.uuid(),
  days: z.number().nonnegative().max(365),
  year: z.number().int().min(2000).max(2100).optional(),
});

/** One-click new-joiner grant: every accruing type's entitlement for the year. */
export const grantPerPolicySchema = z.object({
  employeeId: z.uuid(),
  year: z.number().int().min(2000).max(2100).optional(),
});

// ── Holidays ─────────────────────────────────────────────────────────────────

export const createHolidaySchema = z.object({
  name: z.string().trim().min(1).max(150),
  date: dateOnly,
  location: z.enum(holidayLocation.enumValues),
  year: z.number().int().min(2000).max(2100).optional(),
});

export const listHolidaysSchema = z.object({
  location: z.enum(holidayLocation.enumValues).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export class CreateLeaveTypeDto extends createZodDto(createLeaveTypeSchema) {}
export class UpdateLeaveTypeDto extends createZodDto(updateLeaveTypeSchema) {}
export class SetLeaveBalanceDto extends createZodDto(setLeaveBalanceSchema) {}
export class GrantPerPolicyDto extends createZodDto(grantPerPolicySchema) {}
export class ApplyLeaveDto extends createZodDto(applyLeaveSchema) {}
export class ListLeaveRequestsDto extends createZodDto(listLeaveRequestsSchema) {}
export class DecideLeaveDto extends createZodDto(decideLeaveSchema) {}
export class CreateHolidayDto extends createZodDto(createHolidaySchema) {}
export class ListHolidaysDto extends createZodDto(listHolidaysSchema) {}
