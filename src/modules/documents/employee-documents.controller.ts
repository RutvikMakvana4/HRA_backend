import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/document.dto';

/** Documents nested under an employee (PRD §4.1). */
@ApiTags('documents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('employees/:employeeId/documents')
export class EmployeeDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** Register a document + get a signed upload URL. HR/Admin for anyone; employees for themselves. */
  @Post()
  create(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.documents.createForEmployee(employeeId, dto, actor);
  }

  /** List an employee's documents, visibility-scoped by role/relationship. */
  @Get()
  list(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.documents.listForEmployee(employeeId, actor);
  }
}
