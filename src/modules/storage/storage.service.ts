import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../common/config/app-config.service';
import { S3_CLIENT } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';

/** Default lifetime for signed URLs (PRD §8.1 — short-lived, expiring links only). */
const DEFAULT_URL_TTL_SECONDS = 300;

/**
 * StorageService — the document vault gateway (PRD §4.1). Objects are NEVER public; callers upload
 * and download only through short-lived signed URLs. The DB stores the object key; bytes live in S3.
 */
@Injectable()
export class StorageService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    private readonly config: AppConfigService,
  ) {}

  /** Build a namespaced object key for an employee document. */
  buildDocumentKey(employeeId: string, filename: string): string {
    const safe = filename.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'file';
    return `employees/${employeeId}/documents/${randomUUID()}-${safe}`;
  }

  /** Signed URL the client uses to PUT bytes directly to S3. */
  async presignUpload(
    key: string,
    contentType: string,
    ttlSeconds = DEFAULT_URL_TTL_SECONDS,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket(),
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.s3, command, { expiresIn: ttlSeconds });
  }

  /** Signed URL to download an object, optionally forcing a download filename. */
  async presignDownload(
    key: string,
    downloadFilename?: string,
    ttlSeconds = DEFAULT_URL_TTL_SECONDS,
  ): Promise<{ url: string; expiresIn: number }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket(),
      Key: key,
      ResponseContentDisposition: downloadFilename
        ? `attachment; filename="${downloadFilename.replace(/"/g, '')}"`
        : undefined,
    });
    const url = await getSignedUrl(this.s3, command, { expiresIn: ttlSeconds });
    return { url, expiresIn: ttlSeconds };
  }

  /** Permanently remove an object. Document deletes are soft in the DB, so use sparingly. */
  async deleteObject(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }));
  }

  private bucket(): string {
    const bucket = this.config.get('S3_BUCKET');
    if (!bucket) {
      throw new AppError(
        ErrorCode.NOT_IMPLEMENTED,
        'Document storage is not configured (S3_BUCKET unset)',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return bucket;
  }
}
