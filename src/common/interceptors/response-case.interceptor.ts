import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { toSnakeCase } from '../util/case';

/**
 * Serialises every JSON response body to snake_case so it matches the ESS frontend contract
 * (`employee_id`, `leave_type_id`, …). Registered as the OUTERMOST interceptor so the mapping runs
 * last, after the audit interceptor has already recorded the (camelCase) post-state.
 */
@Injectable()
export class ResponseCaseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((body) => toSnakeCase(body)));
  }
}
