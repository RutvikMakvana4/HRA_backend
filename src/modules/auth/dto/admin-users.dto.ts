import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { accountStatus, userRole } from '../../../db/schema/enums';

/** Create a login account for an existing employee and assign a role (Super Admin). */
export const createUserAccountSchema = z.object({
  employeeId: z.uuid(),
  role: z.enum(userRole.enumValues),
  password: z.string().min(8).max(128),
});

export const setRoleSchema = z.object({ role: z.enum(userRole.enumValues) });
export const setStatusSchema = z.object({ status: z.enum(accountStatus.enumValues) });
export const resetPasswordSchema = z.object({ newPassword: z.string().min(8).max(128) });

/** Filters for the audit-log reader (Super Admin). */
export const listAuditLogsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
  actorId: z.uuid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  targetType: z.string().trim().min(1).max(100).optional(),
});

export class CreateUserAccountDto extends createZodDto(createUserAccountSchema) {}
export class SetRoleDto extends createZodDto(setRoleSchema) {}
export class SetStatusDto extends createZodDto(setStatusSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
export class ListAuditLogsDto extends createZodDto(listAuditLogsSchema) {}
