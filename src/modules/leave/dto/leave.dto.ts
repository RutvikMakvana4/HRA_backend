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
  accrualPolicy: accrualPolicySchema.optional(),
  requiresApproval: z.boolean().default(true),
  allowHalfDay: z.boolean().default(true),
  maxConsecutiveDays: z.number().int().positive().nullable().optional(),
});

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
export class ApplyLeaveDto extends createZodDto(applyLeaveSchema) {}
export class ListLeaveRequestsDto extends createZodDto(listLeaveRequestsSchema) {}
export class DecideLeaveDto extends createZodDto(decideLeaveSchema) {}
export class CreateHolidayDto extends createZodDto(createHolidaySchema) {}
export class ListHolidaysDto extends createZodDto(listHolidaysSchema) {}
