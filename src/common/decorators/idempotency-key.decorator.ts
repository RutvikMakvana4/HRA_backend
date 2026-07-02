import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError, ErrorCode } from '../errors/app-error';
import { HttpStatus } from '@nestjs/common';

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
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
