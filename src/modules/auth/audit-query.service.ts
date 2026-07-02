import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { auditLog, type AuditLog } from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import type { ListAuditLogsDto } from './dto/admin-users.dto';

/** Read access to the immutable audit log (PRD §2 — Super Admin "audit log access"). */
@Injectable()
export class AuditQueryService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(query: ListAuditLogsDto): Promise<{
    data: AuditLog[];
    page: number;
    pageSize: number;
  }> {
    const filters: SQL[] = [];
    if (query.actorId) filters.push(eq(auditLog.actorId, query.actorId));
    if (query.action) filters.push(eq(auditLog.action, query.action));
    if (query.targetType) filters.push(eq(auditLog.targetType, query.targetType));
    const where = filters.length ? and(...filters) : undefined;

    const data = await this.db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return { data, page: query.page, pageSize: query.pageSize };
  }
}
