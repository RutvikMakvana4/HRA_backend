import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { toCamelCase } from '../util/case';

/**
 * Rewrites JSON request bodies from the frontend's snake_case into the camelCase our Zod DTOs and
 * services expect. Runs before the validation pipe. Only touches parsed JSON object/array bodies;
 * multipart/stream bodies (e.g. document uploads) are left untouched.
 */
@Injectable()
export class BodyCaseMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const body: unknown = req.body;
    if (body && typeof body === 'object' && (Array.isArray(body) || isPlainRecord(body))) {
      req.body = toCamelCase(body);
    }
    next();
  }
}

function isPlainRecord(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}
