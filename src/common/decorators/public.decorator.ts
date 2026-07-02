import { Reflector } from '@nestjs/core';

/** Mark a route as public — {@link JwtAuthGuard} skips authentication for it. */
export const Public = Reflector.createDecorator<boolean>({ transform: (value) => value ?? true });
