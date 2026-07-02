import { Global, Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { AppConfigService } from '../../common/config/app-config.service';
import { S3_CLIENT } from '../../common/constants';
import { StorageService } from './storage.service';

/**
 * Storage module — provides the shared S3 client (via the `S3_CLIENT` token) and the
 * {@link StorageService} used by the document vault. Global so any module can presign URLs.
 *
 * `S3_ENDPOINT` is set only for LocalStack / custom endpoints (forces path-style addressing);
 * left blank for real AWS. Credentials/region reuse the AWS_* config already validated at boot.
 */
@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): S3Client => {
        const endpoint = config.get('S3_ENDPOINT');
        return new S3Client({
          region: config.get('AWS_REGION'),
          credentials: {
            accessKeyId: config.get('AWS_ACCESS_KEY_ID'),
            secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY'),
          },
          ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
        });
      },
    },
    StorageService,
  ],
  exports: [StorageService, S3_CLIENT],
})
export class StorageModule {}
