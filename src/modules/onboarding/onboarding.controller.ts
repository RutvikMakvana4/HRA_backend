import {
  Body,
  Controller,
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
import { OnboardingService } from './onboarding.service';
import {
  CancelCaseDto,
  CompleteTaskDto,
  CreateCaseDto,
  CreateTemplateDto,
  ListCasesDto,
  ListTasksDto,
  ListTemplatesDto,
  UpdateTaskDto,
  UpdateTemplateDto,
} from './dto/onboarding.dto';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

/**
 * Module 5 — Onboarding / Offboarding (PRD §3). Templates are HR-managed; cases spawn assignable,
 * trackable tasks. Task updates are open to the assignee (and HR), which is enforced in the service.
 */
@ApiTags('onboarding')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('checklist-templates')
export class ChecklistTemplatesController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @Roles([...ADMIN_ROLES])
  list(@Query() query: ListTemplatesDto) {
    return this.onboarding.listTemplates(query);
  }

  @Get(':id')
  @Roles([...ADMIN_ROLES])
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.getTemplate(id);
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateTemplateDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.onboarding.createTemplate(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.onboarding.updateTemplate(id, dto, actor);
  }
}

@ApiTags('onboarding')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lifecycle-cases')
export class LifecycleCasesController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  list(@Query() query: ListCasesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.onboarding.listCases(query, actor);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.onboarding.getCase(id, actor);
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateCaseDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.onboarding.createCase(dto, actor);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelCaseDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.onboarding.cancelCase(id, dto.note, actor);
  }
}

@ApiTags('onboarding')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('checklist-tasks')
export class ChecklistTasksController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  list(@Query() query: ListTasksDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.onboarding.listTasks(query, actor);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.onboarding.updateTask(id, dto, actor);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteTaskDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.onboarding.completeTask(id, dto, actor);
  }
}
