import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { documentType, documentVisibility } from '../../../db/schema/enums';

/**
 * Register a new document for an employee (HR/Admin). The response returns a short-lived signed PUT
 * URL; the client uploads the bytes directly to S3 under the generated key.
 */
export const createDocumentSchema = z.object({
  type: z.enum(documentType.enumValues),
  title: z.string().trim().min(1).max(200),
  /** Original filename — used to build the object key and the download disposition. */
  filename: z.string().trim().min(1).max(200),
  mimeType: z.string().trim().min(1).max(150),
  sizeBytes: z.coerce.number().int().nonnegative().optional(),
  visibility: z.enum(documentVisibility.enumValues).default('hr_only'),
  /** Optional expiry (e.g. contract/visa), ISO-8601 datetime. */
  expiresAt: z.iso.datetime().optional(),
});

export class CreateDocumentDto extends createZodDto(createDocumentSchema) {}
