import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { currency, expenseClaimStatus } from '../../../db/schema/enums';

const dateOnly = z.iso.date();
/** Money is integer MINOR units (paise/pence) end-to-end — never float (Golden Rule 1). */
const minorUnits = z.number().int().nonnegative();

// ── Categories ─────────────────────────────────────────────────────────────────

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  requiresReceipt: z.boolean().default(true),
  monthlyCap: minorUnits.nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    requiresReceipt: z.boolean().optional(),
    monthlyCap: minorUnits.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

// ── Claims ──────────────────────────────────────────────────────────────────────

export const createClaimSchema = z.object({
  title: z.string().trim().min(1).max(150),
  currency: z.enum(currency.enumValues),
  projectId: z.uuid().nullable().optional(),
});

export const updateClaimSchema = z
  .object({
    title: z.string().trim().min(1).max(150).optional(),
    currency: z.enum(currency.enumValues).optional(),
    projectId: z.uuid().nullable().optional(),
  })
  .strict();

export const listClaimsSchema = z.object({
  scope: z.enum(['me', 'team', 'all']).default('me'),
  status: z.enum(expenseClaimStatus.enumValues).optional(),
  projectId: z.uuid().optional(),
});

// ── Line items ────────────────────────────────────────────────────────────────

export const addLineItemSchema = z.object({
  categoryId: z.uuid(),
  expenseDate: dateOnly,
  amount: minorUnits.refine((v) => v > 0, { message: 'amount must be greater than 0' }),
  description: z.string().trim().max(500).nullable().optional(),
  receiptDocumentId: z.uuid().nullable().optional(),
  merchant: z.string().trim().max(150).nullable().optional(),
});

export const updateLineItemSchema = z
  .object({
    categoryId: z.uuid().optional(),
    expenseDate: dateOnly.optional(),
    amount: minorUnits.refine((v) => v > 0, { message: 'amount must be greater than 0' }).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    receiptDocumentId: z.uuid().nullable().optional(),
    merchant: z.string().trim().max(150).nullable().optional(),
  })
  .strict();

// ── Decisions ────────────────────────────────────────────────────────────────

export const decideClaimSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const reimburseClaimSchema = z.object({
  reimbursementRef: z.string().trim().min(1).max(150),
  note: z.string().trim().max(500).optional(),
});

export class CreateCategoryDto extends createZodDto(createCategorySchema) {}
export class UpdateCategoryDto extends createZodDto(updateCategorySchema) {}
export class CreateClaimDto extends createZodDto(createClaimSchema) {}
export class UpdateClaimDto extends createZodDto(updateClaimSchema) {}
export class ListClaimsDto extends createZodDto(listClaimsSchema) {}
export class AddLineItemDto extends createZodDto(addLineItemSchema) {}
export class UpdateLineItemDto extends createZodDto(updateLineItemSchema) {}
export class DecideClaimDto extends createZodDto(decideClaimSchema) {}
export class ReimburseClaimDto extends createZodDto(reimburseClaimSchema) {}
