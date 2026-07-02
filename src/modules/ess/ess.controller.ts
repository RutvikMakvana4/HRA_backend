import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { EssService } from './ess.service';

/**
 * Module 4 — Employee Self-Service (PRD §7). Aggregation endpoints that tie the other modules
 * together for the ESS dashboard. Every route is scoped to the authenticated caller.
 */
@ApiTags('ess')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('me')
export class MeController {
  constructor(private readonly ess: EssService) {}

  @Get()
  me(@CurrentUser() actor: AuthenticatedUser) {
    return this.ess.me(actor);
  }

  @Get('dashboard')
  dashboard(@CurrentUser() actor: AuthenticatedUser) {
    return this.ess.dashboard(actor);
  }
}

@ApiTags('ess')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly ess: EssService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.ess.listNotifications(actor);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.ess.markNotificationRead(id, actor);
  }
}

@ApiTags('ess')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly ess: EssService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.ess.auditLog(actor);
  }
}
