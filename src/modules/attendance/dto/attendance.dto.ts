import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { attendanceStatus, workMode } from '../../../db/schema/enums';

const dateOnly = z.iso.date();
const workModeSchema = z.enum(workMode.enumValues);

export const checkInSchema = z.object({
  workMode: workModeSchema.default('office'),
  notes: z.string().trim().max(500).optional(),
});

export const checkOutSchema = z.object({
  notes: z.string().trim().max(500).optional(),
});

export const listAttendanceSchema = z.object({
  scope: z.enum(['me', 'team', 'all']).default('me'),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

/** A regularization: correct an existing record (by id) or a specific date. */
export const regularizeSchema = z
  .object({
    attendanceRecordId: z.uuid().optional(),
    date: dateOnly.optional(),
    requestedChange: z.record(z.string(), z.unknown()),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.attendanceRecordId || v.date, {
    message: 'Provide attendanceRecordId or date',
    path: ['attendanceRecordId'],
  });

export const decideRegularizationSchema = z.object({
  decision: z.enum(['approve', 'reject']),
});

/** HR manual edit of an attendance record (audited). */
export const updateAttendanceSchema = z
  .object({
    checkIn: z.iso.datetime().nullable().optional(),
    checkOut: z.iso.datetime().nullable().optional(),
    workMode: workModeSchema.optional(),
    status: z.enum(attendanceStatus.enumValues).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export class CheckInDto extends createZodDto(checkInSchema) {}
export class CheckOutDto extends createZodDto(checkOutSchema) {}
export class ListAttendanceDto extends createZodDto(listAttendanceSchema) {}
export class RegularizeDto extends createZodDto(regularizeSchema) {}
export class DecideRegularizationDto extends createZodDto(decideRegularizationSchema) {}
export class UpdateAttendanceDto extends createZodDto(updateAttendanceSchema) {}
