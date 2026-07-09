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
import { PerformanceService } from './performance.service';
import {
  AssignPeerDto,
  CreateCycleDto,
  CreateFeedbackDto,
  CreateGoalDto,
  CreateOneOnOneDto,
  CreateTemplateDto,
  ListFeedbackDto,
  ListGoalsDto,
  ListOneOnOnesDto,
  ListReviewsDto,
  SubmitReviewDto,
  UpdateCycleDto,
  UpdateGoalDto,
  UpdateOneOnOneDto,
  UpdateReviewDto,
  UpdateTemplateDto,
} from './dto/performance.dto';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

@ApiTags('performance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('review-cycles')
export class ReviewCyclesController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  @Roles([...ADMIN_ROLES])
  list() {
    return this.performance.listCycles();
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateCycleDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.createCycle(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCycleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.performance.updateCycle(id, dto, actor);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @Roles([...ADMIN_ROLES])
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.activateCycle(id, actor);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @Roles([...ADMIN_ROLES])
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.closeCycle(id, actor);
  }

  @Post(':id/peers')
  @Roles([Role.MANAGER, ...ADMIN_ROLES])
  assignPeer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPeerDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.performance.assignPeer(id, dto, actor);
  }
}

@ApiTags('performance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('review-templates')
export class ReviewTemplatesController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  @Roles([Role.MANAGER, ...ADMIN_ROLES])
  list() {
    return this.performance.listTemplates();
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateTemplateDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.createTemplate(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.performance.updateTemplate(id, dto, actor);
  }
}

@ApiTags('performance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('goals')
export class GoalsController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  list(@Query() query: ListGoalsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.listGoals(query, actor);
  }

  @Post()
  create(@Body() dto: CreateGoalDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.createGoal(dto, actor);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoalDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.performance.updateGoal(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.deleteGoal(id, actor);
  }
}

@ApiTags('performance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  list(@Query() query: ListReviewsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.listReviews(query, actor);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.getReview(id, actor);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReviewDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.performance.updateReview(id, dto, actor);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitReviewDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.performance.submitReview(id, dto, actor);
  }
}

@ApiTags('performance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('one-on-ones')
export class OneOnOnesController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  list(@Query() query: ListOneOnOnesDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.listOneOnOnes(query, actor);
  }

  @Post()
  create(@Body() dto: CreateOneOnOneDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.createOneOnOne(dto, actor);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOneOnOneDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.performance.updateOneOnOne(id, dto, actor);
  }
}

@ApiTags('performance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly performance: PerformanceService) {}

  @Get()
  list(@Query() query: ListFeedbackDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.listFeedback(query, actor);
  }

  @Post()
  create(@Body() dto: CreateFeedbackDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.performance.createFeedback(dto, actor);
  }
}
