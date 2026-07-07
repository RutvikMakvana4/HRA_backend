import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { documents, type Document } from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove } from '../auth/roles';
import { EmployeesService } from '../employees/employees.service';
import { StorageService } from '../storage/storage.service';
import type { CreateDocumentDto } from './dto/document.dto';

export interface CreatedDocument {
  document: Document;
  /** Signed PUT URL — upload the bytes here, then the record is complete. */
  upload: { url: string; expiresIn: number };
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly employeesService: EmployeesService,
  ) {}

  /** Register a document for an employee and return a signed upload URL (HR/Admin). */
  async createForEmployee(
    employeeId: string,
    dto: CreateDocumentDto,
    actor: AuthenticatedUser,
  ): Promise<CreatedDocument> {
    const isHr = isAdminOrAbove(actor);
    if (!isHr && employeeId !== actor.id) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'You can only upload documents to your own profile',
        HttpStatus.FORBIDDEN,
      );
    }
    // Employees may only create documents visible to themselves; never hr_only.
    const visibility = isHr ? dto.visibility : 'employee_visible';

    await this.employeesService.ensureExists(employeeId);
    const fileKey = this.storage.buildDocumentKey(employeeId, dto.filename);

    const [row] = await this.db
      .insert(documents)
      .values({
        employeeId,
        type: dto.type,
        title: dto.title,
        fileKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        visibility,
        uploadedBy: actor.id,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create document');

    const url = await this.storage.presignUpload(fileKey, dto.mimeType);

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'document.create',
      target: `document:${row.id}`,
      after: { id: row.id, employeeId, type: row.type, visibility: row.visibility },
    });
    return { document: row, upload: { url, expiresIn: 300 } };
  }

  /** Documents for an employee, visibility-scoped by the caller's role/relationship. */
  async listForEmployee(employeeId: string, actor: AuthenticatedUser): Promise<Document[]> {
    await this.assertCanAccessEmployeeDocs(employeeId, actor);
    const conditions = [eq(documents.employeeId, employeeId), isNull(documents.deletedAt)];
    // Non-HR viewers (owner / manager) see only employee-visible documents.
    if (!isAdminOrAbove(actor)) conditions.push(eq(documents.visibility, 'employee_visible'));

    return this.db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.uploadedAt));
  }

  /** Access-checked signed download URL for a single document. */
  async getDownloadUrl(
    documentId: string,
    actor: AuthenticatedUser,
  ): Promise<{ url: string; expiresIn: number }> {
    const doc = await this.getActiveOrThrow(documentId);
    const hr = isAdminOrAbove(actor);
    if (!hr) {
      if (doc.visibility !== 'employee_visible') {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to access this document', HttpStatus.FORBIDDEN);
      }
      await this.assertCanAccessEmployeeDocs(doc.employeeId, actor);
    }

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'document.download',
      target: `document:${doc.id}`,
    });
    return this.storage.presignDownload(doc.fileKey, doc.title);
  }

  /** Soft-delete a document (HR/Admin). The S3 object is retained (compliance retention). */
  async softDelete(documentId: string, actor: AuthenticatedUser): Promise<{ id: string }> {
    const doc = await this.getActiveOrThrow(documentId);
    await this.db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, documentId));

    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'document.delete',
      target: `document:${doc.id}`,
      before: { id: doc.id, employeeId: doc.employeeId, type: doc.type },
    });
    return { id: doc.id };
  }

  // ── internals ──

  private async getActiveOrThrow(id: string): Promise<Document> {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Document not found', HttpStatus.NOT_FOUND);
    return row;
  }

  /** HR/Admin, the owning employee, or a manager (direct/indirect) may access an employee's docs. */
  private async assertCanAccessEmployeeDocs(
    employeeId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (isAdminOrAbove(actor)) return;
    if (actor.id === employeeId) return;
    if (await this.employeesService.isManagerOf(actor.id, employeeId)) return;
    throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to access these documents', HttpStatus.FORBIDDEN);
  }
}
