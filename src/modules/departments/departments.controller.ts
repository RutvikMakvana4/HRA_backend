import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '../auth/roles';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

/** Departments (PRD §4.1) — readable by all authenticated users; writable by HR/Admin only. */
@ApiTags('departments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  list() {
    return this.departments.list();
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.departments.getOrThrow(id);
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.departments.create(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.departments.update(id, dto, actor);
  }

  @Delete(':id')
  @Roles([...ADMIN_ROLES])
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.departments.remove(id, actor);
  }
}
