import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  checklistAssigneeRole,
  checklistCategory,
  checklistTaskStatus,
  lifecycleType,
} from '../../../db/schema/enums';

const dateOnly = z.iso.date();

// ── Templates ─────────────────────────────────────────────────────────────────

/** Auto-selection rules. A dimension left out (or empty) is a wildcard. */
const appliesToSchema = z.object({
  employmentTypes: z.array(z.string().trim().min(1)).optional(),
  departmentIds: z.array(z.uuid()).optional(),
  locations: z.array(z.string().trim().min(1)).optional(),
});

/** One step definition inside a template. */
const templateItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.enum(checklistCategory.enumValues),
  defaultAssigneeRole: z.enum(checklistAssigneeRole.enumValues).default('hr'),
  offsetDays: z.number().int().min(-365).max(365).default(0),
  isMandatory: z.boolean().default(true),
  requiresDocument: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(150),
  type: z.enum(lifecycleType.enumValues),
  appliesTo: appliesToSchema.nullable().optional(),
  isActive: z.boolean().default(true),
  items: z.array(templateItemSchema).default([]),
});

/** Partial template update. When `items` is provided it fully replaces the existing item set. */
export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    appliesTo: appliesToSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    items: z.array(templateItemSchema).optional(),
  })
  .strict();

export const listTemplatesSchema = z.object({
  type: z.enum(lifecycleType.enumValues).optional(),
  isActive: z.coerce.boolean().optional(),
});

// ── Lifecycle cases ────────────────────────────────────────────────────────────

export const createCaseSchema = z.object({
  employeeId: z.uuid(),
  type: z.enum(lifecycleType.enumValues),
  /** Explicit template; when omitted the best-matching active template is auto-selected. */
  templateId: z.uuid().nullable().optional(),
  /** Defaults to the employee's joining date (onboarding) or exit date (offboarding). */
  anchorDate: dateOnly.optional(),
});

export const listCasesSchema = z.object({
  scope: z.enum(['me', 'assigned', 'all']).default('all'),
  type: z.enum(lifecycleType.enumValues).optional(),
});

export const cancelCaseSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

// ── Checklist tasks ─────────────────────────────────────────────────────────────

export const listTasksSchema = z.object({
  /** `me` (default) = tasks assigned to the caller; `all` = every task (HR/Admin). */
  assignee: z.union([z.literal('me'), z.literal('all'), z.uuid()]).default('me'),
  status: z.enum(checklistTaskStatus.enumValues).optional(),
  caseId: z.uuid().optional(),
});

export const updateTaskSchema = z
  .object({
    status: z.enum(checklistTaskStatus.enumValues).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    assigneeId: z.uuid().nullable().optional(),
    dueDate: dateOnly.nullable().optional(),
    linkedDocumentId: z.uuid().nullable().optional(),
  })
  .strict();

export const completeTaskSchema = z.object({
  linkedDocumentId: z.uuid().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export class CreateTemplateDto extends createZodDto(createTemplateSchema) {}
export class UpdateTemplateDto extends createZodDto(updateTemplateSchema) {}
export class ListTemplatesDto extends createZodDto(listTemplatesSchema) {}
export class CreateCaseDto extends createZodDto(createCaseSchema) {}
export class ListCasesDto extends createZodDto(listCasesSchema) {}
export class CancelCaseDto extends createZodDto(cancelCaseSchema) {}
export class ListTasksDto extends createZodDto(listTasksSchema) {}
export class UpdateTaskDto extends createZodDto(updateTaskSchema) {}
export class CompleteTaskDto extends createZodDto(completeTaskSchema) {}
