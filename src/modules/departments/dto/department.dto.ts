import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(150),
  headEmployeeId: z.uuid().optional(),
});

export const updateDepartmentSchema = createDepartmentSchema.partial().strict();

export class CreateDepartmentDto extends createZodDto(createDepartmentSchema) {}
export class UpdateDepartmentDto extends createZodDto(updateDepartmentSchema) {}
