import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { departments, employees, type Department } from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  /** All departments, alphabetical, each with a live `employee_count` (readable by any user). */
  list() {
    return this.db
      .select({
        id: departments.id,
        name: departments.name,
        headEmployeeId: departments.headEmployeeId,
        createdAt: departments.createdAt,
        updatedAt: departments.updatedAt,
        employeeCount: sql<number>`cast(count(${employees.id}) as int)`,
      })
      .from(departments)
      .leftJoin(employees, eq(employees.departmentId, departments.id))
      .groupBy(departments.id)
      .orderBy(departments.name);
  }

  async getOrThrow(id: string): Promise<Department> {
    const [row] = await this.db.select().from(departments).where(eq(departments.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Department not found', HttpStatus.NOT_FOUND);
    return row;
  }

  async create(dto: CreateDepartmentDto, actor: AuthenticatedUser): Promise<Department> {
    const [row] = await this.runMapped(() =>
      this.db.insert(departments).values(dto).returning(),
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create department');

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'department.create',
      target: `department:${row.id}`,
      after: { ...row },
    });
    return row;
  }

  async update(id: string, dto: UpdateDepartmentDto, actor: AuthenticatedUser): Promise<Department> {
    const before = await this.getOrThrow(id);
    if (Object.keys(dto).length === 0) return before;

    const [row] = await this.runMapped(() =>
      this.db
        .update(departments)
        .set({ ...dto, updatedAt: new Date() })
        .where(eq(departments.id, id))
        .returning(),
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update department');

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'department.update',
      target: `department:${id}`,
      before: { ...before },
      after: { ...row },
    });
    return row;
  }

  /**
   * Delete a department. Members' `department_id` is set null by the FK (`onDelete: 'set null'`),
   * so no employee rows are lost. Audited.
   */
  async remove(id: string, actor: AuthenticatedUser): Promise<{ id: string; deleted: true }> {
    const before = await this.getOrThrow(id);
    await this.db.delete(departments).where(eq(departments.id, id));
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'department.delete',
      target: `department:${id}`,
      before: { ...before },
    });
    return { id, deleted: true };
  }

  private async runMapped<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'code' in err && err.code === '23505') {
        throw new AppError(ErrorCode.CONFLICT, 'A department with that name already exists', HttpStatus.CONFLICT);
      }
      throw err;
    }
  }
}
