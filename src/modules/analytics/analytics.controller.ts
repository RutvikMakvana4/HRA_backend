import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '../auth/roles';
import { AnalyticsService } from './analytics.service';
import {
  AttendanceAnalyticsDto,
  AttritionDto,
  ExportDto,
  HeadcountDto,
  LeaveAnalyticsDto,
  RecruitmentFunnelDto,
  UtilizationDto,
} from './dto/analytics.dto';

/** Org-wide (HR / Leadership) analytics — the aggregate, cross-employee views. */
const LEADERSHIP_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

/**
 * Module 11 — Analytics & Reporting (PRD §6). Read-only aggregation endpoints. Org-wide reports are
 * gated to HR/Leadership; the scoped reports (leave, attendance, utilization) are open to any
 * authenticated caller and the service narrows results to self / team / org by role.
 */
@ApiTags('analytics')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('headcount')
  @Roles([...LEADERSHIP_ROLES])
  headcount(@Query() query: HeadcountDto) {
    return this.analytics.headcount(query);
  }

  @Get('attrition')
  @Roles([...LEADERSHIP_ROLES])
  attrition(@Query() query: AttritionDto) {
    return this.analytics.attrition(query);
  }

  // Scoped: employees see self, managers see their team, HR/Leadership see org-wide.
  @Get('leave')
  leave(@Query() query: LeaveAnalyticsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analytics.leave(query, actor);
  }

  @Get('attendance')
  attendance(@Query() query: AttendanceAnalyticsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analytics.attendance(query, actor);
  }

  @Get('utilization')
  utilization(@Query() query: UtilizationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.analytics.utilization(query, actor);
  }

  @Get('recruitment-funnel')
  @Roles([...LEADERSHIP_ROLES])
  recruitmentFunnel(@Query() query: RecruitmentFunnelDto) {
    return this.analytics.recruitmentFunnel(query);
  }

  @Get('assets')
  @Roles([...LEADERSHIP_ROLES])
  assets() {
    return this.analytics.assets();
  }

  @Get('snapshots')
  @Roles([...LEADERSHIP_ROLES])
  snapshots(@Query('metric_key') metricKey?: string) {
    return this.analytics.listSnapshots(metricKey ?? 'headcount');
  }

  @Post('snapshots/capture')
  @HttpCode(HttpStatus.OK)
  @Roles([...LEADERSHIP_ROLES])
  capture() {
    return this.analytics.captureSnapshots();
  }

  /** CSV export (leadership). Streams text/csv directly, bypassing the snake_case response mapper. */
  @Get('export')
  @Roles([...LEADERSHIP_ROLES])
  async export(
    @Query() query: ExportDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const { filename, csv } = await this.analytics.exportCsv(query, actor);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
