import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { EmployeesService } from '../employees/employees.service';
import { ChangePasswordDto, LoginDto, RefreshDto } from './dto/auth.dto';

/** Authentication (PRD Phase 1). Login/refresh are public; the rest need a valid session. */
@ApiTags('auth')
@UseGuards(JwtAuthGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly employees: EmployeesService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    return this.auth.login(dto, { ip, userAgent: ua });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    return this.auth.refresh(dto.refreshToken, { ip, userAgent: ua });
  }

  @ApiBearerAuth('access-token')
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() actor: AuthenticatedUser) {
    return this.auth.logout(actor);
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
}
