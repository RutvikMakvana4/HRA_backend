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

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

/**
 * RBAC administration (PRD §2). HR/Admin handles day-to-day onboarding (create accounts, reset
 * passwords — limited to employee/manager targets, enforced in the service). Role/status changes
 * and the audit log stay Super Admin only.
 */
@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@SkipAudit() // service writes richer semantic audit rows (admin.user.*)
@Controller('admin')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly auditLogs: AuditQueryService,
  ) {}

  @Post('users')
  @Roles([...ADMIN_ROLES])
  createAccount(@Body() dto: CreateUserAccountDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.createAccount(dto, actor);
  }

  @Get('users')
  @Roles([...ADMIN_ROLES])
  listAccounts() {
    return this.users.list();
  }

  @Patch('users/:id/role')
  @Roles([Role.SUPER_ADMIN])
  setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.setRole(id, dto, actor);
  }

  @Patch('users/:id/status')
  @Roles([Role.SUPER_ADMIN])
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.setStatus(id, dto, actor);
  }

  @Post('users/:id/reset-password')
  @Roles([...ADMIN_ROLES])
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.resetPassword(id, dto, actor);
  }

  @Get('audit-logs')
  @Roles([Role.SUPER_ADMIN])
  listAuditLogs(@Query() query: ListAuditLogsDto) {
    return this.auditLogs.list(query);
  }
}
