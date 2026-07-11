import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { assetCategoryType, assetStatus } from '../../../db/schema/enums';

const dateOnly = z.iso.date();

// ── Asset categories ───────────────────────────────────────────────────────────

export const createAssetCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(assetCategoryType.enumValues).default('hardware'),
});

export const updateAssetCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    type: z.enum(assetCategoryType.enumValues).optional(),
  })
  .strict();

// ── Assets ─────────────────────────────────────────────────────────────────────

/** Shared writable asset fields. `purchaseCost` is minor units (money golden rule). */
const assetFields = {
  assetTag: z.string().trim().min(1).max(64),
  categoryId: z.uuid(),
  make: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  serialNumber: z.string().trim().max(120).nullable().optional(),
  purchaseDate: dateOnly.nullable().optional(),
  purchaseCost: z.number().int().min(0).nullable().optional(),
  warrantyExpiry: dateOnly.nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  vendor: z.string().trim().max(120).nullable().optional(),
  seatsTotal: z.number().int().min(1).max(1_000_000).nullable().optional(),
  renewalDate: dateOnly.nullable().optional(),
};

export const createAssetSchema = z.object(assetFields);

export const updateAssetSchema = z
  .object({
    ...assetFields,
    assetTag: z.string().trim().min(1).max(64).optional(),
    categoryId: z.uuid().optional(),
    // `status` is normally driven by assign/return, but IT may correct it (e.g. → in_repair/retired).
    status: z.enum(assetStatus.enumValues).optional(),
  })
  .strict();

export const listAssetsSchema = z.object({
  status: z.enum(assetStatus.enumValues).optional(),
  category: z.uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

// ── Assign / return ────────────────────────────────────────────────────────────

export const assignAssetSchema = z.object({
  employeeId: z.uuid(),
  linkedChecklistTaskId: z.uuid().nullable().optional(),
  assignedAt: z.iso.datetime({ offset: true }).optional(),
});

export const returnAssetSchema = z
  .object({
    // Which employee's active assignment to close (required for seat-based licenses).
    employeeId: z.uuid().optional(),
    returnedCondition: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

// ── Licenses ───────────────────────────────────────────────────────────────────

export const expiringLicensesSchema = z.object({
  before: dateOnly.optional(),
});

export class CreateAssetCategoryDto extends createZodDto(createAssetCategorySchema) {}
export class UpdateAssetCategoryDto extends createZodDto(updateAssetCategorySchema) {}
export class CreateAssetDto extends createZodDto(createAssetSchema) {}
export class UpdateAssetDto extends createZodDto(updateAssetSchema) {}
export class ListAssetsDto extends createZodDto(listAssetsSchema) {}
export class AssignAssetDto extends createZodDto(assignAssetSchema) {}
export class ReturnAssetDto extends createZodDto(returnAssetSchema) {}
export class ExpiringLicensesDto extends createZodDto(expiringLicensesSchema) {}
