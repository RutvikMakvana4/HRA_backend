import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import type { Request } from 'express';
import { AppConfigService } from '../../common/config/app-config.service';
import { REDIS } from '../../common/constants';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { sessionKey } from './session.service';

/** Claims on the access token issued by {@link TokenService}. */
interface AccessTokenClaims {
  sub: string;
  uid: string;
  roles?: string[];
  /** Optional: tokens signed before this claim existed carry no permissions. */
  permissions?: string[];
  sid: string;
  type?: 'user' | 'admin';
}

/**
 * Authenticates from a `Bearer` access token (HS256, `JWT_ACCESS_SECRET`) AND confirms the
 * session is still live via the Redis `session:<sid>` flag — so logout / forced revocation take
 * effect immediately even before the short-lived access token expires. Skips `@Public()` routes.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride(Public, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Session must still be live (revoked on logout / disable / password change).
    if (!claims.sid || (await this.redis.exists(sessionKey(claims.sid))) === 0) {
      throw new UnauthorizedException('Session expired');
    }

    request.user = {
      id: claims.sub,
      uid: claims.uid,
      roles: claims.roles ?? [],
      // `?? []` is load-bearing, not defensive. Every access token signed before the `permissions`
      // claim existed is still valid and still in circulation; without this fallback
      // `claims.permissions` is undefined and the first `actor.permissions.includes(...)` throws,
      // breaking every signed-in user until their token expires. An old token simply carries no
      // permissions — which is correct — so the deploy forces nobody to log in again.
      permissions: claims.permissions ?? [],
      scope: null,
      sid: claims.sid,
      type: claims.type ?? 'user',
    };
    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
