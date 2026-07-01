import { Inject, Injectable } from '@nestjs/common';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SendMessageCommandOutput,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { SQS_CLIENT } from '../common/constants';

/** A received SQS message with its JSON body already parsed. */
export interface ReceivedMessage {
  messageId: string;
  receiptHandle: string;
  body: unknown;
}

export interface ReceiveOptions {
  maxMessages?: number;
  /** Long-poll wait time (seconds). */
  waitSeconds?: number;
  /** How long a received message stays invisible to other consumers (seconds). */
  visibilitySeconds?: number;
}

export interface SendMessageOptions {
  /** FIFO queues: messages with the same group id are processed in order (per-entity
   *  serialization — CLAUDE.md §8). */
  messageGroupId?: string;
  /** FIFO queues: explicit dedup id (otherwise content-based dedup must be enabled). */
  messageDeduplicationId?: string;
  /** Standard queues: delay delivery, in seconds. */
  delaySeconds?: number;
}

/**
 * Thin wrapper over the SQS client. Producers should publish through the outbox relay, not
 * call this directly in the same transaction as a state change (CLAUDE.md §8). Consumers live
 * in src/workers and must be idempotent (SQS is at-least-once).
 */
@Injectable()
export class SqsService {
  constructor(@Inject(SQS_CLIENT) private readonly client: SQSClient) {}

  async send(
    queueUrl: string,
    body: unknown,
    options: SendMessageOptions = {},
  ): Promise<SendMessageCommandOutput> {
    return this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(body),
        MessageGroupId: options.messageGroupId,
        MessageDeduplicationId: options.messageDeduplicationId,
        DelaySeconds: options.delaySeconds,
      }),
    );
  }

  /** Long-poll a queue. Returns messages with their JSON body parsed; never throws on an empty poll. */
  async receive(queueUrl: string, options: ReceiveOptions = {}): Promise<ReceivedMessage[]> {
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: options.maxMessages ?? 10,
        WaitTimeSeconds: options.waitSeconds ?? 20,
        VisibilityTimeout: options.visibilitySeconds ?? 60,
      }),
    );
    return (res.Messages ?? []).flatMap((m) => {
      if (!m.MessageId || !m.ReceiptHandle) return [];
      let body: unknown;
      try {
        body = m.Body ? JSON.parse(m.Body) : null;
      } catch {
        body = m.Body ?? null;
      }
      return [{ messageId: m.MessageId, receiptHandle: m.ReceiptHandle, body }];
    });
  }

  /** Delete (ack) a successfully-processed message. */
  async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
    await this.client.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
  }
}
