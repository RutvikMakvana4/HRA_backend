import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  applicationStatus,
  candidateSource,
  employmentType,
  interviewMode,
  interviewStatus,
  interviewType,
  jobOpeningStatus,
  offerStatus,
  scorecardRecommendation,
  workLocation,
} from '../../../db/schema/enums';

const dateOnly = z.iso.date();
const dateTime = z.iso.datetime({ offset: true });

// ── Pipeline stages ──────────────────────────────────────────────────────────

export const createStageSchema = z.object({
  name: z.string().trim().min(1).max(100),
  sortOrder: z.number().int().min(0).default(0),
  isTerminal: z.boolean().default(false),
});

export const updateStageSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    sortOrder: z.number().int().min(0).optional(),
    isTerminal: z.boolean().optional(),
  })
  .strict();

// ── Job openings ─────────────────────────────────────────────────────────────

export const createJobOpeningSchema = z.object({
  title: z.string().trim().min(1).max(200),
  departmentId: z.uuid().nullable().optional(),
  employmentType: z.enum(employmentType.enumValues),
  hiringManagerId: z.uuid().nullable().optional(),
  location: z.enum(workLocation.enumValues),
  headcount: z.number().int().min(1).max(1000).default(1),
  description: z.string().trim().max(10000).nullable().optional(),
});

export const updateJobOpeningSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    departmentId: z.uuid().nullable().optional(),
    employmentType: z.enum(employmentType.enumValues).optional(),
    hiringManagerId: z.uuid().nullable().optional(),
    location: z.enum(workLocation.enumValues).optional(),
    headcount: z.number().int().min(1).max(1000).optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    status: z.enum(jobOpeningStatus.enumValues).optional(),
  })
  .strict();

export const listJobOpeningsSchema = z.object({
  status: z.enum(jobOpeningStatus.enumValues).optional(),
});

// ── Candidates ───────────────────────────────────────────────────────────────

export const createCandidateSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.email(),
  phone: z.string().trim().min(3).max(30).nullable().optional(),
  resumeDocumentId: z.uuid().nullable().optional(),
  source: z.enum(candidateSource.enumValues).default('inbound'),
  referredByEmployeeId: z.uuid().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export const updateCandidateSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).optional(),
    email: z.email().optional(),
    phone: z.string().trim().min(3).max(30).nullable().optional(),
    resumeDocumentId: z.uuid().nullable().optional(),
    source: z.enum(candidateSource.enumValues).optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .strict();

export const listCandidatesSchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
});

// ── Applications ─────────────────────────────────────────────────────────────

export const createApplicationSchema = z.object({
  candidateId: z.uuid(),
  jobOpeningId: z.uuid(),
  // Defaults to the first (lowest sort_order, non-terminal) stage when omitted.
  stageId: z.uuid().optional(),
});

export const moveApplicationSchema = z.object({
  stageId: z.uuid(),
});

export const rejectApplicationSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

/**
 * Hire overrides. Everything is optional — sensible defaults are drawn from the job opening
 * (employment type, location, department, hiring manager) and the accepted offer (joining date,
 * designation, comp → payroll hook).
 */
export const hireApplicationSchema = z
  .object({
    employeeCode: z.string().trim().min(1).max(32).optional(),
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    dateOfJoining: dateOnly.optional(),
    employmentType: z.enum(employmentType.enumValues).optional(),
    workLocation: z.enum(workLocation.enumValues).optional(),
    departmentId: z.uuid().nullable().optional(),
    managerId: z.uuid().nullable().optional(),
    designation: z.string().trim().min(1).max(150).optional(),
    // Onboarding case spawn controls (forwarded to the onboarding module).
    onboardingTemplateId: z.uuid().optional(),
    onboardingAnchorDate: dateOnly.optional(),
  })
  .strict();

export const listApplicationsSchema = z.object({
  jobOpeningId: z.uuid().optional(),
  candidateId: z.uuid().optional(),
  status: z.enum(applicationStatus.enumValues).optional(),
});

// ── Interviews ───────────────────────────────────────────────────────────────

export const createInterviewSchema = z.object({
  applicationId: z.uuid(),
  round: z.number().int().min(1).max(20).default(1),
  type: z.enum(interviewType.enumValues),
  interviewerId: z.uuid().nullable().optional(),
  scheduledAt: dateTime.nullable().optional(),
  mode: z.enum(interviewMode.enumValues).default('remote'),
});

export const updateInterviewSchema = z
  .object({
    round: z.number().int().min(1).max(20).optional(),
    type: z.enum(interviewType.enumValues).optional(),
    interviewerId: z.uuid().nullable().optional(),
    scheduledAt: dateTime.nullable().optional(),
    mode: z.enum(interviewMode.enumValues).optional(),
    status: z.enum(interviewStatus.enumValues).optional(),
  })
  .strict();

export const listInterviewsSchema = z.object({
  scope: z.enum(['mine', 'all']).default('all'),
  applicationId: z.uuid().optional(),
});

export const submitScorecardSchema = z.object({
  ratings: z.record(z.string(), z.number()).default({}),
  notes: z.string().trim().max(5000).nullable().optional(),
  recommendation: z.enum(scorecardRecommendation.enumValues),
});

// ── Offers ───────────────────────────────────────────────────────────────────

const offerDetailsSchema = z.object({
  designation: z.string().trim().max(150).optional(),
  joiningDate: dateOnly.optional(),
  comp: z.record(z.string(), z.unknown()).optional(),
});

export const createOfferSchema = z.object({
  applicationId: z.uuid(),
  details: offerDetailsSchema.default({}),
  offerDocumentId: z.uuid().nullable().optional(),
  // `draft` keeps it internal; `sent` marks it delivered to the candidate.
  status: z.enum(['draft', 'sent']).default('draft'),
});

export const updateOfferSchema = z
  .object({
    details: offerDetailsSchema.optional(),
    offerDocumentId: z.uuid().nullable().optional(),
    status: z.enum(offerStatus.enumValues).optional(),
  })
  .strict();

export class CreateStageDto extends createZodDto(createStageSchema) {}
export class UpdateStageDto extends createZodDto(updateStageSchema) {}
export class CreateJobOpeningDto extends createZodDto(createJobOpeningSchema) {}
export class UpdateJobOpeningDto extends createZodDto(updateJobOpeningSchema) {}
export class ListJobOpeningsDto extends createZodDto(listJobOpeningsSchema) {}
export class CreateCandidateDto extends createZodDto(createCandidateSchema) {}
export class UpdateCandidateDto extends createZodDto(updateCandidateSchema) {}
export class ListCandidatesDto extends createZodDto(listCandidatesSchema) {}
export class CreateApplicationDto extends createZodDto(createApplicationSchema) {}
export class MoveApplicationDto extends createZodDto(moveApplicationSchema) {}
export class RejectApplicationDto extends createZodDto(rejectApplicationSchema) {}
export class HireApplicationDto extends createZodDto(hireApplicationSchema) {}
export class ListApplicationsDto extends createZodDto(listApplicationsSchema) {}
export class CreateInterviewDto extends createZodDto(createInterviewSchema) {}
export class UpdateInterviewDto extends createZodDto(updateInterviewSchema) {}
export class ListInterviewsDto extends createZodDto(listInterviewsSchema) {}
export class SubmitScorecardDto extends createZodDto(submitScorecardSchema) {}
export class CreateOfferDto extends createZodDto(createOfferSchema) {}
export class UpdateOfferDto extends createZodDto(updateOfferSchema) {}
