import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '../auth/roles';
import { ProjectsService } from './projects.service';
import { TimesheetsService } from './timesheets.service';
import { UpdatesService } from './updates.service';
import {
  AllocationReportDto,
  CreateAllocationDto,
  CreateClientDto,
  CreateCommentDto,
  CreateMilestoneDto,
  CreateProjectDto,
  CreateTaskDto,
  DecideWeekDto,
  GetWeekDto,
  ListAllocationsDto,
  ListProjectsDto,
  ListTasksDto,
  ListUpdatesDto,
  ListWeeksDto,
  MissingUpdatesDto,
  SaveWeekDto,
  UpdateClientDto,
  UpdateEntryDto,
  UpdateMilestoneDto,
  UpdateProgressDto,
  UpdateProjectDto,
  UpdateTaskDto,
  UpsertEntryDto,
  UtilizationReportDto,
} from './dto/timesheets.dto';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

@ApiTags('clients')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('clients')
export class ClientsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list() {
    return this.projects.listClients();
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateClientDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.projects.createClient(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.projects.updateClient(id, dto, actor);
  }
}

@ApiTags('projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly updates: UpdatesService,
  ) {}

  @Get()
  list(@Query() query: ListProjectsDto) {
    return this.projects.listProjects(query);
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateProjectDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.projects.createProject(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.projects.updateProject(id, dto, actor);
  }

  @Get(':id/summary')
  summary(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.projects.projectSummary(id, actor);
  }

  @Get(':id/allocations')
  listAllocations(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.projects.listAllocations(id, actor);
  }

  @Post(':id/allocations')
  createAllocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAllocationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.projects.createAllocation(id, dto, actor);
  }

  @Get(':id/milestones')
  listMilestones(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.projects.listMilestones(id, actor);
  }

  @Post(':id/milestones')
  createMilestone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.projects.createMilestone(id, dto, actor);
  }

  @Get(':id/tasks')
  listTasks(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListTasksDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.projects.listTasks(id, query, actor);
  }

  @Post(':id/tasks')
  createTask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTaskDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.projects.createTask(id, dto, actor);
  }

  @Patch(':id/progress')
  updateProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProgressDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.projects.updateProgress(id, dto, actor);
  }

  @Get(':id/updates')
  listUpdates(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListUpdatesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.updates.listProjectUpdates(id, query, actor);
  }

  @Get(':id/updates/missing')
  missingUpdates(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MissingUpdatesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.updates.missingUpdates(id, query, actor);
  }
}

@ApiTags('projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('allocations')
export class AllocationsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  listMine(@Query() query: ListAllocationsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.projects.listMyAllocations(query, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.projects.removeAllocation(id, actor);
  }
}

@ApiTags('projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('milestones')
export class MilestonesController {
  constructor(private readonly projects: ProjectsService) {}

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMilestoneDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.projects.updateMilestone(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.projects.deleteMilestone(id, actor);
  }
}

@ApiTags('projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly projects: ProjectsService) {}

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.projects.updateTask(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.projects.deleteTask(id, actor);
  }
}

@ApiTags('timesheets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('timesheets')
export class TimesheetsController {
  constructor(private readonly timesheets: TimesheetsService) {}

  @Get('weeks')
  listWeeks(@Query() query: ListWeeksDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.timesheets.listWeeks(query, actor);
  }

  @Get('week')
  getWeek(@Query() query: GetWeekDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.timesheets.getWeek(query, actor);
  }

  @Post('entries')
  upsertEntry(@Body() dto: UpsertEntryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.timesheets.upsertEntry(dto, actor);
  }

  @Post('week')
  @HttpCode(HttpStatus.OK)
  saveWeek(@Body() dto: SaveWeekDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.timesheets.saveWeek(dto, actor);
  }

  @Patch('entries/:id')
  updateEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEntryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.timesheets.updateEntry(id, dto, actor);
  }

  @Delete('entries/:id')
  @HttpCode(HttpStatus.OK)
  deleteEntry(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.timesheets.deleteEntry(id, actor);
  }

  @Post('week/:id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.timesheets.submitWeek(id, actor);
  }

  @Post('week/:id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideWeekDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.timesheets.approveWeek(id, dto.note, actor);
  }

  @Post('week/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideWeekDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.timesheets.rejectWeek(id, dto.note, actor);
  }
}

@ApiTags('reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly timesheets: TimesheetsService,
    private readonly projects: ProjectsService,
  ) {}

  @Get('utilization')
  utilization(@Query() query: UtilizationReportDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.timesheets.utilizationReport(query, actor);
  }

  @Get('allocation')
  allocation(@Query() query: AllocationReportDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.projects.allocationReport(query, actor);
  }
}

/**
 * The actor's own daily updates — no membership check, deliberately (see UpdatesService). Shares
 * the `me` path prefix with ess's MeController and assets' MyAssetsController; the route segments
 * don't collide.
 */
@ApiTags('projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('me')
export class MeUpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  @Get('updates')
  listMyUpdates(@Query() query: ListUpdatesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.updates.listMyUpdates(query, actor);
  }
}

/**
 * The actor's own active projects with a summary block each. Shares the `me` path prefix with
 * MeUpdatesController, ess's MeController and assets' MyAssetsController; the route segments
 * don't collide.
 */
@ApiTags('projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('me')
export class MeProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('projects')
  myProjects(@CurrentUser() actor: AuthenticatedUser) {
    return this.projects.myProjects(actor);
  }
}

@ApiTags('projects')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('updates')
export class UpdatesController {
  constructor(private readonly updates: UpdatesService) {}

  @Get(':entryId/comments')
  listComments(@Param('entryId', ParseUUIDPipe) entryId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.updates.listComments(entryId, actor);
  }

  @Post(':entryId/comments')
  addComment(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.updates.addComment(entryId, dto, actor);
  }
}
