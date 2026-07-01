import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from '../constants';
import { ErrorCode } from '../errors/app-error';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

/** HTTP status → stable error code. Keyed by numeric status to keep comparisons enum-free. */
const STATUS_CODE: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.NOT_IMPLEMENTED]: ErrorCode.NOT_IMPLEMENTED,
};

/**
 * Global exception filter. Maps EVERY error to the single envelope
 * `{ error: { code, message, requestId } }` (CLAUDE.md §4). Never leaks stack traces or
 * internal messages: unknown errors become a generic INTERNAL 500 and are logged server-side.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = String(request.headers[CORRELATION_ID_HEADER] ?? '');

    const { status, code, message } = this.normalize(exception);

    // 5xx are server faults — log the cause server-side (never sent to the client).
    if (status >= 500) {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }

    const body: ErrorEnvelope = { error: { code, message, requestId } };
    response.status(status).json(body);
  }

  private normalize(exception: unknown): { status: number; code: string; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      // AppError sets { code, message }; Nest built-ins set { message, error, statusCode }.
      if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>;
        const code = typeof obj.code === 'string' ? obj.code : this.codeForStatus(status);
        const rawMessage = obj.message ?? exception.message;
        const message = Array.isArray(rawMessage)
          ? rawMessage.map((m): string => String(m)).join('; ')
          : typeof rawMessage === 'string'
            ? rawMessage
            : exception.message;
        return { status, code, message };
      }
      return { status, code: this.codeForStatus(status), message: exception.message };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL,
      message: 'Internal server error',
    };
  }

  private codeForStatus(status: number): string {
    return STATUS_CODE[status] ?? ErrorCode.INTERNAL;
  }
}
