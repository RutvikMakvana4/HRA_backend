import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/client';
import { employees, userAccounts, type UserAccount } from '../../db/schema';
import { DRIZZLE, REDIS } from '../../common/constants';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { actorTypeForRole, type Role } from './roles';
import type { ChangePasswordDto, LoginDto } from './dto/auth.dto';

/** Login rate limit: attempts allowed per email+ip within the window. */
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: { employeeId: string; accountId: string; role: Role; mustChangePassword: boolean };
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  /** Authenticate by work email + password and start a session. */
  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthTokens> {
    await this.enforceLoginRateLimit(dto.email, meta.ip ?? 'unknown');

    const found = await this.db
      .select({ account: userAccounts, employeeStatus: employees.status })
      .from(userAccounts)
      .innerJoin(employees, eq(userAccounts.employeeId, employees.id))
      .where(eq(employees.workEmail, dto.email))
      .limit(1);

    const record = found[0];
    // Verify a hash even when the account is missing to keep timing uniform.
    const hash = record?.account.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$invalidinvalidinvalid$invalidinvalidinvalidinvalidinvalidinvalid';
    const ok = await this.passwords.verify(hash, dto.password);

    if (!record || !ok) throw this.invalidCredentials();
    if (record.account.status !== 'active') {
      throw new AppError(ErrorCode.FORBIDDEN, 'Account is disabled', HttpStatus.FORBIDDEN);
    }
    if (record.employeeStatus === 'exited' || record.employeeStatus === 'suspended') {
      throw new AppError(ErrorCode.FORBIDDEN, 'Employee is not active', HttpStatus.FORBIDDEN);
    }

    const tokens = await this.startSession(record.account, meta);
    await this.db
      .update(userAccounts)
      .set({ lastLoginAt: new Date() })
      .where(eq(userAccounts.id, record.account.id));
    await this.audit.record({
      actorType: actorTypeForRole(record.account.role),
      actorId: record.account.employeeId,
      action: 'auth.login',
      target: `user_account:${record.account.id}`,
      ip: meta.ip ?? undefined,
      userAgent: meta.userAgent ?? undefined,
    });
    return tokens;
  }

  /** Rotate a refresh token: validate, revoke the old session, issue a fresh pair. */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthTokens> {
    const parsed = this.tokens.parseRefreshToken(refreshToken);
    if (!parsed) throw this.invalidRefresh();

    const session = await this.sessions.find(parsed.sid);
    if (!session) throw this.invalidRefresh();

    // Reuse of an already-rotated/revoked session → treat as compromise, kill all sessions.
    if (session.revokedAt) {
      await this.sessions.revokeAllForUser(session.userId);
      throw this.invalidRefresh();
    }
    if (session.expiresAt.getTime() <= Date.now()) throw this.invalidRefresh();
    if (this.tokens.hashRefreshSecret(parsed.secret) !== session.refreshTokenHash) {
      throw this.invalidRefresh();
    }

    const account = await this.loadAccount(session.userId);
    if (!account || account.status !== 'active') {
      await this.sessions.revoke(parsed.sid);
      throw this.invalidRefresh();
    }

    const tokens = await this.startSession(account, meta);
    await this.sessions.revoke(parsed.sid);
    return tokens;
  }

  /** End the caller's current session. */
  async logout(actor: AuthenticatedUser): Promise<{ success: true }> {
    await this.sessions.revoke(actor.sid);
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'auth.logout',
      target: `user_account:${actor.uid}`,
    });
    return { success: true };
  }

  /** Change the caller's password; revokes ALL of their sessions (forces re-login everywhere). */
  async changePassword(actor: AuthenticatedUser, dto: ChangePasswordDto): Promise<{ success: true }> {
    const account = await this.loadAccount(actor.uid);
    if (!account) throw new AppError(ErrorCode.NOT_FOUND, 'Account not found', HttpStatus.NOT_FOUND);
    if (!(await this.passwords.verify(account.passwordHash, dto.currentPassword))) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'Current password is incorrect', HttpStatus.UNAUTHORIZED);
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.db
      .update(userAccounts)
      // The chosen password is now the real one — clear the forced-change flag.
      .set({ passwordHash, mustChangePassword: false, updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(userAccounts.id, account.id));
    await this.sessions.revokeAllForUser(account.id);
    await this.audit.record({
      actorType: actor.type,
      actorId: actor.id,
      action: 'auth.change_password',
      target: `user_account:${account.id}`,
    });
    return { success: true };
  }

  // ── internals ──

  private async startSession(account: UserAccount, meta: RequestMeta): Promise<AuthTokens> {
    const sid = randomUUID();
    const refresh = this.tokens.createRefreshToken(sid);
    await this.sessions.open({
      sid,
      userId: account.id,
      refreshTokenHash: refresh.hash,
      ttlSeconds: this.tokens.refreshTtlSeconds,
      userAgent: meta.userAgent,
      ip: meta.ip,
    });
    const access = await this.tokens.issueAccessToken({
      employeeId: account.employeeId,
      accountId: account.id,
      role: account.role,
      permissions: account.permissions,
      sid,
    });
    return {
      accessToken: access.accessToken,
      refreshToken: refresh.token,
      tokenType: 'Bearer',
      expiresIn: access.expiresIn,
      user: {
        employeeId: account.employeeId,
        accountId: account.id,
        role: account.role,
        mustChangePassword: account.mustChangePassword,
      },
    };
  }

  /** Whether the account still holds an HR-issued temporary password. */
  async passwordChangeRequired(accountId: string): Promise<boolean> {
    const account = await this.loadAccount(accountId);
    return account?.mustChangePassword ?? false;
  }

  private loadAccount(id: string): Promise<UserAccount | undefined> {
    return this.db.query.userAccounts.findFirst({ where: eq(userAccounts.id, id) });
  }

  private async enforceLoginRateLimit(email: string, ip: string): Promise<void> {
    const key = `ratelimit:login:${email.toLowerCase()}:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, LOGIN_WINDOW_SECONDS);
    if (count > LOGIN_MAX_ATTEMPTS) {
      throw new AppError(
        ErrorCode.RATE_LIMITED,
        'Too many login attempts, try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private invalidCredentials(): AppError {
    return new AppError(ErrorCode.UNAUTHORIZED, 'Invalid email or password', HttpStatus.UNAUTHORIZED);
  }

  private invalidRefresh(): AppError {
    return new AppError(ErrorCode.UNAUTHORIZED, 'Invalid or expired refresh token', HttpStatus.UNAUTHORIZED);
  }
}
