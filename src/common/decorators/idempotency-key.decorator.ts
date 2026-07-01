import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AppError, ErrorCode } from '../errors/app-error';
import { HttpStatus } from '@nestjs/common';

export const IdempotencyKey = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const key = request.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || key.trim() === '') {
      throw new AppError(
        ErrorCode.BAD_REQUEST,
        'Idempotency-Key header is required for this operation.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return key.trim();
  },
);
