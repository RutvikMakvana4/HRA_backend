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
import { RecruitmentService } from './recruitment.service';
import {
  CreateApplicationDto,
  CreateCandidateDto,
  CreateInterviewDto,
  CreateJobOpeningDto,
  CreateOfferDto,
  CreateStageDto,
  HireApplicationDto,
  ListApplicationsDto,
  ListCandidatesDto,
  ListInterviewsDto,
  ListJobOpeningsDto,
  MoveApplicationDto,
  RejectApplicationDto,
  SetResumeDto,
  SubmitScorecardDto,
  UpdateCandidateDto,
  UpdateInterviewDto,
  UpdateJobOpeningDto,
  UpdateOfferDto,
  UpdateStageDto,
} from './dto/recruitment.dto';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;
/** Recruiter/Hiring-Manager read scope (PRD §4) — managers and HR/Admin. */
const RECRUITER_ROLES = [Role.MANAGER, ...ADMIN_ROLES] as const;

@ApiTags('recruitment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pipeline-stages')
export class PipelineStagesController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Get()
  @Roles([...RECRUITER_ROLES])
  list() {
    return this.recruitment.listStages();
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateStageDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.recruitment.createStage(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStageDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.recruitment.updateStage(id, dto, actor);
  }
}

@ApiTags('recruitment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('job-openings')
export class JobOpeningsController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Get()
  @Roles([...RECRUITER_ROLES])
  list(@Query() query: ListJobOpeningsDto) {
    return this.recruitment.listJobOpenings(query);
  }

  @Get(':id')
  @Roles([...RECRUITER_ROLES])
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruitment.getJobOpening(id);
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateJobOpeningDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.recruitment.createJobOpening(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobOpeningDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.recruitment.updateJobOpening(id, dto, actor);
  }
}

@ApiTags('recruitment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Get()
  @Roles([...RECRUITER_ROLES])
  list(@Query() query: ListCandidatesDto) {
    return this.recruitment.listCandidates(query);
  }

  @Get(':id')
  @Roles([...RECRUITER_ROLES])
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruitment.getCandidate(id);
  }

  // No @Roles: any authenticated employee may submit a referral (source auto-tagged in the service).
  @Post()
  create(@Body() dto: CreateCandidateDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.recruitment.createCandidate(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCandidateDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.recruitment.updateCandidate(id, dto, actor);
  }

  // No @Roles: the service enforces referrer-or-recruiter (a referral's own referrer may attach it).
  @Patch(':id/resume')
  setResume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetResumeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.recruitment.setCandidateResume(id, dto.documentId, actor);
  }
}

@ApiTags('recruitment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Get()
  @Roles([...RECRUITER_ROLES])
  list(@Query() query: ListApplicationsDto) {
    return this.recruitment.listApplications(query);
  }

  @Get(':id')
  @Roles([...RECRUITER_ROLES])
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruitment.getApplication(id);
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateApplicationDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.recruitment.createApplication(dto, actor);
  }

  @Patch(':id/move')
  @Roles([...ADMIN_ROLES])
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveApplicationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.recruitment.moveApplication(id, dto, actor);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Roles([...ADMIN_ROLES])
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectApplicationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.recruitment.rejectApplication(id, dto, actor);
  }

  @Post(':id/hire')
  @HttpCode(HttpStatus.OK)
  @Roles([...ADMIN_ROLES])
  hire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HireApplicationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.recruitment.hireApplication(id, dto, actor);
  }
}

@ApiTags('recruitment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('interviews')
export class InterviewsController {
  constructor(private readonly recruitment: RecruitmentService) {}

  // Any authenticated user; the service scopes non-recruiters to their own interviews.
  @Get()
  list(@Query() query: ListInterviewsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.recruitment.listInterviews(query, actor);
  }

  @Get(':id/scorecards')
  @Roles([...RECRUITER_ROLES])
  scorecards(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruitment.listScorecards(id);
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateInterviewDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.recruitment.createInterview(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInterviewDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.recruitment.updateInterview(id, dto, actor);
  }

  // Any authenticated user; the service enforces "assigned interviewer only".
  @Post(':id/scorecard')
  @HttpCode(HttpStatus.CREATED)
  scorecard(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitScorecardDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.recruitment.submitScorecard(id, dto, actor);
  }
}

@ApiTags('recruitment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('offers')
export class OffersController {
  constructor(private readonly recruitment: RecruitmentService) {}

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateOfferDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.recruitment.createOffer(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfferDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.recruitment.updateOffer(id, dto, actor);
  }
}
