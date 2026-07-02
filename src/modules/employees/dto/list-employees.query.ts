import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { employeeStatus, employmentType, workLocation } from '../../../db/schema/enums';

/**
 * Filters + pagination for `GET /employees` (HR/Admin). All fields optional; unknown query keys are
 * stripped. Numeric params are coerced from their string query representation.
 */
export const listEmployeesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(25),
  departmentId: z.uuid().optional(),
  status: z.enum(employeeStatus.enumValues).optional(),
  employmentType: z.enum(employmentType.enumValues).optional(),
  workLocation: z.enum(workLocation.enumValues).optional(),
  /** Free-text match over name, code, and work email. */
  search: z.string().trim().min(1).max(100).optional(),
});

export class ListEmployeesQueryDto extends createZodDto(listEmployeesQuerySchema) {}
