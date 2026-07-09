import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/document.dto';

/** Candidate resume upload (recruiter/admin or the referrer — enforced in the service). */
@ApiTags('documents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('candidates/:candidateId/documents')
export class CandidateDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post()
  create(
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.documents.createForCandidate(candidateId, dto, actor);
  }
}
