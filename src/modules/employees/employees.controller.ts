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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '../auth/roles';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto, UpdateMyProfileDto } from './dto/employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees.query';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

/**
 * Employee Core API (PRD §4.1). All routes require a valid access token; write and org-wide read
 * routes additionally require HR/Admin. Self and manager-of access on single-record reads is
 * enforced inside the service.
 */
@ApiTags('employees')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.employees.create(dto, actor);
  }

  @Get()
  @Roles([...ADMIN_ROLES])
  list(@Query() query: ListEmployeesQueryDto) {
    return this.employees.list(query);
  }

  /** The caller's own profile (ESS). Declared before `:id` so it isn't captured as an id. */
  @Get('me')
  me(@CurrentUser() actor: AuthenticatedUser) {
    return this.employees.findByIdForViewer(actor.id, actor);
  }

  /** Self-service edit of the caller's own limited profile fields (ESS). */
  @Patch('me')
  updateMe(@Body() dto: UpdateMyProfileDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.employees.updateMyProfile(actor, dto);
  }

  @Get(':id')
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.employees.findByIdForViewer(id, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.employees.updateByHr(id, dto, actor);
  }

  @Post(':id/deactivate')
  @Roles([...ADMIN_ROLES])
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.employees.deactivate(id, actor);
  }
}
