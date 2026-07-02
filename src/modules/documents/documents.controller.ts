import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '../auth/roles';
import { DocumentsService } from './documents.service';

const ADMIN_ROLES = [Role.ADMIN, Role.SUPER_ADMIN] as const;

/** Document-scoped operations (PRD §4.1). */
@ApiTags('documents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Access-checked, short-lived signed download URL. */
  @Get(':id/download')
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.documents.getDownloadUrl(id, actor);
  }

  /** Soft-delete (HR/Admin). The S3 object is retained for compliance. */
  @Delete(':id')
  @Roles([...ADMIN_ROLES])
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.documents.softDelete(id, actor);
  }
}
