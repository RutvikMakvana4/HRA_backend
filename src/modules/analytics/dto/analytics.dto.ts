import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const dateOnly = z.iso.date();
/** A reporting period: a year (`YYYY`) or a month (`YYYY-MM`). */
const period = z.string().regex(/^\d{4}(-\d{2})?$/, 'period must be YYYY or YYYY-MM');
/** RBAC scope hint; the service downgrades it to the caller's ceiling (employee→self, manager→team). */
const scope = z.enum(['self', 'team', 'org']);

export const headcountSchema = z.object({
  group_by: z.enum(['department', 'type', 'location']).default('department'),
});

export const attritionSchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

export const leaveAnalyticsSchema = z.object({
  type: z.string().trim().min(1).max(50).optional(),
  period: period.optional(),
  scope: scope.optional(),
});

export const attendanceAnalyticsSchema = z.object({
  period: period.optional(),
  scope: scope.optional(),
});

export const utilizationSchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  scope: scope.optional(),
});

export const recruitmentFunnelSchema = z.object({
  opening: z.uuid().optional(),
});

export const exportSchema = z.object({
  report: z.enum([
    'headcount',
    'attrition',
    'leave',
    'attendance',
    'utilization',
    'recruitment-funnel',
    'assets',
  ]),
  format: z.enum(['csv']).default('csv'),
  group_by: z.enum(['department', 'type', 'location']).optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  period: period.optional(),
  opening: z.uuid().optional(),
});

export class HeadcountDto extends createZodDto(headcountSchema) {}
export class AttritionDto extends createZodDto(attritionSchema) {}
export class LeaveAnalyticsDto extends createZodDto(leaveAnalyticsSchema) {}
export class AttendanceAnalyticsDto extends createZodDto(attendanceAnalyticsSchema) {}
export class UtilizationDto extends createZodDto(utilizationSchema) {}
export class RecruitmentFunnelDto extends createZodDto(recruitmentFunnelSchema) {}
export class ExportDto extends createZodDto(exportSchema) {}
