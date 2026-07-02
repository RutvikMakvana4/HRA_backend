import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { SkipAudit } from '../../common/decorators/audit.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Role } from './roles';
import { AdminUsersService } from './admin-users.service';
import { AuditQueryService } from './audit-query.service';
import {
  CreateUserAccountDto,
  ListAuditLogsDto,
  ResetPasswordDto,
  SetRoleDto,
  SetStatusDto,
} from './dto/admin-users.dto';

/**
 * RBAC administration (PRD §2 — Super Admin only): manage login accounts, roles, status, and read
 * the audit log.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles([Role.SUPER_ADMIN])
@SkipAudit() // service writes richer semantic audit rows (admin.user.*)
@Controller('admin')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly auditLogs: AuditQueryService,
  ) {}

  @Post('users')
  createAccount(@Body() dto: CreateUserAccountDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.createAccount(dto, actor);
  }

  @Get('users')
  listAccounts() {
    return this.users.list();
  }

  @Patch('users/:id/role')
  setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.setRole(id, dto, actor);
  }

  @Patch('users/:id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.setStatus(id, dto, actor);
  }

  @Post('users/:id/reset-password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.resetPassword(id, dto, actor);
  }

  @Get('audit-logs')
  listAuditLogs(@Query() query: ListAuditLogsDto) {
    return this.auditLogs.list(query);
  }
}
