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
import { ExpensesService } from './expenses.service';
import {
  AddLineItemDto,
  CreateCategoryDto,
  CreateClaimDto,
  DecideClaimDto,
  ListClaimsDto,
  ReimburseClaimDto,
  SpendOverviewDto,
  UpdateCategoryDto,
  UpdateClaimDto,
  UpdateLineItemDto,
} from './dto/expenses.dto';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

@ApiTags('expenses')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list() {
    return this.expenses.listCategories();
  }

  @Post()
  @Roles([...ADMIN_ROLES])
  create(@Body() dto: CreateCategoryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenses.createCategory(dto, actor);
  }

  @Patch(':id')
  @Roles([...ADMIN_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.expenses.updateCategory(id, dto, actor);
  }
}

@ApiTags('expenses')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('expense-claims')
export class ExpenseClaimsController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  list(@Query() query: ListClaimsDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenses.listClaims(query, actor);
  }

  @Post()
  create(@Body() dto: CreateClaimDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenses.createClaim(dto, actor);
  }

  @Get('spend-overview')
  spendOverview(@Query() query: SpendOverviewDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenses.spendOverview(query, actor);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenses.getClaim(id, actor);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClaimDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.expenses.updateClaim(id, dto, actor);
  }

  @Post(':id/line-items')
  addLineItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddLineItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.expenses.addLineItem(id, dto, actor);
  }

  @Patch(':id/line-items/:itemId')
  updateLineItem(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateLineItemDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.expenses.updateLineItem(itemId, dto, actor);
  }

  @Delete(':id/line-items/:itemId')
  @HttpCode(HttpStatus.OK)
  deleteLineItem(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.expenses.deleteLineItem(itemId, actor);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenses.submitClaim(id, actor);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideClaimDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.expenses.approveClaim(id, dto.note, actor);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideClaimDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.expenses.rejectClaim(id, dto.note, actor);
  }

  @Post(':id/reimburse')
  @HttpCode(HttpStatus.OK)
  reimburse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReimburseClaimDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.expenses.reimburseClaim(id, dto.reimbursementRef, dto.note, actor);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.expenses.cancelClaim(id, actor);
  }
}
