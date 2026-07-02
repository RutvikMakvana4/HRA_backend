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
import { AttendanceService } from './attendance.service';
import {
  CheckInDto,
  CheckOutDto,
  DecideRegularizationDto,
  ListAttendanceDto,
  RegularizeDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

/**
 * Module 3 — Attendance (PRD §6). Specific segments (`check-in`, `regularize`) are declared before
 * the `:id` route so they are not swallowed as an id.
 */
@ApiTags('attendance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  list(@Query() query: ListAttendanceDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.attendance.list(query, actor);
  }

  @Post('check-in')
  @HttpCode(HttpStatus.OK)
  checkIn(@Body() dto: CheckInDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.attendance.checkIn(dto, actor);
  }

  @Post('check-out')
  @HttpCode(HttpStatus.OK)
  checkOut(@Body() dto: CheckOutDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.attendance.checkOut(dto, actor);
  }

  @Get('regularize')
  listRegularizations(@CurrentUser() actor: AuthenticatedUser) {
    return this.attendance.listRegularizations(actor);
  }

  @Post('regularize')
  regularize(@Body() dto: RegularizeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.attendance.regularize(dto, actor);
  }

  @Post('regularize/:id/decide')
  @HttpCode(HttpStatus.OK)
  decideRegularization(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideRegularizationDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attendance.decideRegularization(id, dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAttendanceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attendance.updateByHr(id, dto, actor);
  }
}
