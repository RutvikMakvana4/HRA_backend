import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { AppConfigService } from '../common/config/app-config.service';
import { SQS_CLIENT } from '../common/constants';
import { SqsService } from './sqs.service';

/**
 * Global SQS module. Provides the AWS SQS client via the `SQS_CLIENT` token and the
 * {@link SqsService} wrapper. Workers (CLAUDE.md §8) consume from these queues in a separate
 * process; producers publish via the outbox relay, never a bare "write DB then enqueue".
 */
@Global()
@Module({
  providers: [
    {
      provide: SQS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): SQSClient => {
        const endpoint = config.get('SQS_ENDPOINT');
        return new SQSClient({
          region: config.get('AWS_REGION'),
          credentials: {
            accessKeyId: config.get('AWS_ACCESS_KEY_ID'),
            secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY'),
          },
          // Set only for LocalStack / custom endpoints; undefined uses the real AWS endpoint.
          ...(endpoint ? { endpoint } : {}),
        });
      },
    },
    SqsService,
  ],
  exports: [SQS_CLIENT, SqsService],
})
export class SqsModule implements OnModuleDestroy {
  constructor(@Inject(SQS_CLIENT) private readonly client: SQSClient) {}

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
