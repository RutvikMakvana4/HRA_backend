import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AppConfigService } from '../../common/config/app-config.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService, type AuthTokens } from './auth.service';
import { EmployeesService } from '../employees/employees.service';
import { ChangePasswordDto, LoginDto, RefreshDto } from './dto/auth.dto';

/**
 * The refresh token never travels in a JSON body the browser can read: it lives in this
 * httpOnly cookie, scoped to /v1/auth so it is only sent to auth endpoints.
 */
const REFRESH_COOKIE = 'hra_refresh';

/** Authentication (PRD Phase 1). Login/refresh are public; the rest need a valid session. */
@ApiTags('auth')
@UseGuards(JwtAuthGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly employees: EmployeesService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') ua?: string,
  ) {
    const tokens = await this.auth.login(dto, { ip, userAgent: ua });
    return this.setRefreshCookie(res, tokens);
  }

  /** Rotates the session. The refresh token comes from the cookie; body kept for API clients. */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') ua?: string,
  ) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[REFRESH_COOKIE] ?? dto.refreshToken ?? '';
    const tokens = await this.auth.refresh(refreshToken, { ip, userAgent: ua });
    return this.setRefreshCookie(res, tokens);
  }

  @ApiBearerAuth('access-token')
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.logout(actor);
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    return result;
  }

  /** The current principal + their employee profile. */
  @ApiBearerAuth('access-token')
  @Get('me')
  async me(@CurrentUser() actor: AuthenticatedUser) {
    const profile = await this.employees.findByIdForViewer(actor.id, actor);
    return {
      id: actor.id,
      accountId: actor.uid,
      roles: actor.roles,
      profile,
    };
  }

  @ApiBearerAuth('access-token')
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.auth.changePassword(actor, dto);
  }

  // ── internals ──

  /** Move the refresh token out of the response body into the httpOnly cookie. */
  private setRefreshCookie(res: Response, tokens: AuthTokens): Omit<AuthTokens, 'refreshToken'> {
    const { refreshToken, ...body } = tokens;
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.config.get('JWT_REFRESH_TTL') * 1000,
    });
    return body;
  }

  private cookieOptions(): CookieOptions {
    const secure = this.config.isProduction;
    return {
      httpOnly: true,
      secure,
      // FE and API are cross-site in production, same-site on localhost.
      sameSite: secure ? 'none' : 'lax',
      path: '/v1/auth',
    };
  }
}
