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
import { AssetsService } from './assets.service';
import {
  AssignAssetDto,
  CreateAssetCategoryDto,
  CreateAssetDto,
  ExpiringLicensesDto,
  ListAssetsDto,
  ReturnAssetDto,
  UpdateAssetCategoryDto,
  UpdateAssetDto,
} from './dto/assets.dto';

/** Asset Manager / IT scope (PRD §2, §5) — org-wide asset custody, gated to HR/Admin. */
const ASSET_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

@ApiTags('assets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('asset-categories')
export class AssetCategoriesController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @Roles([...ASSET_ROLES])
  list() {
    return this.assets.listCategories();
  }

  @Post()
  @Roles([...ASSET_ROLES])
  create(@Body() dto: CreateAssetCategoryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assets.createCategory(dto, actor);
  }

  @Patch(':id')
  @Roles([...ASSET_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetCategoryDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assets.updateCategory(id, dto, actor);
  }
}

@ApiTags('assets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  @Roles([...ASSET_ROLES])
  list(@Query() query: ListAssetsDto) {
    return this.assets.listAssets(query);
  }

  @Get(':id')
  @Roles([...ASSET_ROLES])
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.getAsset(id);
  }

  @Get(':id/history')
  @Roles([...ASSET_ROLES])
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.assetHistory(id);
  }

  @Post()
  @Roles([...ASSET_ROLES])
  create(@Body() dto: CreateAssetDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.assets.createAsset(dto, actor);
  }

  @Patch(':id')
  @Roles([...ASSET_ROLES])
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assets.updateAsset(id, dto, actor);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.CREATED)
  @Roles([...ASSET_ROLES])
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignAssetDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assets.assignAsset(id, dto, actor);
  }

  @Post(':id/return')
  @HttpCode(HttpStatus.OK)
  @Roles([...ASSET_ROLES])
  return(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnAssetDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.assets.returnAsset(id, dto, actor);
  }
}

@ApiTags('assets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('licenses')
export class LicensesController {
  constructor(private readonly assets: AssetsService) {}

  @Get('expiring')
  @Roles([...ASSET_ROLES])
  expiring(@Query() query: ExpiringLicensesDto) {
    return this.assets.expiringLicenses(query);
  }
}

@ApiTags('assets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employees')
export class EmployeeAssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get(':id/assets')
  @Roles([...ASSET_ROLES])
  employeeAssets(@Param('id', ParseUUIDPipe) id: string) {
    return this.assets.employeeAssets(id);
  }
}

@ApiTags('assets')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('me')
export class MyAssetsController {
  constructor(private readonly assets: AssetsService) {}

  // Any authenticated employee sees the assets currently assigned to them.
  @Get('assets')
  myAssets(@CurrentUser() actor: AuthenticatedUser) {
    return this.assets.myAssets(actor);
  }
}
