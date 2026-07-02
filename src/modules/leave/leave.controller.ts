import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { LeaveService } from './leave.service';
import {
  ApplyLeaveDto,
  CreateHolidayDto,
  CreateLeaveTypeDto,
  DecideLeaveDto,
  ListHolidaysDto,
  ListLeaveRequestsDto,
} from './dto/leave.dto';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;
const LEAVE_ACTIONS = new Set(['approve', 'reject', 'cancel']);

@ApiTags('leave')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('leave-types')
export class LeaveTypesController {
  constructor(private readonly leave: LeaveService) {}

  @Get()
  list() {
    return this.leave.listLeaveTypes();
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateLeaveTypeDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.leave.createLeaveType(dto, actor);
  }
}

@ApiTags('leave')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('leave-requests')
export class LeaveRequestsController {
  constructor(private readonly leave: LeaveService) {}

  @Get()
  list(@Query() query: ListLeaveRequestsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.leave.listRequests(query.scope, actor);
  }

  @Post()
  apply(@Body() dto: ApplyLeaveDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.leave.apply(dto, actor);
  }

  /** Approve / reject / cancel — matches the frontend `POST /leave-requests/:id/:action`. */
  @Post(':id/:action')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body() dto: DecideLeaveDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!LEAVE_ACTIONS.has(action)) {
      throw new BadRequestException(`Unknown action "${action}"`);
    }
    return this.leave.decide(id, action as 'approve' | 'reject' | 'cancel', dto.note, actor);
  }
}

@ApiTags('leave')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('leave-balances')
export class LeaveBalancesController {
  constructor(private readonly leave: LeaveService) {}

  @Get()
  list(@Query('employee_id') employeeId: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.leave.listBalances(employeeId, actor);
  }
}

@ApiTags('leave')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly leave: LeaveService) {}

  @Get()
  list(@Query() query: ListHolidaysDto) {
    return this.leave.listHolidays(query);
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateHolidayDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.leave.createHoliday(dto, actor);
  }
}
