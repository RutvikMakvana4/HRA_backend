import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { AppConfigService } from '../../common/config/app-config.service';
import type { Role } from './roles';
import { actorTypeForRole } from './roles';

/** Everything a signed-in principal needs, minus the refresh token. */
export interface AccessTokenPayload {
  /** employee id */
  sub: string;
  /** user_accounts id */
  uid: string;
  roles: Role[];
  /**
   * Capability codes granted to this account. Optional on the way IN: tokens signed before this
   * claim existed are still in circulation and must keep working — see JwtAuthGuard.
   */
  permissions?: string[];
  sid: string;
  type: 'user' | 'admin';
}

export interface IssuedAccessToken {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

/**
 * Mints access tokens (short-lived HS256 JWT) and refresh tokens. Refresh tokens are opaque and
 * shaped `<sid>.<secret>` — the sid lets us look up the session in O(1); only the SHA-256 of the
 * secret is persisted, so a DB/Redis leak never yields a usable token.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async issueAccessToken(input: {
    employeeId: string;
    accountId: string;
    role: Role;
    permissions: string[];
    sid: string;
  }): Promise<IssuedAccessToken> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL');
    const payload: AccessTokenPayload = {
      sub: input.employeeId,
      uid: input.accountId,
      roles: [input.role],
      permissions: input.permissions,
      sid: input.sid,
      type: actorTypeForRole(input.role),
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn,
    });
    return { accessToken, expiresIn };
  }

  /** Generate a fresh refresh secret and the token string to hand back to the client. */
  createRefreshToken(sid: string): { token: string; secret: string; hash: string } {
    const secret = randomBytes(32).toString('base64url');
    return { token: `${sid}.${secret}`, secret, hash: this.hashRefreshSecret(secret) };
  }

  /** Split an incoming refresh token into its session id and secret. */
  parseRefreshToken(token: string): { sid: string; secret: string } | null {
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return null;
    return { sid: token.slice(0, dot), secret: token.slice(dot + 1) };
  }

  hashRefreshSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  /** Seconds until a refresh token / session expires. */
  get refreshTtlSeconds(): number {
    return this.config.get('JWT_REFRESH_TTL');
  }
}
