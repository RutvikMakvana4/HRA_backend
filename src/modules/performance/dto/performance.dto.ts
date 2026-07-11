import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  feedbackType,
  feedbackVisibility,
  goalCategory,
  goalStatus,
  reviewCycleType,
} from '../../../db/schema/enums';

const dateOnly = z.iso.date();

// ── Review cycles ────────────────────────────────────────────────────────────

export const createCycleSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    type: z.enum(reviewCycleType.enumValues),
    startDate: dateOnly,
    endDate: dateOnly,
    templateId: z.uuid().nullable().optional(),
    includesSelfReview: z.boolean().default(true),
    includesPeerReview: z.boolean().default(false),
    includesManagerReview: z.boolean().default(true),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

export const updateCycleSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    type: z.enum(reviewCycleType.enumValues).optional(),
    startDate: dateOnly.optional(),
    endDate: dateOnly.optional(),
    templateId: z.uuid().nullable().optional(),
    includesSelfReview: z.boolean().optional(),
    includesPeerReview: z.boolean().optional(),
    includesManagerReview: z.boolean().optional(),
  })
  .strict();

// ── Goals ────────────────────────────────────────────────────────────────────

export const createGoalSchema = z.object({
  // HR/managers may create goals for another employee; omitted = self.
  employeeId: z.uuid().optional(),
  cycleId: z.uuid().nullable().optional(),
  parentGoalId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(goalCategory.enumValues).default('personal'),
  weight: z.number().int().min(0).max(100).nullable().optional(),
  metricTarget: z.string().trim().max(500).nullable().optional(),
  progressPct: z.number().int().min(0).max(100).default(0),
  status: z.enum(goalStatus.enumValues).default('not_started'),
  dueDate: dateOnly.nullable().optional(),
});

export const updateGoalSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: z.enum(goalCategory.enumValues).optional(),
    cycleId: z.uuid().nullable().optional(),
    parentGoalId: z.uuid().nullable().optional(),
    weight: z.number().int().min(0).max(100).nullable().optional(),
    metricTarget: z.string().trim().max(500).nullable().optional(),
    progressPct: z.number().int().min(0).max(100).optional(),
    status: z.enum(goalStatus.enumValues).optional(),
    dueDate: dateOnly.nullable().optional(),
  })
  .strict();

export const listGoalsSchema = z.object({
  employeeId: z.uuid().optional(),
  cycleId: z.uuid().optional(),
  scope: z.enum(['me', 'team']).optional(),
});

// ── Review templates ─────────────────────────────────────────────────────────

const competencySchema = z.object({
  id: z.uuid().optional(),
  label: z.string().trim().min(1).max(150),
  description: z.string().trim().max(500).optional(),
  ratingScale: z.number().int().min(2).max(10).default(5),
});

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(150),
  competencies: z.array(competencySchema).default([]),
  openQuestions: z.array(z.string().trim().min(1).max(500)).default([]),
});

export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    competencies: z.array(competencySchema).optional(),
    openQuestions: z.array(z.string().trim().min(1).max(500)).optional(),
  })
  .strict();

// ── Reviews ──────────────────────────────────────────────────────────────────

export const listReviewsSchema = z.object({
  scope: z.enum(['me', 'team', 'to-complete']).default('me'),
  cycleId: z.uuid().optional(),
});

/** Save (draft) a review's responses before submission. */
export const updateReviewSchema = z
  .object({
    responses: z.record(z.string(), z.unknown()).optional(),
    overallRating: z.number().int().min(1).max(10).nullable().optional(),
  })
  .strict();

export const submitReviewSchema = z
  .object({
    responses: z.record(z.string(), z.unknown()).optional(),
    overallRating: z.number().int().min(1).max(10).nullable().optional(),
  })
  .strict();

/** Manager/HR nominates a peer reviewer for a subject in a cycle. */
export const assignPeerSchema = z.object({
  subjectEmployeeId: z.uuid(),
  reviewerId: z.uuid(),
});

// ── 1:1s ─────────────────────────────────────────────────────────────────────

const actionItemSchema = z.object({
  id: z.uuid().optional(),
  text: z.string().trim().min(1).max(500),
  ownerId: z.uuid().optional(),
  done: z.boolean().default(false),
});

export const createOneOnOneSchema = z.object({
  // Manager schedules for a report; employee may log one with their manager.
  managerId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  date: dateOnly,
  sharedNotes: z.string().trim().max(5000).nullable().optional(),
  privateNotes: z.string().trim().max(5000).nullable().optional(),
  actionItems: z.array(actionItemSchema).default([]),
});

export const updateOneOnOneSchema = z
  .object({
    date: dateOnly.optional(),
    sharedNotes: z.string().trim().max(5000).nullable().optional(),
    privateNotes: z.string().trim().max(5000).nullable().optional(),
    actionItems: z.array(actionItemSchema).optional(),
  })
  .strict();

export const listOneOnOnesSchema = z.object({
  employeeId: z.uuid().optional(),
});

// ── Feedback ─────────────────────────────────────────────────────────────────

export const createFeedbackSchema = z.object({
  toEmployeeId: z.uuid(),
  type: z.enum(feedbackType.enumValues),
  visibility: z.enum(feedbackVisibility.enumValues).default('private'),
  text: z.string().trim().min(1).max(2000),
});

export const listFeedbackSchema = z.object({
  scope: z.enum(['received', 'given', 'team']).default('received'),
});

export class CreateCycleDto extends createZodDto(createCycleSchema) {}
export class UpdateCycleDto extends createZodDto(updateCycleSchema) {}
export class CreateGoalDto extends createZodDto(createGoalSchema) {}
export class UpdateGoalDto extends createZodDto(updateGoalSchema) {}
export class ListGoalsDto extends createZodDto(listGoalsSchema) {}
export class CreateTemplateDto extends createZodDto(createTemplateSchema) {}
export class UpdateTemplateDto extends createZodDto(updateTemplateSchema) {}
export class ListReviewsDto extends createZodDto(listReviewsSchema) {}
export class UpdateReviewDto extends createZodDto(updateReviewSchema) {}
export class SubmitReviewDto extends createZodDto(submitReviewSchema) {}
export class AssignPeerDto extends createZodDto(assignPeerSchema) {}
export class CreateOneOnOneDto extends createZodDto(createOneOnOneSchema) {}
export class UpdateOneOnOneDto extends createZodDto(updateOneOnOneSchema) {}
export class ListOneOnOnesDto extends createZodDto(listOneOnOnesSchema) {}
export class CreateFeedbackDto extends createZodDto(createFeedbackSchema) {}
export class ListFeedbackDto extends createZodDto(listFeedbackSchema) {}
