import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { clientStatus, projectStatus, projectType } from '../../../db/schema/enums';

const dateOnly = z.iso.date();

// ── Clients ─────────────────────────────────────────────────────────────────────

export const createClientSchema = z.object({
  name: z.string().trim().min(1).max(150),
  code: z.string().trim().min(1).max(30),
  status: z.enum(clientStatus.enumValues).default('active'),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const updateClientSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    code: z.string().trim().min(1).max(30).optional(),
    status: z.enum(clientStatus.enumValues).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

// ── Projects ────────────────────────────────────────────────────────────────────

export const createProjectSchema = z
  .object({
    clientId: z.uuid().nullable().optional(),
    name: z.string().trim().min(1).max(150),
    code: z.string().trim().min(1).max(30),
    type: z.enum(projectType.enumValues).default('client'),
    defaultBillable: z.boolean().default(true),
    status: z.enum(projectStatus.enumValues).default('active'),
    startDate: dateOnly.nullable().optional(),
    endDate: dateOnly.nullable().optional(),
    pmEmployeeId: z.uuid().nullable().optional(),
  })
  .refine((v) => v.type !== 'client' || v.clientId, {
    message: 'Client projects require a clientId',
    path: ['clientId'],
  })
  .refine((v) => !v.endDate || !v.startDate || v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

export const updateProjectSchema = z
  .object({
    clientId: z.uuid().nullable().optional(),
    name: z.string().trim().min(1).max(150).optional(),
    code: z.string().trim().min(1).max(30).optional(),
    type: z.enum(projectType.enumValues).optional(),
    defaultBillable: z.boolean().optional(),
    status: z.enum(projectStatus.enumValues).optional(),
    startDate: dateOnly.nullable().optional(),
    endDate: dateOnly.nullable().optional(),
    pmEmployeeId: z.uuid().nullable().optional(),
  })
  .strict();

export const listProjectsSchema = z.object({
  status: z.enum(projectStatus.enumValues).optional(),
  clientId: z.uuid().optional(),
  type: z.enum(projectType.enumValues).optional(),
});

// ── Allocations ───────────────────────────────────────────────────────────────

export const createAllocationSchema = z
  .object({
    employeeId: z.uuid(),
    roleOnProject: z.string().trim().min(1).max(80).nullable().optional(),
    allocationPct: z.number().int().min(0).max(100),
    startDate: dateOnly.nullable().optional(),
    endDate: dateOnly.nullable().optional(),
  })
  .refine((v) => !v.endDate || !v.startDate || v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

// ── Timesheets ─────────────────────────────────────────────────────────────────

export const getWeekSchema = z.object({
  employeeId: z.uuid().optional(),
  weekStart: dateOnly.optional(),
});

export const decideWeekSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

// ── Reports ──────────────────────────────────────────────────────────────────

export const listWeeksSchema = z.object({
  scope: z.enum(['me', 'team', 'all']).default('me'),
});

export const utilizationReportSchema = z
  .object({
    from: dateOnly,
    to: dateOnly,
    scope: z.enum(['me', 'team', 'all']).default('me'),
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });

export const allocationReportSchema = z.object({
  date: dateOnly.optional(),
  scope: z.enum(['me', 'team', 'all']).default('me'),
});

export const listAllocationsSchema = z.object({
  scope: z.enum(['me', 'team', 'all']).default('me'),
});

// ── Milestones & progress ────────────────────────────────────────────────────

export const createMilestoneSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  dueDate: dateOnly,
  sortOrder: z.number().int().min(0).optional(),
});

export const updateMilestoneSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    dueDate: dateOnly.optional(),
    status: z.enum(['pending', 'done']).optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();

export const updateProgressSchema = z
  .object({
    progressPct: z.number().int().min(0).max(100).optional(),
    health: z.enum(['on_track', 'at_risk', 'delayed']).optional(),
  })
  .strict();

// ── Tasks ────────────────────────────────────────────────────────────────────

export const listTasksSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'blocked', 'done']).optional(),
  assigneeId: z.uuid().optional(),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  assigneeEmployeeId: z.uuid().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: dateOnly.nullable().optional(),
  milestoneId: z.uuid().nullable().optional(),
  blockedReason: z.string().trim().min(1).max(500).nullable().optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    assigneeEmployeeId: z.uuid().nullable().optional(),
    status: z.enum(['todo', 'in_progress', 'blocked', 'done']).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
    dueDate: dateOnly.nullable().optional(),
    milestoneId: z.uuid().nullable().optional(),
    blockedReason: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict();

export class CreateClientDto extends createZodDto(createClientSchema) {}
export class UpdateClientDto extends createZodDto(updateClientSchema) {}
export class CreateProjectDto extends createZodDto(createProjectSchema) {}
export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
export class ListProjectsDto extends createZodDto(listProjectsSchema) {}
export class CreateAllocationDto extends createZodDto(createAllocationSchema) {}
export class GetWeekDto extends createZodDto(getWeekSchema) {}
export class DecideWeekDto extends createZodDto(decideWeekSchema) {}
export class ListWeeksDto extends createZodDto(listWeeksSchema) {}
export class UtilizationReportDto extends createZodDto(utilizationReportSchema) {}
export class AllocationReportDto extends createZodDto(allocationReportSchema) {}
export class ListAllocationsDto extends createZodDto(listAllocationsSchema) {}
export class CreateMilestoneDto extends createZodDto(createMilestoneSchema) {}
export class UpdateMilestoneDto extends createZodDto(updateMilestoneSchema) {}
export class UpdateProgressDto extends createZodDto(updateProgressSchema) {}
export class ListTasksDto extends createZodDto(listTasksSchema) {}
export class CreateTaskDto extends createZodDto(createTaskSchema) {}
export class UpdateTaskDto extends createZodDto(updateTaskSchema) {}

// ── Updates & comments ───────────────────────────────────────────────────────

export const listUpdatesSchema = z.object({
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

export const missingUpdatesSchema = z.object({
  date: dateOnly.optional(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export class ListUpdatesDto extends createZodDto(listUpdatesSchema) {}
export class MissingUpdatesDto extends createZodDto(missingUpdatesSchema) {}
export class CreateCommentDto extends createZodDto(createCommentSchema) {}

// ── Task-scoped work logging (v2) ────────────────────────────────────────────

export const logTaskWorkSchema = z.object({
  workDate: dateOnly,
  hours: z.number().min(0).max(24), // 0 = committed for the day, not yet worked
  note: z.string().trim().max(2000).nullable().optional(),
  billable: z.boolean().optional(),
});

export class LogTaskWorkDto extends createZodDto(logTaskWorkSchema) {}

// ── My tasks (cross-project, v2) ──────────────────────────────────────────────

export const myTasksQuerySchema = z.object({
  date: dateOnly.optional(),
  status: z.enum(['todo', 'in_progress', 'blocked', 'done']).optional(),
});

export class MyTasksQueryDto extends createZodDto(myTasksQuerySchema) {}
