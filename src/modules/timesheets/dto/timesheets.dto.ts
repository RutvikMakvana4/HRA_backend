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

/** hours is decimal (e.g. 1.5); stored as integer minutes. billable defaults from the project. */
export const upsertEntrySchema = z.object({
  projectId: z.uuid(),
  workDate: dateOnly,
  hours: z.number().min(0).max(24),
  billable: z.boolean().optional(),
  taskDescription: z.string().trim().max(500).nullable().optional(),
  category: z.string().trim().max(50).nullable().optional(),
});

export const updateEntrySchema = z
  .object({
    hours: z.number().min(0).max(24).optional(),
    billable: z.boolean().optional(),
    taskDescription: z.string().trim().max(500).nullable().optional(),
    category: z.string().trim().max(50).nullable().optional(),
    workDate: dateOnly.optional(),
    projectId: z.uuid().optional(),
  })
  .strict();

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
});

export class CreateClientDto extends createZodDto(createClientSchema) {}
export class UpdateClientDto extends createZodDto(updateClientSchema) {}
export class CreateProjectDto extends createZodDto(createProjectSchema) {}
export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
export class ListProjectsDto extends createZodDto(listProjectsSchema) {}
export class CreateAllocationDto extends createZodDto(createAllocationSchema) {}
export class GetWeekDto extends createZodDto(getWeekSchema) {}
export class UpsertEntryDto extends createZodDto(upsertEntrySchema) {}
export class UpdateEntryDto extends createZodDto(updateEntrySchema) {}
export class DecideWeekDto extends createZodDto(decideWeekSchema) {}
export class ListWeeksDto extends createZodDto(listWeeksSchema) {}
export class UtilizationReportDto extends createZodDto(utilizationReportSchema) {}
export class AllocationReportDto extends createZodDto(allocationReportSchema) {}
